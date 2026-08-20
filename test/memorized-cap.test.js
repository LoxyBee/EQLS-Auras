'use strict';
/**
 * The memorized-gem picture must never exceed the fourteen real gem slots.
 *
 * This matters more than a wrong number on screen. currentlyMemorized is evidence in detection:
 * a unique landing text is refused when the spell is knowably NOT in a gem right now. A stale
 * entry therefore vouches for a spell that is not loaded, and drift only ever grows - entries
 * leave on "You forget X.", which the app cannot see while it is closed.
 *
 * Driven through the real BuffEngine with a fake store and fake log lines. No Electron.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const { test, report } = require('./harness');
const { BuffEngine } = require('../src/main/buffEngine');
const { BuffStore } = require('../src/main/buffStore');

const GEMS = 14;

function fakeStore(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  return {
    data,
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
}

function newEngine(store) {
  return new BuffEngine(new BuffStore(store), store);
}

const memLine = (n) => `You have finished memorizing ${n}.`;
const forgetLine = (n) => `You forget ${n}.`;

test('memorizing more than fourteen spells keeps only fourteen', () => {
  const store = fakeStore();
  const eng = newEngine(store);
  for (let i = 1; i <= 20; i++) eng.handleLine(memLine(`Spell ${i}`));
  assert.equal(eng.currentlyMemorized.size, GEMS, 'the picture grew past the number of real gem slots');
});

test('the fourteen kept are the most recent, not an arbitrary fourteen', () => {
  const store = fakeStore();
  const eng = newEngine(store);
  for (let i = 1; i <= 20; i++) eng.handleLine(memLine(`Spell ${i}`));
  const kept = [...eng.currentlyMemorized.values()];
  assert.deepEqual(
    kept, Array.from({ length: GEMS }, (_, k) => `Spell ${k + 7}`),
    'the wrong fourteen survived - eviction is not dropping the stalest first'
  );
});

test('re-memorizing a spell refreshes it, so it is not evicted next', () => {
  // The trap this guards: a Map does not move an existing key to the end when you re-set it.
  // Without an explicit delete-then-set, re-memorizing "Spell 1" would leave it stalest and the
  // very next arrival would evict the gem just loaded, while keeping one swapped out long ago.
  const store = fakeStore();
  const eng = newEngine(store);
  for (let i = 1; i <= GEMS; i++) eng.handleLine(memLine(`Spell ${i}`));
  eng.handleLine(memLine('Spell 1'));   // re-load the oldest
  eng.handleLine(memLine('Spell 99'));  // forces one eviction

  const kept = [...eng.currentlyMemorized.values()];
  assert.ok(kept.includes('Spell 1'), 'the spell just re-memorized was evicted');
  assert.ok(!kept.includes('Spell 2'), 'the stalest entry should have gone instead');
  assert.equal(eng.currentlyMemorized.size, GEMS);
});

test('a saved file that already drifted over the cap heals on load', () => {
  // Capping only new arrivals would leave an over-sized file permanently over the limit: entries
  // are removed by a forget line, which the app may never see for a gem swapped while it was shut.
  const oversized = Array.from({ length: 25 }, (_, i) => [`spell ${i + 1}`, `Spell ${i + 1}`]);
  const store = fakeStore({ currentlyMemorized: oversized });
  const eng = newEngine(store);
  assert.equal(eng.currentlyMemorized.size, GEMS, 'an already-drifted store was not trimmed on load');
  assert.equal(store.data.currentlyMemorized.length, GEMS, 'the trim was not persisted, so it would drift back next launch');
  const kept = [...eng.currentlyMemorized.values()];
  assert.equal(kept[kept.length - 1], 'Spell 25', 'the most recent entry was lost');
});

test('forgetting still removes a spell, and under the cap nothing is trimmed', () => {
  const store = fakeStore();
  const eng = newEngine(store);
  for (let i = 1; i <= 5; i++) eng.handleLine(memLine(`Spell ${i}`));
  eng.handleLine(forgetLine('Spell 3'));
  const kept = [...eng.currentlyMemorized.values()];
  assert.deepEqual(kept, ['Spell 1', 'Spell 2', 'Spell 4', 'Spell 5']);
});

test('casing is preserved for display', () => {
  // The Map is keyed lowercase for case-insensitive lookups but carries the original casing,
  // so a memorized spell absent from the roster still renders properly rather than all-lowercase.
  const store = fakeStore();
  const eng = newEngine(store);
  eng.handleLine(memLine("Cassindra's Chorus of Clarity"));
  assert.equal(eng.currentlyMemorized.get("cassindra's chorus of clarity"), "Cassindra's Chorus of Clarity");
});

module.exports = () => report('memorized-cap');
if (require.main === module) process.exit(report('memorized-cap') ? 1 : 0);
