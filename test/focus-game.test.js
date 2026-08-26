'use strict';
/**
 * Refocusing EverQuest after the last ambiguous cast is answered.
 *
 * What is simulated here: the decision and the command that would be run. `focusGameWindow` takes
 * its process-spawner as an argument, so the PowerShell call can be captured and inspected without
 * anything actually launching.
 *
 * What is NOT simulated, and is written up in TESTING.md instead: whether Windows honours the
 * focus change. That depends on foreground-lock rules that only apply to a real desktop with a
 * real game running, and no unit test can stand in for it.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { focusGameWindow } = require('../src/main/foregroundWatcher');

/** Captures the arguments instead of running anything, and replies with whatever `stdout` says. */
function fakeExecFile(stdout, { fail = false } = {}) {
  const calls = [];
  const fn = (file, args, opts, cb) => {
    calls.push({ file, args, opts });
    setImmediate(() => cb(fail ? new Error('boom') : null, stdout, ''));
  };
  fn.calls = calls;
  return fn;
}

test('it targets eqgame by process name, never by window title', () => {
  // The Daybreak launcher shows the identical window title "EverQuest Legends", so title matching
  // could focus the launcher instead of the game - worse than doing nothing.
  const exec = fakeExecFile('focused');
  focusGameWindow(exec);
  const script = exec.calls[0].args.join(' ');
  assert.match(script, /Get-Process -Name 'eqgame'/, 'not matching on the process name');
  assert.ok(!/MainWindowTitle/.test(script), 'matching on window title, which also matches the launcher');
});

test('it restores a minimised client rather than only focusing it', () => {
  const exec = fakeExecFile('focused');
  focusGameWindow(exec);
  const script = exec.calls[0].args.join(' ');
  assert.match(script, /ShowWindow\(\$p\.MainWindowHandle, 9\)/, 'SW_RESTORE missing - a minimised game would stay minimised');
  assert.match(script, /SetForegroundWindow/);
});

test('it runs hidden and cannot hang the app', () => {
  const exec = fakeExecFile('focused');
  focusGameWindow(exec);
  const { opts } = exec.calls[0];
  assert.equal(opts.windowsHide, true, 'a console window would flash on screen every time');
  assert.ok(opts.timeout > 0, 'no timeout - a wedged PowerShell would leak a process per answer');
});

test('resolves true only when a window was actually raised', async () => {
  assert.equal(await focusGameWindow(fakeExecFile('focused')), true);
});

test('the game not running is not an error', async () => {
  // Ordinary situation: answering a queued question after closing the game. Must be silent.
  assert.equal(await focusGameWindow(fakeExecFile('not-running')), false);
});

test('a failing or missing PowerShell resolves false instead of throwing', async () => {
  assert.equal(await focusGameWindow(fakeExecFile('', { fail: true })), false);
  const thrower = () => { throw new Error('no powershell'); };
  assert.equal(await focusGameWindow(thrower), false, 'a throwing spawner escaped and would reject the IPC call');
});

module.exports = () => report('focus-game');
if (require.main === module) process.exit(report('focus-game') ? 1 : 0);
