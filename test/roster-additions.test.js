'use strict';
/**
 * roster-overrides.json's `add` block - the way to put a new spell into the roster.
 *
 * The owner, 30 Aug 2026: "the roster should be directly editable for additions. if the roster
 * cannot add new spells this is a problem that needs fixing as that is basic functionality for
 * lists." buffs.json is the roster of record and roster-overrides.json is where it is edited - a
 * `set` block overwrites fields on an existing entry, an `add` block builds a brand-new one.
 *
 * buildAddedEntries is pure (client-data lookups passed in), so this exercises it with fixtures.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { buildAddedEntries } = require('../tools/build-roster');

// A minimal stand-in for main()'s game-data maps. field 0 = id, 1 = name, 8/10 = cast/recast ms,
// 75 = icon; strById maps id -> [ , , , CASTEDMETXT(3), CASTEDOTHERTXT(4), SPELLGONE(5) ].
function fakeGame(rows) {
  const spellByName = new Map();
  const strById = new Map();
  for (const r of rows) {
    const arr = [];
    arr[0] = r.id; arr[1] = r.name; arr[8] = r.castMs || 0; arr[10] = r.recastMs || 0; arr[75] = r.icon || 0;
    spellByName.set(r.name.toLowerCase(), arr);
    strById.set(r.id, ['', '', '', r.landed || '', r.landedOther || '', r.wore || '']);
  }
  return { spellByName, strById };
}

test('an `add` block builds a brand-new entry, enriched from the game data', () => {
  const overrides = {
    _README: ['ignored'],
    'Empowering Invocation': {
      why: 'test',
      add: { kind: 'buff', durationSec: 1800, category: 'Combat', classes: 'BER 50', targets: 'Self', level: 50 },
    },
  };
  const game = fakeGame([
    { id: 9001, name: 'Empowering Invocation', icon: 240, castMs: 0, landed: 'You are empowered.', wore: 'Your empowerment fades.' },
  ]);

  const added = buildAddedEntries(overrides, game);
  assert.equal(added.length, 1);
  const e = added[0];
  assert.equal(e.name, 'Empowering Invocation');
  assert.equal(e.spellId, 9001);
  assert.equal(e.kind, 'buff');
  assert.equal(e.durationSec, 1800);
  assert.equal(e.targets, 'Self');
  assert.equal(e.landingText, 'You are empowered.', 'text comes from the game data');
  assert.equal(e.endedText, 'Your empowerment fades.');
  assert.equal(e.iconId, 240);
});

test('a spell absent from the client data entirely can still be fully hand-specified', () => {
  const overrides = {
    'Homebrew Stance': {
      why: 'test',
      add: { kind: 'buff', durationSec: 0, infiniteDuration: true, landingText: 'You settle into a stance.', endedText: 'You drop your stance.', targets: 'Self' },
    },
  };
  const added = buildAddedEntries(overrides, fakeGame([]));
  assert.equal(added.length, 1);
  assert.equal(added[0].landingText, 'You settle into a stance.');
  assert.equal(added[0].infiniteDuration, true);
  assert.equal('spellId' in added[0], false, 'no game row, so no spellId');
});

test('`add` fields win over the game-derived values', () => {
  const overrides = { 'X': { why: 't', add: { landingText: 'Overridden.', kind: 'buff' } } };
  const game = fakeGame([{ id: 1, name: 'X', landed: 'From game.' }]);
  assert.equal(buildAddedEntries(overrides, game)[0].landingText, 'Overridden.');
});

test('a name already in the roster is left to its `set` block, not duplicated', () => {
  const overrides = { 'Existing': { why: 't', add: { kind: 'buff' } } };
  const added = buildAddedEntries(overrides, fakeGame([]), new Set(['existing']));
  assert.deepEqual(added, []);
});

test('a plain `set`-only override is not treated as an addition', () => {
  const overrides = { 'Alacrity': { why: 't', set: { durationSec: 492 } } };
  assert.deepEqual(buildAddedEntries(overrides, fakeGame([])), []);
});

test('`noGameLookup: true` skips the client-spell-data match (name collisions)', () => {
  // "Divine Invocation" / "Defensive Stance" coincidentally match unrelated classic-EQ spells in
  // spells_us.txt; without the flag the entry picked up that spell's endedText / others-suffix.
  const overrides = { 'Divine Invocation': { why: 't', add: { noGameLookup: true, kind: 'buff', targets: 'Self', infiniteDuration: true } } };
  const game = fakeGame([{ id: 28145, name: 'Divine Invocation', landed: 'WRONG SPELL.', wore: 'You are no longer watched.' }]);
  const e = buildAddedEntries(overrides, game)[0];
  assert.equal(e.landingText, undefined, 'no game landing text should have been pulled in');
  assert.equal(e.endedText, undefined);
  assert.equal(e.spellId, undefined);
  assert.equal(e.noGameLookup, undefined, 'the build directive must not survive into the roster entry');
});

test('an added entry always gets a scaleCategory (default "none")', () => {
  const overrides = { 'X Stance': { why: 't', add: { noGameLookup: true, kind: 'buff', category: 'Stance', targets: 'Self', infiniteDuration: true } } };
  assert.equal(buildAddedEntries(overrides, fakeGame([]))[0].scaleCategory, 'none');
});

test('build-roster.js has no spreadsheet / xlsx anywhere in it', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-roster.js'), 'utf8');
  assert.doesNotMatch(src, /spreadsheet|xlsx|readWorkbook|\.xlsx|new spell roster/i,
    'the spreadsheet is retired - it must not be referenced by the build script');
  assert.ok(!fs.existsSync(path.join(__dirname, '..', 'tools', 'lib', 'xlsx.js')), 'tools/lib/xlsx.js should be gone');
});

test('build-roster.js rebuilds from the current buffs.json + roster-overrides.json', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'tools', 'build-roster.js'), 'utf8');
  // reads the current roster as the base
  assert.match(src, /JSON\.parse\(fs\.readFileSync\(OUT/);
  // re-applies both set and add fields to an existing entry
  assert.match(src, /Object\.assign\(e, ov\.set \|\| \{\}, ov\.add \?/);
  // additions pushed before the name-sort
  const call = src.indexOf('buildAddedEntries(overrides');
  const sort = src.indexOf('roster.sort(');
  assert.ok(call > -1 && sort > -1 && call < sort, 'additions must be pushed before the name-sort');
  const readme = fs.readFileSync(path.join(__dirname, '..', 'tools', 'roster-overrides.json'), 'utf8');
  assert.match(readme, /TO ADD A NEW SPELL/);
  assert.doesNotMatch(readme, /spreadsheet|xlsx|curated/i, 'the overrides file must not reference the retired spreadsheet');
});

module.exports = () => report('roster-additions');
if (require.main === module) report('roster-additions').then((n) => process.exit(n ? 1 : 0));
