'use strict';
/**
 * Loadout-locked zones (owner, 4 Sep). In a dungeon / raid-group instance a full loadout swap is
 * impossible, so a gem's memorise/forget line - normally weak evidence, because a swap prints
 * nothing (buffEngine gotcha #9/#16) - is TRUTH there. The owner's rule:
 *
 *   truth WHILE inside; weak the moment you leave; re-entering does NOT reinstate the old evidence
 *   (step out, swap loadout with no log line, step back in) - it regenerates from what's seen.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');
const { isLoadoutLockedZone } = require('../src/shared/loadoutLockedZones');

function makeEngine() {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const buffStore = new BuffStore(store);
  const engine = new BuffEngine(buffStore, store);
  engine.stop();
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  return { engine, buffStore, log };
}
const names = (e) => e.getActiveBuffs().map((b) => b.name).sort();

test('isLoadoutLockedZone: instance suffix, known dungeon, open world', () => {
  assert.equal(isLoadoutLockedZone('The Plane of Hate - Group 4 (Refined)'), true);
  assert.equal(isLoadoutLockedZone('The Permafrost Caverns - Group'), true);
  assert.equal(isLoadoutLockedZone("Nagafen's Lair 1 (Awakened)"), true);
  assert.equal(isLoadoutLockedZone('The Plane of Hate'), true, 'a named-board zone is a raid/dungeon zone');
  assert.equal(isLoadoutLockedZone('The Castle of Mistmoore'), true);
  assert.equal(isLoadoutLockedZone('The Oasis of Marr'), false);
  assert.equal(isLoadoutLockedZone('East Freeport'), false);
  assert.equal(isLoadoutLockedZone(''), false);
  assert.equal(isLoadoutLockedZone(null), false);
});

test('a memorise inside a locked zone is trusted; leaving clears it; re-entry does not reinstate it', () => {
  const { engine } = makeEngine();
  const song = engine.buffStore.getAll().find((e) => e.isBardSong && e.landingText);
  assert.ok(song, 'need a bard song fixture');

  engine.setLoadoutLocked(true, 'The Plane of Hate');
  engine.handleLine(`You have finished memorizing ${song.name}.`);
  assert.ok(engine._gemVerified.has(song.name.toLowerCase()), 'memorised while locked = verified');

  engine.setLoadoutLocked(false, 'The Oasis of Marr'); // stepped out
  assert.equal(engine._gemVerified.size, 0, 'leaving downgrades it immediately');

  engine.setLoadoutLocked(true, 'The Plane of Hate'); // stepped back in (maybe swapped loadout meanwhile)
  assert.equal(engine._gemVerified.size, 0, 're-entry must NOT reinstate the old evidence');

  engine.handleLine(`You have finished memorizing ${song.name}.`); // re-mem inside
  assert.ok(engine._gemVerified.has(song.name.toLowerCase()), 'a fresh memorise inside rebuilds it');
});

test('a verified gem attributes a bard song to You even over a stale mob cast (gotcha #31 case)', () => {
  const { engine } = makeEngine();
  const known = { name: "Selo's Accelerating Chorus", targets: 'Group', isBardSong: true };

  engine.handleLine("Enro begins singing Selo's Accelerating Chorus."); // a mob, no expiry on recentOtherCasts
  assert.equal(engine._attributeBardSongCaster(known.name, known), 'Enro', 'without the verified gem, the mob wins');

  engine.setLoadoutLocked(true, 'The Plane of Hate');
  engine.handleLine(`You have finished memorizing ${known.name}.`);
  assert.equal(engine._attributeBardSongCaster(known.name, known), 'You', 'her verified gem wins');
});

test('a verified gem resolves an ambiguous self-landing the spellbook cannot', () => {
  const { engine, buffStore, log } = makeEngine();
  // find a landing text shared by 2+ spells, at least one a plausible self buff
  let picked = null;
  const byText = {};
  for (const e of buffStore.getAll()) {
    if (!e.landingText || e.kind === 'det') continue;
    (byText[e.landingText] = byText[e.landingText] || []).push(e);
    if (byText[e.landingText].length === 2 && !picked) picked = byText[e.landingText];
  }
  assert.ok(picked, 'need a shared landing text');
  const [a] = picked;

  engine.setSpellbookCheckFn(() => false); // spellbook narrows nothing
  engine.setLoadoutLocked(true, 'The Plane of Hate');
  engine.handleLine(`You have finished memorizing ${a.name}.`);
  engine.handleLine(a.landingText);

  assert.deepEqual(names(engine), [a.name], 'the verified gem picked the right one');
  assert.ok(log.some((m) => m.includes('loadout-locked zone')));
});

test('a profile switch (a loadout swap) clears the verified gems', () => {
  const { engine } = makeEngine();
  const song = engine.buffStore.getAll().find((e) => e.isBardSong);
  engine.setLoadoutLocked(true, 'The Plane of Hate');
  engine.handleLine(`You have finished memorizing ${song.name}.`);
  assert.equal(engine._gemVerified.size, 1);
  engine.setActiveProfileId('some-other-profile');
  assert.equal(engine._gemVerified.size, 0);
});

module.exports = () => report('loadout-locked-zones');
if (require.main === module) report('loadout-locked-zones').then((n) => process.exit(n ? 1 : 0));
