const path = require('path');
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

// Polls which of EQ / this app owns the foreground window, emitting
// 'focusChanged' with { eqFocused, ownAppFocused } only when that actually
// changes - not on every poll - so a listener doesn't need to de-dupe itself.
// lastState starts as null (genuinely unknown, not "assumed nothing focused")
// specifically so the very first poll after start() always emits once and
// establishes real state immediately, whichever way it turns out - a default
// of both-false would have silently skipped emitting if neither app happened
// to be focused, leaving a caller's own state stale until the NEXT change.
class ForegroundWatcher extends EventEmitter {
  constructor() {
    super();
    this.timer = null;
    // Which app is focused, tracked separately rather than collapsed into one
    // "relevant app" boolean. The two now drive different settings: EQ being
    // focused is what auto-hide keys off, while this app being focused is an
    // independent, off-by-default option. Merging them here would make that
    // second setting impossible to express.
    this.lastState = null; // { eqFocused, ownAppFocused }
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
    this.lastState = null;
  }

  _poll() {
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', PS_SCRIPT], { windowsHide: true }, (err, stdout) => {
      if (err) return; // best-effort - a single failed poll just keeps the last known state
      const processName = stdout.trim().toLowerCase();
      const eqFocused = processName === TARGET_PROCESS_NAME;
      const ownAppFocused = processName === OWN_PROCESS_NAME;
      const prev = this.lastState;
      if (!prev || prev.eqFocused !== eqFocused || prev.ownAppFocused !== ownAppFocused) {
        this.lastState = { eqFocused, ownAppFocused };
        this.emit('focusChanged', this.lastState);
      }
    });
  }
}

module.exports = { ForegroundWatcher };
