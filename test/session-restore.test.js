'use strict';
/**
 * The unified session-restore registry (src/main/sessionRestore.js). Owner, 2 Sep: restart
 * restoration "should be a global app feature not just limited to specific things" - one snapshot
 * file, one save path, every stateful engine plugs in with its own staleness limit.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { SessionRestore } = require('../src/main/sessionRestore');

// A tiny in-memory stand-in for store.js's loadJson/saveJson.
function fakeStore(initial = {}) {
  const data = { ...initial };
  return {
    saveJson: (k, v) => { data[k] = v === null ? undefined : JSON.parse(JSON.stringify(v)); },
    loadJson: (k, d) => (k in data && data[k] !== undefined ? data[k] : d),
    _peek: () => data,
  };
}

test('capture writes every part; restore hands each part its slice back', () => {
  const store = fakeStore();
  const a = new SessionRestore();
  a.setStore(store);
  let restoredWith = null;
  a.register('alpha', { capture: () => ({ n: 3 }), restore: (d) => { restoredWith = d; return d.n; } });
  a.saveNow();

  const b = new SessionRestore();
  b.setStore(store);
  b.register('alpha', { capture: () => null, restore: (d) => { restoredWith = d; return d.n; } });
  b.restoreAll();
  assert.deepEqual(restoredWith, { n: 3 });
});

test('a part returning null is not written, and is skipped on restore', () => {
  const store = fakeStore();
  const a = new SessionRestore();
  a.setStore(store);
  a.register('empty', { capture: () => null, restore: () => { throw new Error('should not run'); } });
  a.saveNow();
  assert.deepEqual(store._peek().sessionRestore.parts, {});

  const b = new SessionRestore();
  b.setStore(store);
  b.register('empty', { capture: () => null, restore: () => { throw new Error('should not run'); } });
  assert.doesNotThrow(() => b.restoreAll());
});

test('each part has its own staleness limit', () => {
  const now = 1_000_000_000_000;
  const store = fakeStore({
    sessionRestore: { savedAt: now - 3 * 60 * 1000, parts: { quick: { x: 1 }, slow: { x: 1 } } },
  });
  const r = new SessionRestore();
  r.setStore(store);
  const got = [];
  r.register('quick', { capture: () => null, restore: () => { got.push('quick'); }, maxGapMs: 2 * 60 * 1000 });
  r.register('slow', { capture: () => null, restore: () => { got.push('slow'); }, maxGapMs: 20 * 60 * 1000 });
  r.restoreAll(now);
  assert.deepEqual(got, ['slow'], 'the 3-minute-old snapshot is past quick\'s 2-min limit but inside slow\'s 20');
});

test('a backwards clock discards the whole snapshot', () => {
  const now = 1_000_000_000_000;
  const store = fakeStore({ sessionRestore: { savedAt: now + 5000, parts: { p: { x: 1 } } } });
  const r = new SessionRestore();
  r.setStore(store);
  let ran = false;
  r.register('p', { capture: () => null, restore: () => { ran = true; } });
  r.restoreAll(now);
  assert.equal(ran, false);
});

test('one part throwing on restore does not stop the others', () => {
  const store = fakeStore({
    sessionRestore: { savedAt: Date.now() - 1000, parts: { bad: { x: 1 }, good: { x: 1 } } },
  });
  const r = new SessionRestore();
  r.setStore(store);
  let goodRan = false;
  r.register('bad', { capture: () => null, restore: () => { throw new Error('boom'); } });
  r.register('good', { capture: () => null, restore: () => { goodRan = true; } });
  assert.doesNotThrow(() => r.restoreAll());
  assert.equal(goodRan, true);
});

test('scheduleSave debounces and saveNow flushes', async () => {
  const store = fakeStore();
  const r = new SessionRestore();
  r.setStore(store);
  let captures = 0;
  r.register('c', { capture: () => { captures++; return { captures }; }, restore: () => {} });
  r.scheduleSave();
  r.scheduleSave();
  r.scheduleSave();
  assert.equal(captures, 0, 'nothing written synchronously');
  r.saveNow();
  assert.equal(captures, 1, 'saveNow flushes the pending timer exactly once');
  assert.deepEqual(store._peek().sessionRestore.parts.c, { captures: 1 });
});

// Reported live 15 Sep: sessionRestore.json was measured at ~75 MB on disk and being rewritten
// every couple of seconds, causing real system-wide disk-I/O lag - because the Combat tab's
// scanned-log history (one registered part, tens of MB, rarely changing) got rewritten in full
// every time ANY other part's own activity called scheduleSave(). Root-caused to a runaway debug
// log elsewhere driving the rapid saves, but this file's own design made every one of those saves
// far more expensive than it needed to be regardless of what triggers them - both fixes below are
// worth having on their own.
test('saveNow skips the write entirely when the captured parts have not actually changed', () => {
  const store = fakeStore();
  const calls = [];
  const wrapped = { ...store, saveJson: (...args) => { calls.push(args); store.saveJson(...args); } };
  const r = new SessionRestore();
  r.setStore(wrapped);
  r.register('c', { capture: () => ({ n: 1 }), restore: () => {} });

  r.saveNow();
  assert.equal(calls.length, 1, 'the first save always writes');
  const firstSavedAt = store._peek().sessionRestore.savedAt;

  r.saveNow();
  assert.equal(calls.length, 1, 'identical content a second time must not write again');
  assert.equal(store._peek().sessionRestore.savedAt, firstSavedAt, 'savedAt must not move on a skipped write');
});

test('saveNow writes again the moment captured content actually differs', () => {
  const store = fakeStore();
  const calls = [];
  const wrapped = { ...store, saveJson: (...args) => { calls.push(args); store.saveJson(...args); } };
  let n = 1;
  const r = new SessionRestore();
  r.setStore(wrapped);
  r.register('c', { capture: () => ({ n }), restore: () => {} });

  r.saveNow();
  n = 2;
  r.saveNow();
  assert.equal(calls.length, 2, 'a real content change must not be swallowed by the unchanged-skip');
  assert.deepEqual(store._peek().sessionRestore.parts.c, { n: 2 });
});

// Reported live 15 Sep, the other half of the same finding: the file is pretty-printed with the
// same JSON.stringify(data, null, 2) every other (small, human-readable) config file uses, and for
// a file that can hold tens of MB of Combat-tab scan history, that indentation alone was measured
// at roughly 3x the byte count of the same data compact - real, sustained disk I/O for something
// nobody reads by hand. store.js's saveJson takes a `{ pretty: false }` option for exactly this.
test('the snapshot is written compact (pretty: false), not pretty-printed like the small config files', () => {
  const store = fakeStore();
  let sawOpts;
  const wrapped = { ...store, saveJson: (k, v, opts) => { sawOpts = opts; store.saveJson(k, v); } };
  const r = new SessionRestore();
  r.setStore(wrapped);
  r.register('c', { capture: () => ({ n: 1 }), restore: () => {} });
  r.saveNow();
  assert.deepEqual(sawOpts, { pretty: false });
});

test('no store wired: every call is a safe no-op', () => {
  const r = new SessionRestore();
  r.register('x', { capture: () => ({}), restore: () => {} });
  assert.doesNotThrow(() => { r.scheduleSave(); r.saveNow(); r.restoreAll(); r.clear(); });
});

module.exports = () => report('session-restore');
if (require.main === module) report('session-restore').then((n) => process.exit(n ? 1 : 0));
