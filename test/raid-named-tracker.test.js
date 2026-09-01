'use strict';
/**
 * RaidNamedTracker (backlog #33) - a per-zone named-kill board. Enter a raid zone, every named is
 * "up"; a "<name> has been slain by ..." line greys it out; re-entering (a fresh instance) rebuilds
 * the board. A zone flagged `respawns` shows a countdown on a greyed named and brings it back.
 *
 * Owner's spec: "you go into a raid zone, all named are active. it's not a loot tracker, it's just
 * a named kill tracker. it can show a timer if it has one and the zone is respawning (raids and
 * plane instances are not)."
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { RaidNamedTracker, stripInstanceSuffix, bareName } = require('../src/main/raidNamedTracker');
const { RAID_ZONE_NAMEDS } = require('../src/shared/data/raidZoneNameds');

const TS = '[Wed Aug 19 19:23:03 2026] ';
const enter = (t, z) => t.handleLine(`${TS}You have entered ${z}.`);
const slay = (t, n) => t.handleLine(`${TS}${n} has been slain by Baxa!`);

function make() {
  const t = new RaidNamedTracker();
  clearInterval(t.tickTimer); // tests drive the clock
  const log = [];
  t.setDebugLogFn((m) => log.push(m));
  return { t, log };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

test('stripInstanceSuffix reduces every difficulty to the base zone', () => {
  assert.equal(stripInstanceSuffix('The Plane of Hate - Group 3 (Fused)'), 'The Plane of Hate');
  assert.equal(stripInstanceSuffix('The Plane of Hate - Group'), 'The Plane of Hate');
  assert.equal(stripInstanceSuffix("Nagafen's Lair 1 (Awakened)"), "Nagafen's Lair");
  assert.equal(stripInstanceSuffix('The Plane of Sky'), 'The Plane of Sky'); // already base
});

test('bareName drops a leading article, case-insensitively', () => {
  assert.equal(bareName('A dracoliche'), 'dracoliche');
  assert.equal(bareName('dracoliche'), 'dracoliche');
  assert.equal(bareName('The Spiroc Lord'), 'spiroc lord');
});

// ---------------------------------------------------------------------------
// the board
// ---------------------------------------------------------------------------

test('entering a raid zone puts every named up', () => {
  const { t } = make();
  enter(t, 'The Plane of Fear');
  const rows = t.getActive();
  assert.equal(rows.length, RAID_ZONE_NAMEDS['The Plane of Fear'].nameds.length);
  assert.ok(rows.every((r) => r.killed === false));
  assert.ok(rows.some((r) => r.name === 'Cazic-Thule'));
});

test('the two Voidling raid zones added 31 Aug have working boards', () => {
  const { t } = make();
  enter(t, 'The Ruins of Old Paineel');
  let rows = t.getActive();
  assert.ok(rows.some((r) => r.name === 'Master Yael'));
  slay(t, 'Master Yael');
  assert.equal(t.getActive().filter((r) => r.killed).length, 1);

  enter(t, 'Kedge Keep 2 (Fused)'); // instance suffix still resolves
  assert.equal(t.getCurrentZone(), 'Kedge Keep');
  assert.ok(t.getActive().some((r) => r.name === 'Phinigel Autropos' && r.killed === false));
});

// #33's actual scope: every tracked zone, not just raids. Dungeons too.
test('a dungeon zone board works, and open-world nameds respawn on their timer', () => {
  const { t } = make();
  enter(t, 'The Castle of Mistmoore'); // instanced -> respawns:false
  assert.ok(t.getActive().some((r) => r.name === 'Xicotl' && r.tier === 'boss'));
  slay(t, 'Xicotl');
  const x = t.getActive().find((r) => r.name === 'Xicotl');
  assert.equal(x.killed, true);
  assert.equal(x.respawnRemainingSec, null, 'an instanced zone kill stays down until re-entry');

  enter(t, 'Najena'); // open-world -> respawns:true
  slay(t, 'Rathyl'); // respawnMinutes 19
  const r = t.getActive().find((row) => row.name === 'Rathyl');
  assert.equal(r.killed, true);
  assert.ok(r.respawnRemainingSec > 19 * 60 - 5 && r.respawnRemainingSec <= 19 * 60);
});

test('the board sorts boss, then mini, then lesser', () => {
  const { t } = make();
  enter(t, 'Najena');
  const tiers = t.getActive().map((r) => r.tier);
  const firstMini = tiers.indexOf('mini');
  const firstLesser = tiers.indexOf('lesser');
  assert.equal(tiers[0], 'boss');
  assert.ok(firstMini < firstLesser, 'minis should come before lesser trash');
  assert.ok(tiers.slice(0, firstLesser).every((x) => x !== 'lesser'));
});

test('an instance difficulty resolves to the same board', () => {
  const { t } = make();
  enter(t, 'The Plane of Hate - Group 4 (Refined)');
  assert.equal(t.getCurrentZone(), 'The Plane of Hate');
  assert.ok(t.getActive().length > 0);
});

test('a kill greys exactly that named, article-tolerant', () => {
  const { t } = make();
  enter(t, 'The Plane of Fear');
  slay(t, 'a dracoliche'); // logged lowercase; data has "A dracoliche"
  const drac = t.getActive().find((r) => r.name === 'A dracoliche');
  assert.equal(drac.killed, true);
  assert.equal(t.getActive().filter((r) => r.killed).length, 1, 'only the one named should be down');
});

test('bosses sort ahead of minis', () => {
  const { t } = make();
  enter(t, 'The Plane of Hate');
  const rows = t.getActive();
  const firstMini = rows.findIndex((r) => r.tier === 'mini');
  const lastBoss = rows.map((r) => r.tier).lastIndexOf('boss');
  assert.ok(lastBoss < firstMini, 'a mini appeared before a boss');
});

test("Nagafen's Lair is the group dungeon, not the moved-out Lord Nagafen raid", () => {
  const { t } = make();
  enter(t, "Nagafen's Lair 4 (Refined)");
  const names = t.getActive().map((r) => r.name);
  assert.ok(names.includes('Efreeti Lord Djarn'), 'the real dungeon boss is on the board');
  assert.ok(!names.includes('Lord Nagafen'), 'the raid boss lives in his own Voidling instance now');
});

test('a kill in a zone the board does not know is ignored', () => {
  const { t } = make();
  enter(t, "Nagafen's Lair");
  slay(t, 'Cazic-Thule'); // wrong zone
  assert.equal(t.getActive().filter((r) => r.killed).length, 0);
});

test('a trash mob death does not grey anything', () => {
  const { t } = make();
  enter(t, "Nagafen's Lair");
  slay(t, 'a greater kobold');
  slay(t, 'a lava beetle');
  assert.equal(t.getActive().filter((r) => r.killed).length, 0);
});

test('re-entering the zone is a fresh instance - the board resets', () => {
  const { t } = make();
  enter(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  assert.equal(t.getActive().find((r) => r.name === 'Efreeti Lord Djarn').killed, true);
  enter(t, "Nagafen's Lair 2 (Adaptive)");
  assert.equal(t.getActive().find((r) => r.name === 'Efreeti Lord Djarn').killed, false, 'a fresh instance kept the kill');
});

test('leaving for an untracked zone clears the board', () => {
  const { t } = make();
  enter(t, 'The Plane of Fear');
  enter(t, 'East Freeport');
  assert.deepEqual(t.getActive(), []);
  assert.equal(t.getCurrentZone(), null);
});

test('killing the same named twice does not double-fire', () => {
  const { t, log } = make();
  enter(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  const changes = log.filter((m) => m.includes('killed')).length;
  slay(t, 'Efreeti Lord Djarn'); // an echo, or the corpse re-reported
  assert.equal(log.filter((m) => m.includes('killed')).length, changes, 'a second kill line fired again');
});

test('a "You have slain X!" line also greys the named', () => {
  const { t } = make();
  enter(t, 'The Plane of Fear');
  t.handleLine(`${TS}You have slain Terror!`);
  assert.equal(t.getActive().find((r) => r.name === 'Terror').killed, true);
});

// ---------------------------------------------------------------------------
// respawn (synthetic - no shipped zone has respawns:true)
// ---------------------------------------------------------------------------

test('a respawning zone shows a countdown and brings the named back', () => {
  const { t } = make();
  RAID_ZONE_NAMEDS.__TEST_ZONE__ = {
    shortName: 'test', respawns: true,
    nameds: [{ name: 'Testboss', tier: 'boss', respawnMinutes: 1 }],
  };
  try {
    enter(t, '__TEST_ZONE__');
    slay(t, 'Testboss');
    const row = t.getActive()[0];
    assert.equal(row.killed, true);
    assert.ok(row.respawnRemainingSec > 0 && row.respawnRemainingSec <= 60);
    // force the respawn moment past and tick
    t.board.get('testboss').respawnAt = Date.now() - 10;
    t._tick();
    assert.equal(t.getActive()[0].killed, false, 'the named never came back');
  } finally {
    delete RAID_ZONE_NAMEDS.__TEST_ZONE__;
  }
});

test('a non-respawning zone leaves the kill greyed with no countdown', () => {
  const { t } = make();
  enter(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  const row = t.getActive().find((r) => r.name === 'Efreeti Lord Djarn');
  assert.equal(row.killed, true);
  assert.equal(row.respawnRemainingSec, null);
});

module.exports = () => report('raid-named-tracker');
if (require.main === module) report('raid-named-tracker').then((n) => process.exit(n ? 1 : 0));
