'use strict';
/**
 * RaidNamedTracker (backlog #33) - a per-zone named-kill board.
 *
 * TWO kinds of tracked zone (see raidZoneNameds.js):
 *   - a DUNGEON entry (no `raid` flag): the board lights up on a plain "You have entered X." line,
 *     the way #33 originally asked for - "every tracked zone, not just raids".
 *   - a RAID entry (`raid: true` - the Planes, and the classic raid-boss lists): the board lights
 *     up for the raid-lockout instance, which the zone string's own " - Group" marker names
 *     directly - corrected 13 Sep after the owner's own correction and a full week of real logs
 *     checked line by line: every " - Group" zone entry has a Voidling hail within seconds of it,
 *     every entry without one has none nearby (or one hours old and unrelated). The player's own
 *     "You say, 'danger'" is kept as a fallback signal (isGroupInstance() ORs it in), but it is not
 *     the gate any more - it used to be the ONLY one, which missed every time someone ELSE formed
 *     the raid and just invited this player in, or a reconnect landed back in one with no fresh
 *     hail. lockoutCore's own weekly-attempt tracking is separate and untouched - it correctly
 *     still requires the PLAYER's own hail, because an attempt is about who asked for the weekly.
 *
 * A "<name> has been slain by ..." line greys a named; re-entering rebuilds the board.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { RaidNamedTracker, stripInstanceSuffix, bareName } = require('../src/main/raidNamedTracker');
const { RAID_ZONE_NAMEDS } = require('../src/shared/data/raidZoneNameds');

const TS = '[Wed Aug 19 19:23:03 2026] ';
const sayDanger = (t) => t.handleLine(`${TS}You say, 'danger'`);
// A RAID entry: the player's own "danger" to the Voidling, then the zone change - into the
// raid-lockout instance, which the real game marks with its own " - Group" suffix (see
// GROUP_INSTANCE_RE in raidNamedTracker.js). The hail is kept here for flavor/realism, but what
// actually makes this a raid entry post-13-Sep is the "- Group" the helper inserts below, not the
// hail line - callers that want a NON-raid entry into the same zone use enterOpen() instead.
const enter = (t, z) => {
  sayDanger(t);
  const raidZone = /^(.*?)( \d+ \([^)]+\))?$/.exec(z);
  const withGroup = raidZone[2] ? `${raidZone[1]} - Group${raidZone[2]}` : `${z} - Group`;
  t.handleLine(`${TS}You have entered ${withGroup}.`);
};
// A DUNGEON / open / untracked entry: a plain zone line, no Voidling dialogue.
const enterOpen = (t, z) => t.handleLine(`${TS}You have entered ${z}.`);
const slay = (t, n) => t.handleLine(`${TS}${n} has been slain by Avenrae!`);

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

test('a Voidling raid entry puts every named up', () => {
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
  assert.ok(t.getActive().some((r) => r.name === 'Master Yael'));
  slay(t, 'Master Yael');
  assert.equal(t.getActive().filter((r) => r.killed).length, 1);

  enter(t, 'Kedge Keep 2 (Fused)'); // instance suffix still resolves
  assert.equal(t.getCurrentZone(), 'Kedge Keep');
  assert.ok(t.getActive().some((r) => r.name === 'Phinigel Autropos' && r.killed === false));
});

// #33's actual scope: every tracked zone, not just raids. A dungeon board needs no "danger" line.
test('a dungeon board lights up on a plain zone line, no Voidling dialogue', () => {
  const { t } = make();
  enterOpen(t, 'The Castle of Mistmoore'); // instanced -> respawns:false
  assert.ok(t.getActive().some((r) => r.name === 'Xicotl' && r.tier === 'boss'));
  slay(t, 'Xicotl');
  const x = t.getActive().find((r) => r.name === 'Xicotl');
  assert.equal(x.killed, true);
  assert.equal(x.respawnRemainingSec, null, 'an instanced zone kill stays down until re-entry');

  enterOpen(t, 'Najena'); // open-world -> respawns:true
  slay(t, 'Rathyl'); // respawnMinutes 19
  const r = t.getActive().find((row) => row.name === 'Rathyl');
  assert.equal(r.killed, true);
  assert.ok(r.respawnRemainingSec > 19 * 60 - 5 && r.respawnRemainingSec <= 19 * 60);
});

test("Nagafen's Lair is the group dungeon (no danger needed), not the moved-out Lord Nagafen raid", () => {
  const { t } = make();
  enterOpen(t, "Nagafen's Lair 4 (Refined)"); // a group instance - invited in, no Voidling entry
  const names = t.getActive().map((r) => r.name);
  assert.equal(t.getCurrentZone(), "Nagafen's Lair");
  assert.ok(names.includes('Efreeti Lord Djarn'), 'the real dungeon boss is on the board');
  assert.ok(!names.includes('Lord Nagafen'), 'the raid boss lives in his own Voidling instance now');
});

test('the board sorts boss, then mini, then lesser', () => {
  const { t } = make();
  enterOpen(t, 'Najena');
  const tiers = t.getActive().map((r) => r.tier);
  const firstMini = tiers.indexOf('mini');
  const firstLesser = tiers.indexOf('lesser');
  assert.equal(tiers[0], 'boss');
  assert.ok(firstMini < firstLesser, 'minis should come before lesser trash');
  assert.ok(tiers.slice(0, firstLesser).every((x) => x !== 'lesser'));
});

test('the "- Group" difficulty grammar still resolves a raid to the base-zone board', () => {
  // Measured: the owner's real Plane of Hate RAID entered as "... - Group 4 (Refined)". The
  // "- Group" / no-"- Group" split does not tell raid from group instance, which is why the gate
  // is the "You say, 'danger'" line and not the zone name.
  const { t } = make();
  sayDanger(t);
  t.handleLine(`${TS}You have entered The Plane of Hate - Group 4 (Refined).`);
  assert.equal(t.getCurrentZone(), 'The Plane of Hate');
  assert.ok(t.getActive().length > 0);
});

test('the board survives a restart: killed nameds come back greyed, not all-up (owner, 4 Sep)', () => {
  // Reported live: 7 Plane of Hate nameds down, restarted the app mid-raid, the board rebuilt with
  // all 14 "up" again - every kill lost. captureState/restoreState + the session-restore registry.
  const { t } = make();
  enterOpen(t, 'The Plane of Hate');
  slay(t, 'Lord of Ire');
  slay(t, 'Maestro of Rancor');
  slay(t, 'Magi P`tasa');
  const snap = t.captureState();
  assert.equal(snap.kills.length, 3);

  // restart: restoreState runs BEFORE the log-tail zone recovery (setZone), so it stashes
  const { t: t2 } = make();
  assert.equal(t2.restoreState(snap), 0, 'stashed - no board to apply to yet');
  t2.setZone('The Plane of Hate'); // startup seed
  const killed = t2.getActive().filter((r) => r.killed).map((r) => r.name).sort();
  assert.deepEqual(killed, ['Lord of Ire', 'Maestro of Rancor', 'Magi P`tasa']);
});

test('a restart into a DIFFERENT zone than the snapshot gets a fresh board, no stale kills', () => {
  const { t } = make();
  enterOpen(t, 'The Plane of Hate');
  slay(t, 'Lord of Ire');
  const snap = t.captureState();

  const { t: t2 } = make();
  t2.restoreState(snap);
  t2.setZone('The Plane of Fear'); // she left Hate, restarted in Fear
  assert.equal(t2.getActive().filter((r) => r.killed).length, 0, 'Fear board must be all-up');
  assert.equal(t2.getCurrentZone(), 'The Plane of Fear');
});

test('a fresh Voidling re-entry after a restart-seed does NOT re-apply the old kills', () => {
  const { t } = make();
  enterOpen(t, 'The Plane of Hate');
  slay(t, 'Lord of Ire');
  const snap = t.captureState();

  const { t: t2 } = make();
  t2.restoreState(snap);
  enter(t2, 'The Plane of Hate'); // LIVE entry with a fresh danger hail = brand-new instance
  assert.equal(t2.getActive().filter((r) => r.killed).length, 0, 'a fresh instance is all-up');
});

test('The Permafrost Caverns (the Voidling instance name for Permafrost) loads the board', () => {
  const { t } = make();
  t.handleLine(`${TS}You have entered The Permafrost Caverns - Group 4 (Refined).`);
  assert.equal(t.getCurrentZone(), 'The Permafrost Caverns');
  assert.ok(t.getActive().length > 0, 'the raid instance name must resolve, not just "Permafrost Keep"');
});

test('an instanced zone with no named list logs a loud diagnostic instead of a silent empty board', () => {
  const { t, log } = make();
  t.handleLine(`${TS}You have entered The Catacombs of Whoknows - Group 2 (Adaptive).`);
  assert.deepEqual(t.getActive(), []);
  assert.ok(
    log.some((m) => m.includes('no named list') && m.includes('The Catacombs of Whoknows')),
    'the gap should be visible in the debug log, not silent'
  );
});

test('a plain (non-instanced) untracked zone does NOT log the "add it" diagnostic', () => {
  const { t, log } = make();
  t.handleLine(`${TS}You have entered East Freeport.`);
  assert.ok(!log.some((m) => m.includes('no named list')), 'only instanced zones are worth flagging');
});

test('a raid zone entered as a plain group/dungeon run lights up the board (owner, 2 Sep)', () => {
  const { t } = make();
  // no Voidling dialogue - just walked in with a group. "anything that is a RAID is also a
  // separate DUNGEON": the board still shows.
  t.handleLine(`${TS}You have entered The Plane of Fear 4 (Refined).`);
  assert.equal(t.getCurrentZone(), 'The Plane of Fear');
  assert.ok(t.getActive().length > 0);
  assert.equal(t.viaVoidling, false, 'a plain entry is not flagged as the raid-lockout instance');
});

test("a groupmate's \"danger\" hail: the board shows, but it is not flagged as the player's raid instance", () => {
  const { t } = make();
  t.handleLine(`${TS}Avenrae says, 'danger'`); // a different player
  t.handleLine(`${TS}You have entered The Plane of Fear 1 (Awakened).`);
  assert.equal(t.getCurrentZone(), 'The Plane of Fear', 'the board still shows');
  assert.equal(t.viaVoidling, false, "someone else's hail is not proof the PLAYER raided");
});

test('a "- Group" zone entry is the raid-lockout instance even with no hail from anyone (invited in by someone else)', () => {
  const { t } = make();
  // No danger line at all - reached purely by accepting another player's "asked you to join the
  // instance" invite. The zone string alone proves it.
  t.handleLine(`${TS}You have entered The Plane of Hate - Group 4 (Refined).`);
  assert.equal(t.getCurrentZone(), 'The Plane of Hate');
  assert.equal(t.viaVoidling, true, 'the zone string names the raid instance directly');
});

test('a bare instance suffix with no "- Group" is never the raid instance, even with a hail nearby', () => {
  const { t } = make();
  t.handleLine(`${TS}You say, 'danger'`);
  t.handleLine(`${TS}You have entered The Plane of Fear 4 (Refined).`);
  assert.equal(t.viaVoidling, false, 'no "- Group" in the string means this was not the raid version');
});

test('viaVoidling is consumed by the zone change - a plain re-entry drops the raid flag but keeps the board', () => {
  const { t } = make();
  enter(t, 'The Plane of Fear'); // danger + zone -> board up, viaVoidling true
  assert.equal(t.viaVoidling, true);
  slay(t, 'Terror');
  enterOpen(t, 'The Plane of Fear'); // same base zone, no fresh danger
  assert.equal(t.getCurrentZone(), 'The Plane of Fear', 'the board stays');
  assert.equal(t.getActive().find((r) => r.name === 'Terror').killed, true, 'the kill is kept');
});

test('walking out to an untracked zone clears the board', () => {
  const { t } = make();
  enter(t, 'The Plane of Fear');
  assert.ok(t.getActive().length > 0);
  t.handleLine(`${TS}You have entered Qeynos.`);
  assert.deepEqual(t.getActive(), []);
  assert.equal(t.getCurrentZone(), null);
});

test('a zone-line echo of the same raid instance (reconnect) keeps the board and its kills', () => {
  const { t } = make();
  enter(t, 'The Plane of Fear 1 (Awakened)');
  slay(t, 'Terror');
  // client reload re-emits the entry line, no fresh hail/danger
  t.handleLine(`${TS}You have entered The Plane of Fear 1 (Awakened).`);
  assert.equal(t.getCurrentZone(), 'The Plane of Fear', 'the board was wiped by an echo');
  assert.equal(t.getActive().find((r) => r.name === 'Terror').killed, true, 'the kill was lost');
});

test('re-entering a raid through the Voidling is a fresh instance - the board resets', () => {
  const { t } = make();
  enter(t, 'The Plane of Fear');
  slay(t, 'Terror');
  assert.equal(t.getActive().find((r) => r.name === 'Terror').killed, true);
  enter(t, 'The Plane of Fear 2 (Adaptive)');
  assert.equal(t.getActive().find((r) => r.name === 'Terror').killed, false, 'a fresh instance kept the kill');
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

test('a kill in a zone the board does not know is ignored', () => {
  const { t } = make();
  enterOpen(t, "Nagafen's Lair");
  slay(t, 'Cazic-Thule'); // wrong zone
  assert.equal(t.getActive().filter((r) => r.killed).length, 0);
});

test('a trash mob death does not grey anything', () => {
  const { t } = make();
  enterOpen(t, "Nagafen's Lair");
  slay(t, 'a greater kobold');
  slay(t, 'a lava beetle');
  assert.equal(t.getActive().filter((r) => r.killed).length, 0);
});

test('leaving for an untracked zone clears the board', () => {
  const { t } = make();
  enter(t, 'The Plane of Fear');
  enterOpen(t, 'East Freeport');
  assert.deepEqual(t.getActive(), []);
  assert.equal(t.getCurrentZone(), null);
});

test('killing the same named twice does not double-fire', () => {
  const { t, log } = make();
  enterOpen(t, "Nagafen's Lair");
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
    enterOpen(t, '__TEST_ZONE__');
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
  enterOpen(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  const row = t.getActive().find((r) => r.name === 'Efreeti Lord Djarn');
  assert.equal(row.killed, true);
  assert.equal(row.respawnRemainingSec, null);
});

// ---------------------------------------------------------------------------
// "reset or keep progress?" prompt (owner's weekly notes, 13 Sep) - re-entering the same base
// zone with no hail either way is genuinely ambiguous (an instance-line echo vs. a real second
// trip into a fresh dungeon instance), so it asks rather than silently guessing either way.
// ---------------------------------------------------------------------------

test('re-entering the same zone with kills already tracked, no hail either way, asks rather than guessing', () => {
  const { t } = make();
  enterOpen(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  let asked = null;
  t.on('resetPromptNeeded', (payload) => { asked = payload; });
  enterOpen(t, "Nagafen's Lair");
  assert.deepEqual(asked, { zone: "Nagafen's Lair" });
  assert.deepEqual(t.getPendingResetPrompt(), { zone: "Nagafen's Lair" });
  // Nothing changes until she answers - same as the existing "keeps the board" behaviour.
  assert.equal(t.getActive().find((r) => r.name === 'Efreeti Lord Djarn').killed, true);
});

test('re-entering the same zone with NOTHING killed yet never asks - there is nothing to lose either way', () => {
  const { t } = make();
  enterOpen(t, "Nagafen's Lair");
  let asked = false;
  t.on('resetPromptNeeded', () => { asked = true; });
  enterOpen(t, "Nagafen's Lair");
  assert.equal(asked, false);
  assert.equal(t.getPendingResetPrompt(), null);
});

test('the entrance-then-instance-suffix pair for one visit does not ask twice', () => {
  const { t } = make();
  enterOpen(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  let count = 0;
  t.on('resetPromptNeeded', () => { count += 1; });
  enterOpen(t, "Nagafen's Lair 4 (Refined)");
  enterOpen(t, "Nagafen's Lair 4 (Refined)");
  assert.equal(count, 1, 'the second identical line re-asked instead of a no-op');
});

test('answering "reset" while still in the zone rebuilds the board fresh', () => {
  const { t } = make();
  enterOpen(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  enterOpen(t, "Nagafen's Lair");
  assert.ok(t.getPendingResetPrompt());
  let changed = false;
  t.on('changed', () => { changed = true; });
  assert.equal(t.resolveResetPrompt('reset'), true);
  assert.equal(t.getPendingResetPrompt(), null);
  assert.equal(t.getActive().find((r) => r.name === 'Efreeti Lord Djarn').killed, false, 'the kill was not cleared');
  assert.ok(changed, 'nothing told the overlay the board changed');
});

test('answering "keep" leaves the board exactly as it was', () => {
  const { t } = make();
  enterOpen(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  enterOpen(t, "Nagafen's Lair");
  t.resolveResetPrompt('keep');
  assert.equal(t.getPendingResetPrompt(), null);
  assert.equal(t.getActive().find((r) => r.name === 'Efreeti Lord Djarn').killed, true);
});

test('answering after she already left the zone is a harmless no-op', () => {
  const { t } = make();
  enterOpen(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  enterOpen(t, "Nagafen's Lair");
  t.handleLine(`${TS}You have entered Qeynos.`); // walked off before answering
  assert.equal(t.getPendingResetPrompt(), null, 'leaving did not cancel the moot question');
  assert.equal(t.resolveResetPrompt('reset'), false, 'answering a question that no longer exists');
});

test('a real zone change while a prompt is pending cancels it rather than leaving it stale', () => {
  const { t } = make();
  enterOpen(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  enterOpen(t, "Nagafen's Lair");
  assert.ok(t.getPendingResetPrompt());
  enterOpen(t, 'The Plane of Fear'); // a genuinely different tracked zone
  assert.equal(t.getPendingResetPrompt(), null);
});

test('a fresh Voidling re-entry still resets automatically even with a question already pending', () => {
  const { t } = make();
  enter(t, 'The Plane of Fear');
  slay(t, 'Terror');
  enterOpen(t, 'The Plane of Fear'); // ambiguous - queues a question
  assert.ok(t.getPendingResetPrompt());
  enter(t, 'The Plane of Fear'); // a real hail this time - a genuinely fresh instance
  assert.equal(t.getPendingResetPrompt(), null, 'the stale question was not cleared');
  assert.equal(t.getActive().find((r) => r.name === 'Terror').killed, false, 'the fresh instance did not reset');
});

// ---------------------------------------------------------------------------
// Auto-reset on an unanswered prompt (owner, 14 Sep). Confirmed against her own real ~12-hour log:
// the "reset or keep?" popup fired 3 separate times and was never answered once - each time the
// board just sat showing stale kills until she happened to leave the zone for something else. Her
// own call: auto-answer "reset" after a timeout instead of leaving it stuck indefinitely.
// ---------------------------------------------------------------------------

test('an unanswered reset prompt auto-resolves as "reset" after the timeout', async () => {
  const { t, log } = make();
  t.setOptions({ resetPromptAutoResetMs: 20 }); // real timer, shrunk so the test doesn't wait 18s
  enterOpen(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  enterOpen(t, "Nagafen's Lair"); // ambiguous re-entry - queues the question
  assert.ok(t.getPendingResetPrompt(), 'the question must be pending before the timeout can auto-answer it');
  let changed = false;
  t.on('changed', () => { changed = true; });
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(t.getPendingResetPrompt(), null, 'an unanswered question must not sit pending forever');
  assert.equal(t.getActive().find((r) => r.name === 'Efreeti Lord Djarn').killed, false, 'the auto-answer must actually be "reset", not "keep"');
  assert.ok(changed, 'the overlay must be told the board changed when the auto-reset fires');
  assert.ok(log.some((m) => /auto-resetting/.test(m)), 'the debug log should say WHY the board reset with no one clicking anything');
});

test('answering manually before the timeout cancels the auto-reset - it does not fire twice', async () => {
  const { t } = make();
  t.setOptions({ resetPromptAutoResetMs: 20 });
  enterOpen(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  enterOpen(t, "Nagafen's Lair");
  t.resolveResetPrompt('keep'); // she answered before the timer fired
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(t.getActive().find((r) => r.name === 'Efreeti Lord Djarn').killed, true, 'a stale timer must not override her own "keep" answer');
});

test('leaving the zone before the timeout cancels the auto-reset harmlessly', async () => {
  const { t } = make();
  t.setOptions({ resetPromptAutoResetMs: 20 });
  enterOpen(t, "Nagafen's Lair");
  slay(t, 'Efreeti Lord Djarn');
  enterOpen(t, "Nagafen's Lair");
  enterOpen(t, 'The Plane of Fear'); // walked off before the timer fired
  await new Promise((resolve) => setTimeout(resolve, 60));
  // No crash, and the new zone's own (unrelated) board is untouched by a stale timer callback.
  assert.equal(t.getCurrentZone(), 'The Plane of Fear');
  assert.equal(t.getPendingResetPrompt(), null);
});

module.exports = () => report('raid-named-tracker');
if (require.main === module) report('raid-named-tracker').then((n) => process.exit(n ? 1 : 0));
