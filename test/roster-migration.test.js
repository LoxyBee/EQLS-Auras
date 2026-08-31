'use strict';
/**
 * Tests that the install is the source of truth for spell data, every launch.
 *
 * Replaces a version-gated one-time-upgrade design (STARTER_VERSION plus half a dozen boolean
 * "have I already migrated this" flags in buffsMeta.json) that looked safe and was not: a roster
 * correction (Alacrity's duration, 24 Aug) reached a fresh install fine and did nothing at all
 * for an already-seeded one, because a normal roster entry ships WITH
 * landingText/endedText/iconId from day one, so it never looked "untouched" to that design's
 * refresh heuristic and sat wrong forever. Vaela: "it should be seeded from the install not the
 * person's saved files because it interrupts old installs and doesn't allow live updates."
 *
 * The new rule, and what has to hold for each part of it:
 *   1. a non-custom, non-edited entry is rebuilt from the install FRESH, every construction - no
 *      version number, no "have I done this before" flag anywhere.
 *   2. a buff the user typed in themselves (custom: true) is the install's only copy and is never
 *      touched.
 *   3. a spell the user has hand-corrected through Known Buffs (`edited: true`, set by upsert())
 *      is also never touched again - the user's word beats the install's from that point on.
 *   4. three small per-spell toggles with no install-side value to defer to - showOnOverlay,
 *      isBardSong (once isBardSongUserSet), noDurationScaling (once noDurationScalingUserSet) -
 *      survive the rebuild regardless of which of the three cases above the entry falls into.
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
// What the constructor actually keeps from BUNDLED - one entry short of the raw file's count,
// because MAX_TRACKABLE_DURATION_SEC excludes anything over 5 hours (see buffStore.js) on every
// construction now, not just once. Computed here rather than hardcoded so this file does not need
// updating every time the roster gains or loses another over-long entry.
const TRACKABLE_COUNT = BUNDLED.filter((b) => !(b.durationSec > 5 * 3600)).length;

/** In-memory stand-in for src/main/store.js. */
function fakeStore(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  return {
    data,
    loadJson: (name, fallback) => (name in data ? JSON.parse(JSON.stringify(data[name])) : fallback),
    saveJson: (name, value) => { data[name] = JSON.parse(JSON.stringify(value)); },
  };
}

/** A plausible real-world store: every roster entry seeded, a hand-made buff, an overlay choice. */
function seededStore() {
  const survivor = BUNDLED.find((e) => e.name === 'Spirit of the Puma');
  assert.ok(survivor, 'expected Spirit of the Puma in the bundled roster');
  return fakeStore({
    buffs: [
      ...BUNDLED.map((e) =>
        e.name === survivor.name ? { ...e, custom: false, showOnOverlay: false } : { ...e, custom: false }
      ),
      // spells from an earlier, larger roster this server does not carry any more
      { name: 'Talisman of the Panther', durationSec: 1800, landingText: 'Ancient text.', iconId: 5, custom: false },
      { name: "Ancient: Lcea's Lament", durationSec: 600, landingText: 'Old text.', iconId: 6, custom: false },
      // something the user made themselves
      { name: 'My Custom Timer', durationSec: 42, landingText: 'You feel tested.', custom: true },
    ],
  });
}

test('no stray extra keys are written into userData', () => {
  const store = seededStore();
  const before = Object.keys(store.data).slice().sort();
  new BuffStore(store);
  const added = Object.keys(store.data).filter((k) => !before.includes(k));
  assert.deepEqual(added, [], `construction wrote extra keys into userData: ${added.join(', ')}`);
});

test('a spell no longer in the install roster is dropped, not kept around forever', () => {
  const store = seededStore();
  const bs = new BuffStore(store);
  // +1 for the user's custom buff, which is kept
  assert.equal(bs.buffs.length, TRACKABLE_COUNT + 1, 'roster size suggests old entries survived');
  const names = new Set(bs.buffs.map((b) => b.name));
  assert.ok(!names.has('Talisman of the Panther'), 'a spell this server does not have survived');
  assert.ok(!names.has("Ancient: Lcea's Lament"), 'a spell this server does not have survived');
});

test('buffs the user made themselves survive', () => {
  const store = seededStore();
  const bs = new BuffStore(store);
  const mine = bs.buffs.find((b) => b.name === 'My Custom Timer');
  assert.ok(mine, 'a hand-made buff was deleted');
  assert.equal(mine.durationSec, 42, 'a hand-made buff lost its duration');
  assert.equal(mine.custom, true, 'a hand-made buff lost its custom flag and will vanish from the Custom Buffs list');
});

test('a "show on overlay" choice survives for a spell that stays in the roster', () => {
  const store = seededStore();
  const bs = new BuffStore(store);
  const puma = bs.buffs.find((b) => b.name === 'Spirit of the Puma');
  assert.ok(puma, 'a spell present in the roster went missing');
  assert.equal(puma.showOnOverlay, false, "the user's overlay choice was reset");
  // ...and it took the install's current data, not whatever the store happened to have saved
  assert.equal(puma.spellId != null, true, 'the surviving entry kept old data instead of the install roster');
});

test('rebuilding twice in a row gives an identical result', () => {
  const store = seededStore();
  new BuffStore(store);
  const afterFirst = JSON.parse(JSON.stringify(store.data.buffs));
  new BuffStore(store);
  assert.deepEqual(store.data.buffs, afterFirst, 'a second construction changed the roster');
});

test('a fresh install just seeds, with nothing left behind from the old design', () => {
  const store = fakeStore({});
  const bs = new BuffStore(store);
  assert.equal(bs.buffs.length, TRACKABLE_COUNT, 'a fresh install did not seed the bundled roster cleanly');
  assert.ok(!store.data.buffsMeta, 'a fresh install wrote a buffsMeta file the new design has no use for');
  assert.equal(store.data.buffs.length, TRACKABLE_COUNT);
});

// ---------------------------------------------------------------------------
// The install always wins for anything not explicitly overridden (24 Aug)
// ---------------------------------------------------------------------------

// A store shaped like a real install that was seeded before a roster correction shipped: every
// entry has its own full text/icon already (so nothing "looks untouched"), and one entry
// (Alacrity) carries a stale number the install has since corrected.
function staleInstallStore(staleDurationSec) {
  const alacrity = BUNDLED.find((e) => e.name === 'Alacrity');
  assert.ok(alacrity, 'expected Alacrity in the bundled roster');
  return fakeStore({
    buffs: BUNDLED.map((e) =>
      e.name === 'Alacrity' ? { ...e, durationSec: staleDurationSec, custom: false } : { ...e, custom: false }
    ),
  });
}

test('a stale field reaches an already-seeded install on the very next launch', () => {
  const store = staleInstallStore(660);
  const bs = new BuffStore(store);
  const alacrity = bs.buffs.find((b) => b.name === 'Alacrity');
  const bundled = BUNDLED.find((e) => e.name === 'Alacrity');
  assert.equal(alacrity.durationSec, bundled.durationSec, "the corrected duration never reached the seeded copy");
});

test('the rebuild leaves every other entry untouched', () => {
  const store = staleInstallStore(660);
  const before = JSON.parse(JSON.stringify(store.data.buffs));
  const bs = new BuffStore(store);
  const changedNames = bs.buffs
    .filter((after) => {
      const b = before.find((x) => x.name === after.name);
      return b && JSON.stringify(b) !== JSON.stringify(after);
    })
    .map((b) => b.name);
  assert.deepEqual(changedNames, ['Alacrity'], 'the rebuild touched entries other than the one that changed');
});

test('a custom entry is never touched by the rebuild, even if it shares a name with a roster spell', () => {
  const store = staleInstallStore(660);
  store.data.buffs.push({
    name: 'Not A Real Spell',
    durationSec: 999,
    landingText: 'You feel typed in.',
    iconId: 1,
    custom: true,
  });
  new BuffStore(store);
  const mine = store.data.buffs.find((b) => b.name === 'Not A Real Spell');
  assert.equal(mine.durationSec, 999, "a custom entry's own duration was overwritten");
});

test('MAX_TRACKABLE_DURATION_SEC still excludes an absurd duration, applied to the install roster directly', () => {
  // Regression for the old one-time purge, which only ever ran once against whatever the roster
  // looked like at that moment - an entry that reached the roster LATER would slip through
  // forever. The exclusion now lives in the constructor itself, so it applies to the install's
  // roster on every single launch no matter when an over-long entry shows up in it.
  const store = fakeStore({});
  const bs = new BuffStore(store);
  const tooLong = bs.buffs.find((b) => b.durationSec > 5 * 3600);
  assert.equal(tooLong, undefined, 'an entry over the trackable-duration ceiling reached this.buffs');
});

// ---------------------------------------------------------------------------
// The three things that have no install-side value to fall back on
// ---------------------------------------------------------------------------

test('a manual bard-song correction survives a rebuild, including the FALSE direction', () => {
  const store = staleInstallStore(660);
  const bs1 = new BuffStore(store);
  // Pick a spell the install roster does NOT mark as a bard song, so a manual "no" is
  // distinguishable from "nobody ever tagged it".
  const target = bs1.buffs.find((b) => !b.isBardSong);
  assert.ok(target, 'expected at least one non-bard-song entry in the roster');
  bs1.setBardSong(target.name, true);
  bs1.setBardSong(target.name, false); // the actual correction under test
  const bs2 = new BuffStore(store);
  const after = bs2.buffs.find((b) => b.name === target.name);
  assert.equal(after.isBardSong, false, 'a manual "not a bard song" correction was lost on rebuild');
  assert.equal(after.isBardSongUserSet, true, 'the override marker itself did not survive the rebuild');
});

test('automatic bard-song evidence (no manual override) survives a rebuild too', () => {
  const store = staleInstallStore(660);
  const bs1 = new BuffStore(store);
  const target = bs1.buffs.find((b) => !b.isBardSong);
  bs1.markBardSong(target.name);
  const bs2 = new BuffStore(store);
  const after = bs2.buffs.find((b) => b.name === target.name);
  assert.equal(after.isBardSong, true, 'automatically observed bard-song evidence was lost on rebuild');
});

test('a manual "no AA scaling" correction survives a rebuild, including turning it back off', () => {
  const store = staleInstallStore(660);
  const bs1 = new BuffStore(store);
  const target = bs1.buffs.find((b) => !b.noDurationScaling);
  assert.ok(target, 'expected at least one AA-scaling-eligible entry in the roster');
  bs1.setNoDurationScaling(target.name, true);
  const bs2 = new BuffStore(store);
  const afterOn = bs2.buffs.find((b) => b.name === target.name);
  assert.equal(afterOn.noDurationScaling, true, 'a manual "no AA scaling" correction was lost on rebuild');

  bs2.setNoDurationScaling(target.name, false);
  const bs3 = new BuffStore(store);
  const afterOff = bs3.buffs.find((b) => b.name === target.name);
  assert.equal(!!afterOff.noDurationScaling, false, 'turning the correction back off was lost on rebuild');
});

// ---------------------------------------------------------------------------
// upsert() and the `edited` flag - the one case where the install stops being trusted
// ---------------------------------------------------------------------------

test('editing a real roster spell through Known Buffs freezes it against future install updates', () => {
  const store = staleInstallStore(660); // Alacrity is stale here, but this test edits a different spell
  const bs1 = new BuffStore(store);
  const target = bs1.buffs.find((b) => b.name !== 'Alacrity' && !b.custom);
  bs1.upsert(target.name, 12345, { landingText: 'A hand-typed landing line.' });

  const bs2 = new BuffStore(store);
  const after = bs2.buffs.find((b) => b.name === target.name);
  assert.equal(after.durationSec, 12345, "the user's manual correction was overwritten by the install's own data");
  assert.equal(after.edited, true, 'the entry was not flagged as edited');

  // And Alacrity, untouched by hand, still gets the install's own correction on this same launch.
  const alacrity = bs2.buffs.find((b) => b.name === 'Alacrity');
  assert.equal(alacrity.durationSec, BUNDLED.find((e) => e.name === 'Alacrity').durationSec);
});

test('toggling "Overlay" on a real roster spell does NOT freeze it - only a genuine data edit does', () => {
  const store = staleInstallStore(660);
  const bs1 = new BuffStore(store);
  const target = bs1.buffs.find((b) => b.name !== 'Alacrity' && !b.custom);
  bs1.setShowOnOverlay(target.name, false);

  const bs2 = new BuffStore(store);
  const after = bs2.buffs.find((b) => b.name === target.name);
  assert.equal(after.edited, undefined, 'a plain overlay toggle incorrectly marked the entry as edited');
  assert.equal(after.showOnOverlay, false, 'the overlay choice itself did not survive');
});

test('once edited, a later save that touches fewer fields does not un-edit the entry', () => {
  const store = staleInstallStore(660);
  const bs1 = new BuffStore(store);
  const target = bs1.buffs.find((b) => b.name !== 'Alacrity' && !b.custom);
  bs1.upsert(target.name, 12345, { landingText: 'A hand-typed landing line.' });
  // A later save that only touches showOnOverlay, same shape as setShowOnOverlay's own call.
  bs1.upsert(target.name, 12345, { showOnOverlay: false });

  const bs2 = new BuffStore(store);
  const after = bs2.buffs.find((b) => b.name === target.name);
  assert.equal(after.edited, true, 'a follow-up save with fewer fields quietly un-froze the entry');
  assert.equal(after.durationSec, 12345, 'the earlier manual correction was lost');
});

module.exports = () => report('roster-migration');
if (require.main === module) report('roster-migration').then((n) => process.exit(n ? 1 : 0));
