'use strict';
/**
 * currentlyMemorized must be scoped per loadout profile, same as selfAmbiguousResolutions.
 *
 * A full EQ Legends loadout swap prints zero forget/memorize lines (confirmed against a real log
 * across a whole swap window), so a single flat currentlyMemorized map kept vouching for the
 * PREVIOUS loadout's gems after a swap - confirmed live to land the wrong buff off exactly that
 * stale evidence. Scoping per profile doesn't detect the swap (nothing does), but it means the
 * user's own manual profile switch - which they already do for every swap - resets this evidence
 * to empty ("we don't know") instead of carrying over the wrong loadout's gems as false confidence.
 *
 * Driven through the real BuffEngine with a fake store and fake log lines. No Electron.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { BuffEngine } = require('../src/main/buffEngine');
const { BuffStore } = require('../src/main/buffStore');
const { DEFAULT_PROFILE_ID } = require('../src/main/profileStore');

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

test('switching profiles swaps in an empty memorized picture, not the old one', () => {
  const store = fakeStore();
  const eng = newEngine(store);
  eng.handleLine(memLine('Spirit of the Puma'));
  assert.ok(eng.currentlyMemorized.has('spirit of the puma'));

  eng.setActiveProfileId('other-profile');
  assert.equal(eng.currentlyMemorized.size, 0, 'a fresh profile carried over the previous loadout\'s gems');

  eng.setActiveProfileId(DEFAULT_PROFILE_ID);
  assert.ok(eng.currentlyMemorized.has('spirit of the puma'), 'switching back lost the original profile\'s own gems');
});

test('each profile keeps its own memorized picture independently', () => {
  const store = fakeStore();
  const eng = newEngine(store);
  eng.handleLine(memLine('Spirit of the Puma'));
  eng.setActiveProfileId('bard-loadout');
  eng.handleLine(memLine("Selo's Accelerando"));

  assert.ok(eng.currentlyMemorized.has("selo's accelerando"));
  assert.ok(!eng.currentlyMemorized.has('spirit of the puma'), 'the other profile\'s gem leaked into this one');

  eng.setActiveProfileId(DEFAULT_PROFILE_ID);
  assert.ok(eng.currentlyMemorized.has('spirit of the puma'));
  assert.ok(!eng.currentlyMemorized.has("selo's accelerando"), 'this profile\'s picture was polluted by the other one');
});

test('per-profile memorized state persists and reloads correctly', () => {
  const store = fakeStore();
  const eng = newEngine(store);
  eng.handleLine(memLine('Spirit of the Puma'));
  eng.setActiveProfileId('bard-loadout');
  eng.handleLine(memLine("Selo's Accelerando"));

  const reloaded = newEngine(store);
  reloaded.setActiveProfileId(DEFAULT_PROFILE_ID);
  assert.ok(reloaded.currentlyMemorized.has('spirit of the puma'));
  reloaded.setActiveProfileId('bard-loadout');
  assert.ok(reloaded.currentlyMemorized.has("selo's accelerando"));
});

test('an old flat currentlyMemorized save migrates into the default profile\'s bucket', () => {
  const store = fakeStore({ currentlyMemorized: [['spirit of the puma', 'Spirit of the Puma']] });
  const eng = newEngine(store);
  assert.ok(eng.currentlyMemorized.has('spirit of the puma'), 'legacy flat-format save was not migrated');
  eng.setActiveProfileId('bard-loadout');
  assert.equal(eng.currentlyMemorized.size, 0, 'a profile that never existed under the legacy format should start empty');
});

test('removing the active profile clears currentlyMemorized rather than leaving it stale', () => {
  const store = fakeStore();
  const eng = newEngine(store);
  eng.setActiveProfileId('bard-loadout');
  eng.handleLine(memLine("Selo's Accelerando"));
  eng.removeProfile('bard-loadout');
  assert.equal(eng.currentlyMemorized.size, 0, 'deleting the active profile left its old memorized map still wired in');
});

module.exports = () => report('memorized-per-profile');
if (require.main === module) process.exit(report('memorized-per-profile') ? 1 : 0);
