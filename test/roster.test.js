'use strict';
/**
 * Roster integrity and detection-capability baseline.
 *
 * WHY THIS EXISTS
 * ---------------
 * The roster is not a lookup table the app consults - it is the app's entire model of reality.
 * Detection is exact-text matching against landingText / endedText / othersLandingSuffix, and
 * "is this text unique?" is judged against the roster rather than against the game. That makes
 * the roster's *shape* load-bearing, in a way that is easy to damage silently:
 *
 *   - Drop entries and some landing texts stop being shared, so they start auto-confirming as
 *     unique. That is the highest-confidence detection tier, taken with no corroborating
 *     evidence. Removing data can therefore CREATE false positives.
 *   - Overwrite entries with data that has no text columns and detection for those spells simply
 *     stops, with no error - the timers just never appear.
 *
 * Neither failure throws. Both are invisible until someone is raiding.
 *
 * So this file records what the roster can currently do, as a snapshot in roster-baseline.json.
 * Any change that alters those numbers fails the test and prints the delta. That is not a
 * prohibition - rosters are meant to change - it is a receipt, so a change is made on purpose
 * and its cost is known.
 *
 * TO UPDATE THE BASELINE DELIBERATELY:
 *   node test/roster.test.js --update
 * then read the diff in git and make sure every moved number is one you meant to move.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const ROSTER = path.join(ROOT, 'src', 'shared', 'data', 'buffs.json');
const BASELINE = path.join(__dirname, 'roster-baseline.json');

// ---------------------------------------------------------------- load

let roster;
test('the bundled roster is valid JSON and a non-empty array', () => {
  // main.js constructs the BuffStore at module-evaluation time with an unguarded
  // readFileSync + JSON.parse. A malformed roster therefore kills the app before any window
  // exists: to a non-programmer it simply does not start, with no error to report.
  const raw = fs.readFileSync(ROSTER, 'utf8');
  assert.ok(!raw.startsWith('﻿'), 'roster starts with a BOM, which JSON.parse rejects');
  roster = JSON.parse(raw);
  assert.ok(Array.isArray(roster), 'roster must be an array');
  assert.ok(roster.length > 0, 'roster is empty');
});

function measure(r) {
  const land = new Map();
  const other = new Map();
  for (const e of r) {
    if (e.landingText) land.set(e.landingText, (land.get(e.landingText) || 0) + 1);
    if (e.othersLandingSuffix) other.set(e.othersLandingSuffix, (other.get(e.othersLandingSuffix) || 0) + 1);
  }
  const uniq = (m) => [...m.values()].filter((v) => v === 1).length;
  return {
    entries: r.length,
    distinctNames: new Set(r.map((e) => e.name)).size,
    withLandingText: r.filter((e) => e.landingText).length,
    withEndedText: r.filter((e) => e.endedText).length,
    withOthersSuffix: r.filter((e) => e.othersLandingSuffix).length,
    withIconId: r.filter((e) => e.iconId).length,
    distinctLandingTexts: land.size,
    uniqueLandingTexts: uniq(land),
    distinctOthersSuffix: other.size,
    uniqueOthersSuffix: uniq(other),
  };
}

// ---------------------------------------------------------------- shape invariants

test('every entry has a non-empty string name', () => {
  const bad = roster.filter((e) => !e || typeof e.name !== 'string' || !e.name.trim());
  assert.equal(bad.length, 0, `${bad.length} entries have no usable name, e.g. ${JSON.stringify(bad[0])}`);
});

test('names are unique', () => {
  const seen = new Set();
  const dupes = [];
  for (const e of roster) {
    if (seen.has(e.name)) dupes.push(e.name);
    seen.add(e.name);
  }
  assert.deepEqual(dupes.slice(0, 5), [], `${dupes.length} duplicate names, e.g. ${dupes.slice(0, 5).join(', ')}`);
});

test('durationSec, where present, is a finite non-negative number', () => {
  const bad = roster.filter((e) => e.durationSec != null && (!Number.isFinite(e.durationSec) || e.durationSec < 0));
  assert.equal(bad.length, 0, `${bad.length} entries have an unusable durationSec, e.g. ${JSON.stringify(bad[0])}`);
});

test('text fields, where present, are strings', () => {
  const bad = [];
  for (const e of roster) {
    for (const f of ['landingText', 'endedText', 'othersLandingSuffix']) {
      if (e[f] != null && typeof e[f] !== 'string') bad.push(`${e.name}.${f}`);
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} non-string text fields, e.g. ${bad.slice(0, 5).join(', ')}`);
});

test('no entry carries an othersLandingSuffix without a landingText', () => {
  // Ally detection reverse-looks-up the suffix and then lands a buff by name; an entry with a
  // suffix but no landing text can be detected on a groupmate and never on the player, which
  // reads as "it works for everyone except me".
  const bad = roster.filter((e) => e.othersLandingSuffix && !e.landingText).map((e) => e.name);
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} entries can be seen on allies but never on you, e.g. ${bad.slice(0, 5).join(', ')}`);
});

// ---------------------------------------------------------------- capability baseline

test('detection capability matches the recorded baseline', () => {
  const now = measure(roster);

  if (process.argv.includes('--update')) {
    fs.writeFileSync(BASELINE, JSON.stringify(now, null, 2) + '\n', 'utf8');
    console.log('       baseline updated - review the git diff before committing');
    return;
  }

  assert.ok(fs.existsSync(BASELINE), `no baseline recorded. Run: node test/roster.test.js --update`);
  const was = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));

  const deltas = [];
  for (const k of Object.keys(was)) {
    if (now[k] !== was[k]) {
      const d = now[k] - was[k];
      deltas.push(`  ${k}: ${was[k]} -> ${now[k]}  (${d > 0 ? '+' : ''}${d})`);
    }
  }
  assert.equal(
    deltas.length, 0,
    'The roster\'s detection capability changed:\n' + deltas.join('\n') +
    '\n\nRead these before accepting them:\n' +
    '  - uniqueLandingTexts going UP means texts that were correctly treated as ambiguous now\n' +
    '    auto-confirm as unique. That is the highest-confidence tier, taken with no corroborating\n' +
    '    evidence, so removing entries can CREATE false positives.\n' +
    '  - withLandingText / withOthersSuffix going DOWN means spells that used to be detectable\n' +
    '    no longer are. Timers simply stop appearing, with no error.\n' +
    'If every change is intended: node test/roster.test.js --update'
  );
});

module.exports = () => report('roster');
if (require.main === module) process.exit(report('roster') ? 1 : 0);
