'use strict';
/**
 * logZonePeek.readLastZoneEntry - startup zone recovery.
 *
 * logWatcher starts at EOF and never replays history, so a restart mid-session leaves the
 * raid-named board, zone-gated aura visibility and the travel guide's current zone all blind until
 * the next zone line. This reads UPWARD from the end of the live log for the most recent
 * "You have entered X." - the one fact it is safe to recover, because a zone line is unambiguous
 * and the player is almost certainly still there. It also reports `viaVoidling`: whether the
 * player's raid-entry dialogue (hail the Voidling, say "danger") sits just before that zone line,
 * which is what the raid-named board needs to tell a raid instance from a normal D1-D4 dungeon.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const { readLastZoneEntry } = require('../src/main/logZonePeek');
const { RaidNamedTracker } = require('../src/main/raidNamedTracker');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

function tmpLog(lines, eol = '\r\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'zpeek-'));
  const p = path.join(dir, 'eqlog_Test.txt');
  fs.writeFileSync(p, lines.join(eol) + eol);
  return { p, dir };
}
const zoneOf = (r) => (r && r.zone) || null;

test('finds the most recent zone entry, not the first', () => {
  const { p, dir } = tmpLog([
    '[Sun Aug 30 10:00:00 2026] You have entered West Freeport.',
    '[Sun Aug 30 10:00:01 2026] a rat hits you for 3 points of damage.',
    "[Sun Aug 30 21:14:15 2026] You have entered Nagafen's Lair 4 (Refined).",
    '[Sun Aug 30 21:14:20 2026] Amplification hums.',
  ]);
  try {
    const r = readLastZoneEntry(p);
    assert.equal(r.zone, "Nagafen's Lair 4 (Refined)");
    assert.equal(r.viaVoidling, false, 'no hail/danger before it');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('viaVoidling is true when the player said "danger" before the zone line', () => {
  const { p, dir } = tmpLog([
    '[Sun Aug 30 21:13:00 2026] some earlier combat line.',
    "[Sun Aug 30 21:14:00 2026] You say, 'Hail, voidling'",
    "[Sun Aug 30 21:14:04 2026] You say, 'danger'",
    "[Sun Aug 30 21:14:15 2026] You have entered The Plane of Hate - Group 4 (Refined).",
  ]);
  try {
    const r = readLastZoneEntry(p);
    assert.equal(r.zone, 'The Plane of Hate - Group 4 (Refined)');
    assert.equal(r.viaVoidling, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a groupmate saying "danger" does not set viaVoidling', () => {
  const { p, dir } = tmpLog([
    "[Sun Aug 30 21:14:04 2026] Avenrae says, 'danger'",
    '[Sun Aug 30 21:14:15 2026] You have entered The Plane of Hate - Group 4 (Refined).',
  ]);
  try {
    assert.equal(readLastZoneEntry(p).viaVoidling, false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scans across many 64 KB chunks to reach a zone line buried under an evening of spam', () => {
  const lines = ["[Sun Aug 30 21:14:15 2026] You have entered Nagafen's Lair."];
  for (let i = 0; i < 60000; i++) lines.push(`[Sun Aug 30 21:30:00 2026] a lava beetle hits you for ${i}.`);
  const { p, dir } = tmpLog(lines);
  try {
    assert.ok(fs.statSync(p).size > 64 * 1024, 'fixture must exceed one chunk to be meaningful');
    assert.equal(zoneOf(readLastZoneEntry(p)), "Nagafen's Lair");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('handles LF-only logs as well as CRLF', () => {
  const { p, dir } = tmpLog(['[Sun Aug 30 10:00:00 2026] You have entered The Bazaar.'], '\n');
  try {
    assert.equal(zoneOf(readLastZoneEntry(p)), 'The Bazaar');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('returns null when the log has no zone line at all', () => {
  const { p, dir } = tmpLog(['nothing here', 'or here']);
  try {
    assert.equal(readLastZoneEntry(p), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('returns null for a missing file rather than throwing', () => {
  assert.equal(readLastZoneEntry(path.join(os.tmpdir(), 'does-not-exist-zpeek.txt')), null);
});

test('respects maxBytes - a zone line older than the cap is not found', () => {
  const lines = ['[Sun Aug 30 10:00:00 2026] You have entered The Overthere.'];
  for (let i = 0; i < 5000; i++) lines.push(`[Sun Aug 30 21:00:00 2026] filler line ${i} with some length to it.`);
  const { p, dir } = tmpLog(lines);
  try {
    assert.equal(readLastZoneEntry(p, 2000), null, 'the cap should stop the scan before the old zone line');
    assert.equal(zoneOf(readLastZoneEntry(p)), 'The Overthere', 'and an uncapped scan still finds it');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('RaidNamedTracker.setZone rebuilds a RAID board only with the Voidling confirmation', () => {
  const t = new RaidNamedTracker();
  try {
    // The Plane of Fear is a `raid: true` entry - a group instance shares the name and suffix.
    t.setZone('The Plane of Fear 4 (Refined)', false);
    assert.equal(t.getCurrentZone(), null, 'no confirmation - a raid board stays dark');
    t.setZone('The Plane of Fear 4 (Refined)', true);
    assert.equal(t.getCurrentZone(), 'The Plane of Fear');
    assert.ok(t.getActive().length > 0, 'the named list should be up');
  } finally { t.stop(); }
});

test('RaidNamedTracker.setZone rebuilds a DUNGEON board with no confirmation needed', () => {
  const t = new RaidNamedTracker();
  try {
    t.setZone("Nagafen's Lair 4 (Refined)", false); // group dungeon - no `raid` flag
    assert.equal(t.getCurrentZone(), "Nagafen's Lair");
    assert.ok(t.getActive().some((r) => r.name === 'Efreeti Lord Djarn'));
  } finally { t.stop(); }
});

test('RaidNamedTracker.setZone is a no-op for an untracked zone even with confirmation', () => {
  const t = new RaidNamedTracker();
  try {
    t.setZone('The Bazaar', true);
    assert.equal(t.getCurrentZone(), null);
    assert.deepEqual(t.getActive(), []);
  } finally { t.stop(); }
});

test('CustomTimerEngine.seedZone sets the zone without firing a zoneEnter trigger', () => {
  const eng = new CustomTimerEngine();
  try {
    const timer = { id: 't1', name: 'z', triggerMatch: 'zoneEnter', triggerText: "Nagafen's Lair 4 (Refined)", triggerDurationSec: 30 };
    eng.setGetWidgetsFn(() => [{ id: 'w1', timers: [timer], triggerCombineMode: 'independent' }]);
    eng.seedZone("Nagafen's Lair 4 (Refined)");
    assert.equal(eng.getActive().length, 0, 'seeding must not fire the zoneEnter trigger');
    assert.equal(eng.currentZone, "Nagafen's Lair 4 (Refined)", 'but it does establish the current zone');
  } finally { eng.stop(); }
});

test('seedZone only takes effect before any real zone line', () => {
  const eng = new CustomTimerEngine();
  try {
    eng.setGetWidgetsFn(() => []);
    eng.handleLine('[Sun Aug 30 20:00:00 2026] You have entered The Feerrott.');
    eng.seedZone("Nagafen's Lair");
    assert.equal(eng.currentZone, 'The Feerrott', 'seedZone must not override a zone already seen live');
  } finally { eng.stop(); }
});

module.exports = () => report('log-zone-peek');
if (require.main === module) report('log-zone-peek').then((n) => process.exit(n ? 1 : 0));
