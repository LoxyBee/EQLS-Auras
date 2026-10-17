'use strict';
const { spawn } = require('child_process');

// Whether the Alt key is held right now - for "Move together" (owner, 16 Oct): Alt-dragging any aura
// in a linked group moves just that one, whichever aura the move session was opened on.
//
// Why a watcher process: an aura is dragged by Windows itself (-webkit-app-region: drag), so the
// overlay page never sees the mouse event that would carry e.altKey, and Electron has no API for
// "is this key held". So, the same approach as foregroundWatcher.js (no native module - see
// CLAUDE.md's Packaging notes): one resident powershell.exe calling GetAsyncKeyState in a loop and
// printing a line only when the state CHANGES. It runs only while a group can be moved (main.js
// starts it with a group move session / "Unlock all auras" and stops it after), so it costs
// nothing the rest of the time.
const POLL_MS = 25;
const VK_MENU = 0x12; // either Alt key

const PS_SCRIPT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class EQBTAltProbe {
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int vKey);
}
"@
$last = -1
while ($true) {
  $now = if (([EQBTAltProbe]::GetAsyncKeyState(${VK_MENU}) -band 0x8000) -ne 0) { 1 } else { 0 }
  if ($now -ne $last) { [Console]::Out.WriteLine($now); [Console]::Out.Flush(); $last = $now }
  Start-Sleep -Milliseconds ${POLL_MS}
}
`;

class AltKeyWatcher {
  // spawnFn is injectable so tests can hand in a fake child process instead of launching PowerShell.
  constructor(spawnFn = spawn) {
    this.spawnFn = spawnFn;
    this.proc = null;
    this.held = false;
    this.buffer = '';
  }

  isHeld() {
    return this.held;
  }

  isRunning() {
    return !!this.proc;
  }

  start() {
    if (this.proc || process.platform !== 'win32' && this.spawnFn === spawn) return;
    let proc;
    try {
      // -EncodedCommand (UTF-16LE base64) rather than feeding stdin: "-Command -" runs stdin line by
      // line and a multi-line loop never starts that way.
      const encoded = Buffer.from(PS_SCRIPT, 'utf16le').toString('base64');
      proc = this.spawnFn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', encoded], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return;
    }
    this.proc = proc;
    this.buffer = '';
    this.held = false;
    proc.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split(/\r?\n/);
      this.buffer = lines.pop();
      for (const line of lines) {
        const t = line.trim();
        if (t === '1') this.held = true;
        else if (t === '0') this.held = false;
      }
    });
    // Same as foregroundWatcher: a dead pipe reports through 'error' events, and an unhandled one
    // crashes the main process - so every way the process can go away is caught here.
    const onGone = () => {
      if (this.proc !== proc) return;
      this.proc = null;
      this.held = false;
    };
    proc.on('exit', onGone);
    proc.on('error', onGone);
    proc.stdout.on('error', onGone);
  }

  stop() {
    const proc = this.proc;
    this.proc = null;
    this.held = false;
    if (proc) {
      try {
        proc.kill();
      } catch {
        /* already gone */
      }
    }
  }
}

module.exports = { AltKeyWatcher, PS_SCRIPT };
