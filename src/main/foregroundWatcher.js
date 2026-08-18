const { execFile } = require('child_process');
const { EventEmitter } = require('events');

const POLL_INTERVAL_MS = 2000;

// The actual game client's process name - NOT the same as its window
// title. Both the Daybreak launcher (LaunchPad.exe) and the game itself
// (eqgame.exe) show "EverQuest Legends" as their window title, so matching
// on title text would count the launcher as "the game is focused" too -
// process name is the reliable signal. Confirmed directly (Get-Process |
// Where MainWindowTitle) while the user had the game running, not guessed.
const TARGET_PROCESS_NAME = 'eqgame';

// GetForegroundWindow + GetWindowThreadProcessId via inline P/Invoke -
// avoids an npm native-binding module, since this environment isn't set up
// to build native modules (see CLAUDE.md's Packaging gotchas). Re-declaring
// the Add-Type class every poll is wasteful but harmless (PowerShell just
// throws "type already exists" on a re-add within the SAME process - moot
// here since each poll is a fresh powershell.exe invocation, not a
// persistent session).
const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class EQBTForegroundProbe {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
$hwnd = [EQBTForegroundProbe]::GetForegroundWindow()
$procId = 0
[EQBTForegroundProbe]::GetWindowThreadProcessId($hwnd, [ref]$procId) | Out-Null
try { (Get-Process -Id $procId -ErrorAction Stop).ProcessName } catch { '' }
`;

// Polls whether the game is the current foreground window, emitting
// 'focusChanged' (boolean) only when that actually flips - not on every
// poll - so a listener doesn't need to de-dupe itself. isEqFocused starts
// as null (genuinely unknown, not "assumed unfocused") specifically so the
// very first poll after start() always emits once and establishes real
// state immediately, whichever way it turns out - a default of `false`
// would have silently skipped emitting if the game happened to already be
// unfocused, leaving a caller's own state stale until the NEXT real change.
class ForegroundWatcher extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    this.isEqFocused = null;
  }

  start() {
    if (this.timer) return;
    this._poll();
    this.timer = setInterval(() => this._poll(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.isEqFocused = null;
  }

  _poll() {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], { windowsHide: true }, (err, stdout) => {
      if (err) return; // best-effort - a single failed poll just keeps the last known state
      const focused = stdout.trim().toLowerCase() === TARGET_PROCESS_NAME;
      if (focused !== this.isEqFocused) {
        this.isEqFocused = focused;
        this.emit('focusChanged', focused);
      }
    });
  }
}

module.exports = { ForegroundWatcher };
