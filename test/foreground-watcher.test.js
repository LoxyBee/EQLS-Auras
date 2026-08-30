'use strict';
/**
 * PsProbe / ForegroundWatcher (foregroundWatcher.js). The old design spawned a fresh
 * powershell.exe for every single poll - measured directly (not guessed) at ~150-220ms just for
 * the interpreter to start, dominating the reported "slow to show/hide overlays" complaint. This
 * pins the persistent-process replacement: one powershell.exe fed a query per poll over stdin,
 * with its own respawn-on-crash and timeout-on-hang handling.
 *
 * A fake child process (EventEmitter-based stdout, a stdin.write spy, a fake kill()) stands in for
 * the real one, same DI pattern focus-game.test.js already uses for focusGameWindow's execFileFn.
 */

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { test, report } = require('./harness');
const { PsProbe, ForegroundWatcher, RESPONSE_DELIMITER } = require('../src/main/foregroundWatcher');

/** A minimal stand-in for the object child_process.spawn() returns. stdin/stdout are real
 *  EventEmitters, matching child_process, so the 'error' listeners the probe attaches are valid. */
function makeFakeProc() {
  const stdout = new EventEmitter();
  const stdin = new EventEmitter();
  stdin.writes = [];
  stdin.write = (text) => { stdin.writes.push(text); };
  const proc = new EventEmitter();
  proc.stdout = stdout;
  proc.stdin = stdin;
  proc.killed = false;
  proc.kill = () => {
    proc.killed = true;
  };
  return proc;
}

function makeSpawnFn() {
  const created = [];
  const spawnFn = () => {
    const proc = makeFakeProc();
    created.push(proc);
    return proc;
  };
  spawnFn.created = created;
  return spawnFn;
}

/**
 * Writes a fake PowerShell response to stdout. The real script emits "<name>|<quns>"; `quns` here
 * defaults to 5 (QUNS_ACCEPTS_NOTIFICATIONS - a normal windowed desktop). Pass a bare-name string
 * with no pipe by setting quns to null, to check the degrade path.
 */
function respond(proc, name, quns = 5) {
  const line = quns === null ? name : `${name}|${quns}`;
  proc.stdout.emit('data', Buffer.from(`${line}\r\n${RESPONSE_DELIMITER}\r\n`));
}

test('a query writes the query script to stdin and resolves with the delimited response', async () => {
  const spawnFn = makeSpawnFn();
  const probe = new PsProbe(spawnFn, 0);
  const resultPromise = probe.query();
  const proc = spawnFn.created[0];
  assert.ok(proc.stdin.writes.some((w) => w.includes('GetForegroundWindow')), 'setup script never written');
  assert.ok(proc.stdin.writes.some((w) => w.includes(RESPONSE_DELIMITER)), 'query script never written');
  respond(proc, 'eqgame');
  assert.equal(await resultPromise, 'eqgame|5', 'query() returns the raw "<name>|<quns>" line; _poll parses it');
});

test('only ONE powershell.exe is spawned across many queries - the process is reused, not respawned', async () => {
  const spawnFn = makeSpawnFn();
  const probe = new PsProbe(spawnFn, 0);
  const p1 = probe.query();
  respond(spawnFn.created[0], 'eqgame');
  await p1;
  const p2 = probe.query();
  respond(spawnFn.created[0], 'explorer');
  await p2;
  assert.equal(spawnFn.created.length, 1, 'a second powershell.exe was spawned for the second query');
});

test('two queries in flight resolve in the order they were sent, matching PowerShell\'s own stdin processing order', async () => {
  const spawnFn = makeSpawnFn();
  const probe = new PsProbe(spawnFn, 0);
  const first = probe.query();
  const second = probe.query();
  const proc = spawnFn.created[0];
  // Both responses can legitimately arrive in one stdout chunk if PowerShell processed both
  // queued stdin lines before Node's next read - the delimiter is what separates them.
  proc.stdout.emit('data', Buffer.from(`eqgame\r\n${RESPONSE_DELIMITER}\r\nexplorer\r\n${RESPONSE_DELIMITER}\r\n`));
  assert.equal(await first, 'eqgame');
  assert.equal(await second, 'explorer');
});

test('the process dying with a query in flight resolves that query to null instead of hanging forever', async () => {
  const spawnFn = makeSpawnFn();
  const probe = new PsProbe(spawnFn, 0);
  const resultPromise = probe.query();
  const proc = spawnFn.created[0];
  proc.emit('exit', 1);
  assert.equal(await resultPromise, null);
});

test('an async EPIPE on stdin is handled, not crashed on, and resolves the query to null', async () => {
  // stream.write() on a dead pipe does not throw - it emits 'error' asynchronously. Without a
  // stdin 'error' listener that is an uncaught exception that takes the whole main process down
  // (reported live as a "write EPIPE" crash dialog).
  const spawnFn = makeSpawnFn();
  const probe = new PsProbe(spawnFn, 0);
  const pending = probe.query();
  const proc = spawnFn.created[0];
  assert.doesNotThrow(() => proc.stdin.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' })));
  assert.equal(await pending, null);
  assert.equal(probe.proc, null, 'the broken process should have been dropped');
});

test('after a death the probe waits out its cooldown before spawning again', async () => {
  const spawnFn = makeSpawnFn();
  const probe = new PsProbe(spawnFn, 10000); // long cooldown
  const first = probe.query();
  spawnFn.created[0].emit('exit', 1);
  await first;
  const second = probe.query();
  assert.equal(await second, null, 'a query during the cooldown just fails, best-effort');
  assert.equal(spawnFn.created.length, 1, 'no fork-bomb respawn while cooling down');
});

test('a query after the process died respawns a fresh one rather than reusing the dead reference', async () => {
  const spawnFn = makeSpawnFn();
  const probe = new PsProbe(spawnFn, 0);
  const first = probe.query();
  spawnFn.created[0].emit('exit', 1);
  await first;
  const second = probe.query();
  assert.equal(spawnFn.created.length, 2, 'no new process was spawned after the first one died');
  respond(spawnFn.created[1], 'eqgame');
  assert.equal(await second, 'eqgame|5');
});

test('stop() ends stdin and kills the process, and fails any still-pending query', async () => {
  const spawnFn = makeSpawnFn();
  const probe = new PsProbe(spawnFn, 0);
  const pending = probe.query();
  const proc = spawnFn.created[0];
  proc.stdin.end = () => { proc.stdin.ended = true; };
  probe.stop();
  assert.equal(await pending, null);
  assert.equal(proc.killed, true);
  assert.equal(proc.stdin.ended, true);
});

test('ForegroundWatcher emits focusChanged on the very first poll even if the state turns out to be "nothing focused"', async () => {
  const spawnFn = makeSpawnFn();
  const watcher = new ForegroundWatcher(spawnFn);
  const events = [];
  watcher.on('focusChanged', (s) => events.push(s));
  watcher.start();
  await new Promise((r) => setImmediate(r));
  respond(spawnFn.created[0], 'notepad');
  await new Promise((r) => setImmediate(r));
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { eqFocused: false, ownAppFocused: false, foregroundFullscreen: false });
  watcher.stop();
});

test('ForegroundWatcher does not re-emit when the poll returns the same state twice in a row', async () => {
  const spawnFn = makeSpawnFn();
  const watcher = new ForegroundWatcher(spawnFn);
  const events = [];
  watcher.on('focusChanged', (s) => events.push(s));

  const p1 = watcher._poll();
  respond(spawnFn.created[0], 'eqgame');
  await p1;
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], { eqFocused: true, ownAppFocused: false, foregroundFullscreen: false });

  const p2 = watcher._poll();
  respond(spawnFn.created[0], 'eqgame'); // identical result the second time
  await p2;
  assert.equal(events.length, 1, 'an unchanged state should not fire a second focusChanged');

  const p3 = watcher._poll();
  respond(spawnFn.created[0], 'notepad'); // now it actually changes
  await p3;
  assert.equal(events.length, 2);
  assert.deepEqual(events[1], { eqFocused: false, ownAppFocused: false, foregroundFullscreen: false });
});

// ---------------------------------------------------------------------------
// Exclusive-fullscreen detection (#9)
// ---------------------------------------------------------------------------

test('QUNS_RUNNING_D3D_FULL_SCREEN (3) sets foregroundFullscreen, and clearing it fires again', async () => {
  const spawnFn = makeSpawnFn();
  const watcher = new ForegroundWatcher(spawnFn);
  const events = [];
  watcher.on('focusChanged', (s) => events.push(s));

  const p1 = watcher._poll();
  respond(spawnFn.created[0], 'eqgame', 3); // EQ, exclusive fullscreen
  await p1;
  assert.deepEqual(events.at(-1), { eqFocused: true, ownAppFocused: false, foregroundFullscreen: true });

  const p2 = watcher._poll();
  respond(spawnFn.created[0], 'eqgame', 3); // unchanged
  await p2;
  assert.equal(events.length, 1, 'an unchanged fullscreen state should not re-emit');

  const p3 = watcher._poll();
  respond(spawnFn.created[0], 'eqgame', 5); // dropped to windowed
  await p3;
  assert.deepEqual(events.at(-1), { eqFocused: true, ownAppFocused: false, foregroundFullscreen: false });
});

test('presentation mode (4) also counts; a bare name with no quns degrades to not-fullscreen', async () => {
  const spawnFn = makeSpawnFn();
  const watcher = new ForegroundWatcher(spawnFn);
  const events = [];
  watcher.on('focusChanged', (s) => events.push(s));

  const p1 = watcher._poll();
  respond(spawnFn.created[0], 'powerpnt', 4);
  await p1;
  assert.equal(events.at(-1).foregroundFullscreen, true);

  const p2 = watcher._poll();
  respond(spawnFn.created[0], 'powerpnt', null); // old-style bare response, no pipe
  await p2;
  assert.equal(events.at(-1).foregroundFullscreen, false, 'a missing quns must not read as fullscreen');
});

test('ForegroundWatcher.stop() tears down the underlying probe (no orphaned powershell.exe on app quit)', () => {
  const spawnFn = makeSpawnFn();
  const watcher = new ForegroundWatcher(spawnFn);
  watcher.start();
  watcher.stop();
  assert.equal(watcher.probe.proc, null, 'the persistent process should be torn down, not left running');
});

module.exports = () => report('foreground-watcher');
if (require.main === module) report('foreground-watcher').then((n) => process.exit(n ? 1 : 0));
