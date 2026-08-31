'use strict';
/**
 * src/shared/buffLines.js + src/shared/data/buff-lines.json - the heading model.
 * See docs/BUFF-STACKING.md.
 *
 * Runs against the SHIPPED data (not fixtures) so a broken line definition shows up here.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const bl = require('../src/shared/buffLines');

test('the shipped data is well-formed', () => {
  bl.loadData();
  const d = bl.data;
  assert.ok(Array.isArray(d.lines) && d.lines.length > 20);
  const ids = new Set();
  for (const line of d.lines) {
    assert.ok(line.id && !ids.has(line.id), `duplicate or missing line id: ${line.id}`);
    ids.add(line.id);
    assert.ok(Array.isArray(line.headings) && line.headings.length, `${line.id} has no headings`);
    assert.ok(Array.isArray(line.members) && line.members.length, `${line.id} has no members`);
  }
  // every referenced line id (blocks / stacksWith / conflictsWith) exists
  for (const line of d.lines) {
    for (const ref of [...(line.blocks || []), ...(line.stacksWith || []), ...(line.conflictsWith || [])]) {
      assert.ok(ids.has(ref), `${line.id} references unknown line "${ref}"`);
    }
  }
  for (const p of d.blockedPairs) {
    assert.ok(p.blocked && p.by, 'blockedPair missing a side');
  }
  // every heading a line uses is in the headings map
  const knownHeadings = new Set(Object.keys(d.headings));
  for (const line of d.lines) {
    for (const h of line.headings) {
      assert.ok(knownHeadings.has(h), `${line.id} uses unmapped heading "${h}"`);
    }
  }
});

test('lineForName matches exact and rank-suffix names', () => {
  bl.loadData();
  assert.equal(bl.lineForName('Fury').id, 'shaman.frenzy');
  assert.equal(bl.lineForName('Rage').id, 'shaman.frenzy');
  assert.equal(bl.lineForName('Strength').id, 'shaman.strength');
  assert.equal(bl.lineForName('Yaulp III').id, 'cleric.yaulp'); // rank-suffix
  assert.equal(bl.lineForName('Talisman of Altuna').id, 'shaman.talisman');
  assert.equal(bl.lineForName('Nonexistent Buff'), null);
});

test('tierOf orders members low -> high', () => {
  bl.loadData();
  const line = bl.lineForName('Fury');
  assert.ok(bl.tierOf(line, 'Rage') > bl.tierOf(line, 'Fury'));
  assert.ok(bl.tierOf(line, 'Fury') > bl.tierOf(line, 'Frenzy'));
});

test('stackDecision - same line', () => {
  bl.loadData();
  assert.equal(bl.stackDecision('Rage', 'Fury'), 'overwrites');
  assert.equal(bl.stackDecision('Yaulp III', 'Yaulp II'), 'overwrites');
  assert.equal(bl.stackDecision('Strength', 'Strength'), 'overwrites'); // recast
});

test('stackDecision - Frenzy line stacks with the Strength line (the bug Vaela caught)', () => {
  bl.loadData();
  assert.equal(bl.stackDecision('Fury', 'Strength'), 'coexist');
  assert.equal(bl.stackDecision('Strength', 'Fury'), 'coexist');
  assert.equal(bl.stackDecision('Infusion of Spirit', 'Strength'), 'coexist');
});

test('stackDecision - shared heading conflicts, different heading coexists', () => {
  bl.loadData();
  assert.equal(bl.stackDecision('Shield of Words', 'Guardian'), 'overwrites'); // both AC slot 4
  assert.equal(bl.stackDecision('Shield of Words', 'Resolution'), 'coexist'); // AC 4 vs AC 1
  assert.equal(bl.stackDecision('Talisman of Altuna', 'Talisman of Jasinth'), 'coexist'); // HP vs disease resist
});

test('stackDecision - measured blocked-pairs are directional', () => {
  bl.loadData();
  assert.equal(bl.stackDecision('Talisman of Altuna', 'Arch Shielding'), 'overwrites');
  assert.equal(bl.stackDecision('Arch Shielding', 'Talisman of Altuna'), 'blocked');
});

test('stackDecision - combination buffs block the lines they subsume', () => {
  bl.loadData();
  assert.equal(bl.stackDecision('Harnessing of Spirit', 'Strength'), 'overwrites');
  assert.equal(bl.stackDecision('Strength', 'Harnessing of Spirit'), 'blocked');
});

test('stackDecision - unknown when either spell has no line', () => {
  bl.loadData();
  assert.equal(bl.stackDecision('Made Up Buff', 'Another Made Up Buff'), 'unknown');
  assert.equal(bl.stackDecision('Strength', 'Some Random Thing'), 'unknown');
});

test('loadData swaps the data and restores it', () => {
  bl.loadData({ headings: {}, lines: [{ id: 'x', headings: ['h'], members: ['Foo'] }], blockedPairs: [] });
  assert.equal(bl.lineForName('Foo').id, 'x');
  assert.equal(bl.lineForName('Fury'), null);
  bl.loadData();
  assert.equal(bl.lineForName('Fury').id, 'shaman.frenzy');
});

module.exports = () => report('buff-lines');
if (require.main === module) report('buff-lines').then((n) => process.exit(n ? 1 : 0));
