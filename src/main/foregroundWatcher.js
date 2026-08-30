const path = require('path');
const { execFile, spawn } = require('child_process');
const { EventEmitter } = require('events');

// Was 2000 - reported directly as "slow to show/hide overlays" when swapping windows. Measured
// directly (not guessed) why: the OLD design spawned a brand new powershell.exe for every single
// poll, and even a do-nothing script cost ~150-220ms just for the interpreter to start (Add-Type's
// own C# compilation added another ~70-100ms on top of that). That fixed per-poll cost was the
// real bottleneck, not the interval - a persistent PowerShell process (see PsProbe below) that
// stays running and is fed one query per poll measured at ~18-20ms per round trip once warm, a
// 10-15x drop, which is what makes a much shorter interval reasonable now.
const POLL_INTERVAL_MS = 300;
// A query that never comes back within this long is treated as a dead/hung process and the whole
// thing is respawned - better than a poll silently never resolving again.
const QUERY_TIMEOUT_MS = 1500;
const RESPONSE_DELIMITER = '###EQBT-FG-END###';

// The actual game client's process name - NOT the same as its window
// title. Both the Daybreak launcher (LaunchPad.exe) and the game itself
// (eqgame.exe) show "EverQuest Legends" as their window title, so matching
// on title text would count the launcher as "the game is focused" too -
// process name is the reliable signal. Confirmed directly (Get-Process |
// Where MainWindowTitle) while the user had the game running, not guessed.
const TARGET_PROCESS_NAME = 'eqgame';

// This app's OWN process name (e.g. "electron" in dev, "EQLS Auras" once
// packaged) - the overlay must also stay visible while the user is
// interacting with the app's own windows (dragging/resizing a widget,
// adjusting settings in the main window), not just while EQ itself is
// focused. Without this, clicking a widget to drag it briefly makes THAT
// window - not eqgame - the foreground window, which auto-hide would
// otherwise treat as "EQ lost focus" and hide the very widget being
// dragged, making it impossible to reposition anything with this feature
// on. Derived from the running executable rather than hardcoded so this
// keeps working correctly through any future rename, same reasoning as
// main.js's userData pin. On Windows (the only platform this app ships
// for), every window this app owns - main window, each widget, the
// ambiguous-cast popup - runs from this same executable image regardless
// of which BrowserWindow/renderer process backs it, so a single process-
// name check covers all of them without needing to enumerate windows.
const OWN_PROCESS_NAME = path.basename(process.execPath, path.extname(process.execPath)).toLowerCase();

// GetForegroundWindow + GetWindowThreadProcessId via inline P/Invoke - avoids an npm native-
// binding module, since this environment isn't set up to build native modules (see CLAUDE.md's
// Packaging gotchas). The Add-Type class is declared ONCE, when the persistent process starts
// (see PsProbe below) - unlike the old design, which paid powershell.exe's own ~150-220ms startup
// cost PLUS Add-Type's ~70-100ms compile cost on every single poll. Each query after setup is just
// two P/Invoke calls and a Get-Process lookup - measured at ~18-20ms once the process is warm.
const PS_SETUP_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class EQBTForegroundProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
  [DllImport("shell32.dll")] public static extern int SHQueryUserNotificationState(out int pquns);
}
"@
`;

// Response is "<processName>|<quns>". SHQueryUserNotificationState reports the shell's
// do-not-disturb reason; QUNS_RUNNING_D3D_FULL_SCREEN (3) means an exclusive-fullscreen Direct3D
// app is in front - which is exactly when an always-on-top overlay stops being composited over EQ
// and the user is left wondering where the auras went (#9). QUNS_PRESENTATION_MODE (4) hides
// notifications the same way. A '0' means the call failed and is treated as "not fullscreen".
const PS_QUERY_SCRIPT = `
$hwnd = [EQBTForegroundProbe]::GetForegroundWindow()
$procId = 0
[EQBTForegroundProbe]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
$name = try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { '' }
$quns = 0
try { [EQBTForegroundProbe]::SHQueryUserNotificationState([ref]$quns) | Out-Null } catch { $quns = 0 }
Write-Output ("{0}|{1}" -f $name, $quns)
Write-Output '${RESPONSE_DELIMITER}'
`;

// QUNS_RUNNING_D3D_FULL_SCREEN / QUNS_PRESENTATION_MODE - the two states where an overlay will not
// draw over the foreground app.
const FULLSCREEN_QUNS = new Set([3, 4]);

// One long-lived powershell.exe, fed a query over stdin per poll and read back over stdout - see
// this file's own header comment on why a persistent process replaced spawning a fresh one every
// poll. Deliberately its own small class: the queueing/respawn logic has nothing to do with what
// ForegroundWatcher itself is polling FOR, and keeping them separate means a future second use of
// "run PowerShell queries fast" doesn't have to duplicate this.
class PsProbe {
  // spawnFn is injectable the same way focusGameWindow's execFileFn is - lets tests hand in a
  // fake child-process-shaped object (stdin.write, stdout as an EventEmitter, on('exit'/'error'))
  // instead of actually launching PowerShell.
  constructor(spawnFn = spawn) {
    this.spawnFn = spawnFn;
    this.proc = null;
    this.buffer = '';
    this.queue = []; // FIFO of {resolve, timer} - PowerShell processes stdin strictly in order,
    // so a query's response is always the next delimiter-terminated chunk, no query id needed.
  }

  _ensureStarted() {
    if (this.proc) return;
    const proc = this.spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    this.proc = proc;
    this.buffer = '';
    proc.stdout.on('data', (chunk) => this._onData(chunk));
    // Both 'exit' and 'error' mean the process is gone - fail every still-pending query rather
    // than leaving its promise hanging forever, and drop the reference so the next query respawns.
    const onGone = () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this._failAll();
    };
    proc.on('exit', onGone);
    proc.on('error', onGone);
    try {
      proc.stdin.write(PS_SETUP_SCRIPT);
    } catch {
      onGone();
    }
  }

  _onData(chunk) {
    this.buffer += chunk.toString();
    let idx;
    while ((idx = this.buffer.indexOf(RESPONSE_DELIMITER)) !== -1) {
      const text = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + RESPONSE_DELIMITER.length);
      const next = this.queue.shift();
      if (!next) continue; // stray output (e.g. the setup script itself produces none, but be safe)
      clearTimeout(next.timer);
      // The query script's own last real line is the process name (or empty) - anything before
      // that in this chunk is noise (PowerShell's own banner text, if any).
      const lines = text.split(/\r?\n/).map((l) => l.trim());
      next.resolve(lines.filter(Boolean).pop() || '');
    }
  }

  _failAll() {
    for (const { resolve, timer } of this.queue) {
      clearTimeout(timer);
      resolve(null);
    }
    this.queue = [];
  }

  // Resolves to the foreground process's name (lowercased happens in the caller), or null on any
  // failure - timeout, dead process, write error. Best-effort, same as the old design: a single
  // failed poll just keeps the caller's last known state.
  query() {
    return new Promise((resolve) => {
      this._ensureStarted();
      if (!this.proc) {
        resolve(null);
        return;
      }
      const entry = {
        resolve,
        timer: setTimeout(() => {
          // A query that never comes back means the process is hung, not just slow - kill it so
          // the NEXT query starts fresh rather than piling up behind a dead pipe forever.
          const idx = this.queue.indexOf(entry);
          if (idx !== -1) this.queue.splice(idx, 1);
          resolve(null);
          if (this.proc) {
            try {
              this.proc.kill();
            } catch {
              // already gone
            }
          }
        }, QUERY_TIMEOUT_MS),
      };
      this.queue.push(entry);
      try {
        this.proc.stdin.write(PS_QUERY_SCRIPT);
      } catch {
        clearTimeout(entry.timer);
        const idx = this.queue.indexOf(entry);
        if (idx !== -1) this.queue.splice(idx, 1);
        resolve(null);
      }
    });
  }

  stop() {
    this._failAll();
    if (this.proc) {
      try {
        this.proc.stdin.end();
      } catch {
        // ignore
      }
      try {
        this.proc.kill();
      } catch {
        // ignore
      }
      this.proc = null;
    }
    this.buffer = '';
  }
}

// Polls which of EQ / this app owns the foreground window, emitting
// 'focusChanged' with { eqFocused, ownAppFocused } only when that actually
// changes - not on every poll - so a listener doesn't need to de-dupe itself.
// lastState starts as null (genuinely unknown, not "assumed nothing focused")
// specifically so the very first poll after start() always emits once and
// establishes real state immediately, whichever way it turns out - a default
// of both-false would have silently skipped emitting if neither app happened
// to be focused, leaving a caller's own state stale until the NEXT change.
class ForegroundWatcher extends EventEmitter {
  // spawnFn threads through to PsProbe, same DI reasoning as everywhere else in this file.
  constructor(spawnFn = spawn) {
    super();
    this.timer = null;
    this.running = false;
    this.probe = new PsProbe(spawnFn);
    // Which app is focused, tracked separately rather than collapsed into one
    // "relevant app" boolean. The two now drive different settings: EQ being
    // focused is what auto-hide keys off, while this app being focused is an
    // independent, off-by-default option. Merging them here would make that
    // second setting impossible to express.
    this.lastState = null; // { eqFocused, ownAppFocused, foregroundFullscreen }
  }

  start() {
    if (this.running) return;
    this.running = true;
    this._pollLoop();
  }

  stop() {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.lastState = null;
    this.probe.stop();
  }

  // A self-rescheduling loop (setTimeout after each query resolves), not setInterval - the
  // process spawn/respawn path is now async, and setInterval firing again mid-respawn would pile
  // queries up behind a process that isn't ready yet.
  async _pollLoop() {
    if (!this.running) return;
    await this._poll();
    if (!this.running) return;
    this.timer = setTimeout(() => this._pollLoop(), POLL_INTERVAL_MS);
  }

  async _poll() {
    const result = await this.probe.query();
    if (result == null) return; // best-effort - a single failed poll just keeps the last known state
    // "<name>|<quns>" since the fullscreen probe was added; a bare name (no pipe) still parses,
    // so an old fake response in a test, or a truncated line, degrades to "not fullscreen".
    const [rawName, rawState] = String(result).split('|');
    const processName = (rawName || '').toLowerCase();
    const eqFocused = processName === TARGET_PROCESS_NAME;
    const ownAppFocused = processName === OWN_PROCESS_NAME;
    const foregroundFullscreen = FULLSCREEN_QUNS.has(Number(rawState));
    const prev = this.lastState;
    if (
      !prev ||
      prev.eqFocused !== eqFocused ||
      prev.ownAppFocused !== ownAppFocused ||
      prev.foregroundFullscreen !== foregroundFullscreen
    ) {
      this.lastState = { eqFocused, ownAppFocused, foregroundFullscreen };
      this.emit('focusChanged', this.lastState);
    }
  }
}

// Brings EverQuest back to the front.
//
// Answering the ambiguous-cast popup means clicking away from the game, and the game does not
// come back on its own - so without this you answer a one-click question and then have to find
// your way back into EQ mid-fight, which is exactly when the question tends to appear.
//
// Same inline P/Invoke approach as the poll above, for the same reason: no native npm module.
// Targets eqgame by PROCESS NAME rather than window title, because the Daybreak launcher shows
// the identical title "EverQuest Legends" and focusing the launcher instead would be worse than
// doing nothing (see the note at the top of this file).
//
// Deliberately best-effort and silent. The game not running, or Windows refusing the focus
// change because this app is not the foreground window, are both ordinary situations - not
// errors worth interrupting anyone about. Resolves to true only when a window was actually
// raised, so callers and tests can tell the difference.
function focusGameWindow(execFileFn = execFile) {
  const script = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class EQBTFocus {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@
$p = Get-Process -Name '${TARGET_PROCESS_NAME}' -ErrorAction SilentlyContinue |
     Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) {
  # SW_RESTORE (9) first, so a minimised client is un-minimised rather than merely focused.
  [EQBTFocus]::ShowWindow($p.MainWindowHandle, 9) | Out-Null
  [EQBTFocus]::SetForegroundWindow($p.MainWindowHandle) | Out-Null
  'focused'
} else { 'not-running' }
`;
  return new Promise((resolve) => {
    try {
      execFileFn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', script],
        { windowsHide: true, timeout: 4000 },
        (err, stdout) => resolve(!err && String(stdout).trim() === 'focused')
      );
    } catch {
      resolve(false);
    }
  });
}

module.exports = { ForegroundWatcher, PsProbe, focusGameWindow, RESPONSE_DELIMITER };
