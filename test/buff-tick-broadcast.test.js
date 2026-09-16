'use strict';
/**
 * BuffEngine's once-a-second `_tick()` (src/main/buffEngine.js) used to emit `buffsChanged` /
 * `allyBuffsChanged` / `bardSongsChanged` unconditionally, every second, forever - correct for a
 * genuine on-screen countdown, but it meant all three fired every second even with the game
 * closed and zero buffs/allies/songs active at all, each one also triggering a
 * sessionRestore.scheduleSave() call in main.js. customTimerEngine's own tick explicitly copied
 * this same pattern from here ("matching BuffEngine's countdown tick") and got the same
 * root-cause fix once the pattern was traced back - this file is the origin.
 *
 * Directly manipulates the engine's own activeBuffs/allyBuffs/bardSongs Maps rather than going
 * through the full landing/detection pipeline - that pipeline is covered elsewhere (detection.js,
 * bard-songs.test.js, etc); this is specifically about _tick()'s own broadcast decision once
 * something is already active, so building the Map entries directly keeps the setup honest about
 * what's actually being tested.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');

function makeEngine() {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const buffStore = new BuffStore(store);
  const engine = new BuffEngine(buffStore, store);
  engine.stop(); // no wall-clock tick; every test drives _tick() itself
  return engine;
}

function countEmits(engine, event, fn) {
  let n = 0;
  engine.on(event, () => { n += 1; });
  fn();
  return n;
}

test('with nothing active at all, _tick() broadcasts nothing on any of the three channels', () => {
  const engine = makeEngine();
  const n =
    countEmits(engine, 'buffsChanged', () => {}) +
    countEmits(engine, 'allyBuffsChanged', () => {}) +
    countEmits(engine, 'bardSongsChanged', () => {});
  let total = 0;
  engine.on('buffsChanged', () => { total += 1; });
  engine.on('allyBuffsChanged', () => { total += 1; });
  engine.on('bardSongsChanged', () => { total += 1; });
  engine._tick();
  assert.equal(total, 0, 'nothing is active and nothing changed - all three channels should stay silent');
});

test('a real (non-infinite) active self buff keeps buffsChanged ticking every second', () => {
  const engine = makeEngine();
  engine.activeBuffs.set('test buff', { name: 'Test Buff', expiresAt: Date.now() + 60000, infinite: false });
  let n = 0;
  engine.on('buffsChanged', () => { n += 1; });
  engine._tick();
  engine._tick();
  assert.equal(n, 2, 'a genuine countdown must keep refreshing every tick, unconditionally');
});

test('an infinite self buff (no ticking number) does not keep buffsChanged firing', () => {
  const engine = makeEngine();
  engine.activeBuffs.set('yaulp', { name: 'Yaulp', expiresAt: null, infinite: true });
  let n = 0;
  engine.on('buffsChanged', () => { n += 1; });
  engine._tick();
  engine._tick();
  assert.equal(n, 0, 'an infinite buff has no remaining-time number to refresh - the tick should be silent');
});

test('a self buff expiring is never swallowed, even from a tick that would otherwise be silent', () => {
  const engine = makeEngine();
  engine.activeBuffs.set('test buff', { name: 'Test Buff', expiresAt: Date.now() - 1, infinite: false });
  const n = countEmits(engine, 'buffsChanged', () => engine._tick());
  assert.equal(n, 1, 'the expiry itself is a real change and must always broadcast');
  assert.equal(engine.activeBuffs.size, 0, 'and the buff is actually gone');
});

test('the same rules apply independently to ally buffs and bard songs', () => {
  const engine = makeEngine();
  engine.allyBuffs.set('a', { name: 'Ally Buff', allyName: 'Baxa', expiresAt: Date.now() + 60000, infinite: false });
  engine.bardSongs.set('b', { name: 'Song', expiresAt: null, infinite: true });

  let allyN = 0;
  let songN = 0;
  engine.on('allyBuffsChanged', () => { allyN += 1; });
  engine.on('bardSongsChanged', () => { songN += 1; });
  engine._tick();

  assert.equal(allyN, 1, 'the real ally-buff countdown ticks');
  assert.equal(songN, 0, 'the infinite song has nothing to tick, and stays silent');
});

module.exports = () => report('buff-tick-broadcast');
if (require.main === module) report('buff-tick-broadcast').then((n) => process.exit(n ? 1 : 0));
