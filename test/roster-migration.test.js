'use strict';
/**
 * Tests the one-time migration that adopts the EQ Legends roster.
 *
 * This is the highest-risk code in the rebuild: it replaces the spell roster in a real user's
 * saved data, it runs inside a constructor before any window exists, and if it gets something
 * wrong there is no error - buffs just stop being recognised, or hand-made ones vanish.
 *
 * The three things that must hold, in order of how bad it is to get them wrong:
 *   1. buffs the user made themselves survive
 *   2. per-buff "show on overlay" choices survive for spells that exist in both rosters
 *   3. it replaces rather than merges, and runs exactly once
 *
 * BuffStore takes its persistence as a constructor argument, so all of this can be driven with a
 * plain in-memory fake - no Electron, no temp files, no mocking framework.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');

const BUNDLED = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'data', 'buffs.json'), 'utf8')
);

/** In-memory stand-in for src/main/store.js. */
function fakeStore(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  return {
    data,
    loadJson: (name, fallback) => (name in data ? JSON.parse(JSON.stringify(data[name])) : fallback),
    saveJson: (name, value) => { data[name] = JSON.parse(JSON.stringify(value)); },
  };
}

/** A plausible pre-migration store: old mined entries, a hand-made buff, and an overlay choice. */
function legacyStore() {
  const survivor = BUNDLED.find((e) => e.name === 'Spirit of the Puma');
  assert.ok(survivor, 'expected Spirit of the Puma in the bundled roster');
  return fakeStore({
    buffs: [
      // a spell that exists in BOTH rosters, with the user's overlay choice turned off
      { name: survivor.name, durationSec: 60, landingText: survivor.landingText, iconId: 2, showOnOverlay: false },
      // spells from other EverQuest versions that this server does not have
      { name: 'Talisman of the Panther', durationSec: 1800, landingText: 'Ancient text.', iconId: 5 },
      { name: 'Ancient: Lcea\'s Lament', durationSec: 600, landingText: 'Old text.', iconId: 6 },
      // something the user made themselves
      { name: 'My Custom Timer', durationSec: 42, landingText: 'You feel tested.', custom: true },
    ],
    buffsMeta: { starterVersion: 6, customMigrated: true },
  });
}

test('no copy of the old roster is written into userData', () => {
  // The retired roster lives in the repository at archive/buffs-legacy-11337.json, outside src/
  // so it never ships. Duplicating 2.5 MB of it into every user's app data would be clutter,
  // and this test stops that creeping back in.
  const store = legacyStore();
  const before = Object.keys(store.data).slice().sort();
  new BuffStore(store);
  const added = Object.keys(store.data).filter((k) => !before.includes(k));
  assert.deepEqual(added, [], `the migration wrote extra keys into userData: ${added.join(', ')}`);
});

test('the roster is replaced, not merged', () => {
  const store = legacyStore();
  const bs = new BuffStore(store);
  // +1 for the user's custom buff, which is kept
  assert.equal(bs.buffs.length, BUNDLED.length + 1, 'roster size suggests a merge rather than a replace');
  const names = new Set(bs.buffs.map((b) => b.name));
  assert.ok(!names.has('Talisman of the Panther'), 'a spell this server does not have survived the migration');
  assert.ok(!names.has("Ancient: Lcea's Lament"), 'a spell this server does not have survived the migration');
});

test("buffs the user made themselves survive", () => {
  const store = legacyStore();
  const bs = new BuffStore(store);
  const mine = bs.buffs.find((b) => b.name === 'My Custom Timer');
  assert.ok(mine, 'a hand-made buff was deleted by the migration');
  assert.equal(mine.durationSec, 42, 'a hand-made buff lost its duration');
  assert.equal(mine.custom, true, 'a hand-made buff lost its custom flag and will vanish from the Custom Buffs list');
});

test('a "show on overlay" choice survives for a spell in both rosters', () => {
  const store = legacyStore();
  const bs = new BuffStore(store);
  const puma = bs.buffs.find((b) => b.name === 'Spirit of the Puma');
  assert.ok(puma, 'a spell present in both rosters went missing');
  assert.equal(puma.showOnOverlay, false, 'the user\'s overlay choice was reset by the migration');
  // ...and it took the new roster's data, not the old entry's
  assert.equal(puma.spellId != null, true, 'the surviving entry kept old data instead of adopting the new roster');
});

test('it runs exactly once', () => {
  const store = legacyStore();
  new BuffStore(store);
  const afterFirst = JSON.parse(JSON.stringify(store.data.buffs));

  // Simulate a later launch: same store, migration flag already set.
  new BuffStore(store);
  assert.deepEqual(store.data.buffs, afterFirst, 'the migration ran a second time and changed the roster again');
  assert.equal(store.data.buffsMeta.eqlRosterV1, true);
});

test('a fresh install is unaffected and just seeds', () => {
  const store = fakeStore({});
  const bs = new BuffStore(store);
  assert.equal(bs.buffs.length, BUNDLED.length, 'a fresh install did not seed the bundled roster cleanly');
  assert.ok(!store.data['buffs-backup-before-eql-roster'], 'a fresh install wrote a pointless backup of nothing');
  assert.equal(store.data.buffs.length, BUNDLED.length);
});

test('the migration records what it did', () => {
  const store = legacyStore();
  new BuffStore(store);
  const stats = store.data.buffsMeta.eqlRosterV1Stats;
  assert.ok(stats, 'no record of what the migration did - impossible to diagnose later');
  assert.equal(stats.replaced, BUNDLED.length);
  assert.equal(stats.keptCustom, 1);
});

module.exports = () => report('roster-migration');
if (require.main === module) process.exit(report('roster-migration') ? 1 : 0);
