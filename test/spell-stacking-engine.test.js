'use strict';
/**
 * The full ported stacking engine (src/shared/spellStackingEngine.js). Structural + per-branch
 * cover. The authoritative check is the parity test against the reference over the whole EQL spell
 * set - test/spell-stacking-parity.test.js - which needs the reference spell data; this file pins
 * the individual mechanics so a regression names the branch it broke.
 *
 * Verdicts: -1 cast blocked · 0 stack / unrelated · 1 cast overwrites worn. worn = sp1, cast = sp2.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const {
  checkStackConflict,
  spellView,
  calcSpellValue,
  spellDelta,
  scalesWithLevel,
} = require('../src/shared/spellStackingEngine');

// A spells.json-style record. `eff` entries are {slot, effect_id, base_value, limit_value, formula, max_value}.
const rec = (o) => ({
  id: 1,
  name: 'X',
  good_effect: 1,
  buff_duration_formula: 1,
  buff_duration: 100,
  target_type: 5, // Single
  is_discipline: false,
  classes: Array(16).fill(255),
  effects: [],
  ...o,
});
const slot = (i, spa, base, formula = 100, max = 0, limit = 0) => ({
  slot: i,
  effect_id: spa,
  base_value: base,
  limit_value: limit,
  formula,
  max_value: max,
});
const view = (o) => spellView(rec(o));

test('calcSpellValue: flat, level-scaled, and shrink-to-floor formulas', () => {
  assert.equal(calcSpellValue(10, 100, 0, 50), 10, 'formula 100 is flat');
  assert.equal(calcSpellValue(5, 2, 0, 10), 25, 'formula 2 = level*2 added to base');
  assert.equal(calcSpellValue(1, 101, 40, 50), 26, 'formula 101 = base + level/2, capped at max');
  // SPA-11 slow: base 90, max 30, a scaling formula -> shrinks from |base| toward the |max| floor
  assert.equal(calcSpellValue(-90, 101, -30, 2), -89, 'scaling + |max|<|base| shrinks, not grows');
  assert.equal(scalesWithLevel(100), false);
  assert.equal(scalesWithLevel(101), true);
  assert.equal(spellDelta(107, 50, 5, 0), 0, 'degenerating formula contributes 0');
});

test('identical spell: worn is higher level -> cast blocked; equal/lower -> overwrites', () => {
  const a = view({ id: 7, effects: [slot(0, 4, 10)] });
  assert.equal(checkStackConflict(a, { ...a }, 50, 40), -1, 'refresh from a lower level is blocked');
  assert.equal(checkStackConflict(a, { ...a }, 40, 50), 1, 'refresh from an equal/higher level holds');
});

test('ImprovedTaunt (444) on the worn spell flips the same-id lower-level case to overwrite', () => {
  const a = view({ id: 7, effects: [slot(0, 4, 10), slot(1, 444, 1)] });
  assert.equal(checkStackConflict(a, { ...a }, 50, 40), 1);
});

test('Manaburn (350): same id is always blocked', () => {
  const a = view({ id: 7, effects: [slot(0, 350, 100)] });
  assert.equal(checkStackConflict(a, { ...a }, 40, 50), -1);
});

test('bard song vs regular spell, both beneficial -> they occupy separate pools (0)', () => {
  const song = view({ id: 1, classes: (() => { const c = Array(16).fill(255); c[7] = 10; return c; })(), effects: [slot(0, 4, 10)] });
  const spell = view({ id: 2, effects: [slot(0, 4, 10)] });
  assert.equal(checkStackConflict(song, spell, 50, 50), 0);
  assert.equal(checkStackConflict(spell, song, 50, 50), 0);
});

test('same effect, same slot: stronger cast overwrites, weaker cast is blocked, unrelated stacks', () => {
  const weak = view({ id: 1, effects: [slot(0, 4, 10)] });
  const strong = view({ id: 2, effects: [slot(0, 4, 25)] });
  const other = view({ id: 3, effects: [slot(0, 5, 10)] }); // DEX, different SPA
  assert.equal(checkStackConflict(weak, strong, 50, 50), 1);
  assert.equal(checkStackConflict(strong, weak, 50, 50), -1);
  assert.equal(checkStackConflict(weak, other, 50, 50), 0);
});

test('Complete Heal (101) on a colliding slot is an immediate block', () => {
  const a = view({ id: 1, effects: [slot(0, 101, 100)] });
  const b = view({ id: 2, effects: [slot(0, 101, 100)] });
  assert.equal(checkStackConflict(a, b, 50, 50), -1);
});

test('two detrimental DoTs (CurrentHP, different ids) coexist', () => {
  const dotA = rec({ id: 1, name: 'DotA', good_effect: 0, effects: [slot(0, 0, -50)] });
  const dotB = rec({ id: 2, name: 'DotB', good_effect: 0, effects: [slot(0, 0, -70)] });
  assert.equal(checkStackConflict(spellView(dotA), spellView(dotB), 50, 50), 0);
});

test('movement: worn snare + incoming run buff -> blocked; worn buff + incoming snare -> coexist', () => {
  const snare = view({ id: 1, effects: [slot(0, 3, -50)] });
  const sow = view({ id: 2, effects: [slot(0, 3, 60)] });
  assert.equal(checkStackConflict(snare, sow, 50, 50), -1);
  assert.equal(checkStackConflict(sow, snare, 50, 50), 0);
});

test('AttackSpeed (11) subtracts the 100 base before comparing magnitude', () => {
  const slow = view({ id: 1, good_effect: 0, effects: [slot(0, 11, 75)] }); // -25% slow
  const haste = view({ id: 2, effects: [slot(0, 11, 141)] }); // +41% haste
  // |75-100|=25 vs |141-100|=41: incoming stronger -> overwrites
  assert.equal(checkStackConflict(slow, haste, 50, 50), 1);
});

test('a single-target buff cannot replace an equal-power GROUP buff (effectMatch, different ids)', () => {
  const groupBuff = view({ id: 1, target_type: 3, effects: [slot(0, 4, 20)] });
  const singleBuff = view({ id: 2, target_type: 5, effects: [slot(0, 4, 20)] });
  assert.equal(checkStackConflict(groupBuff, singleBuff, 50, 50), -1, 'single cannot displace equal group');
  assert.equal(checkStackConflict(singleBuff, groupBuff, 50, 50), 1, 'group can displace equal single');
});

test('IGNORED_IN_STACKING SPA: a collision on a focus/vision effect never conflicts', () => {
  const a = view({ id: 1, effects: [slot(0, 57, 1)] }); // 57 is in IGNORED_IN_STACKING
  const b = view({ id: 2, effects: [slot(0, 57, 1)] });
  assert.equal(checkStackConflict(a, b, 50, 50), 0);
});

test('StackingCommand_Overwrite (149) directive forces an overwrite of a weaker worn slot', () => {
  // incoming carries 149 targeting slot 1 (1-based limit), asserting worn's slot-0 SPA 4 < max 30
  const worn = view({ id: 1, effects: [slot(0, 4, 10)] });
  const cast = view({ id: 2, effects: [slot(0, 4, 10), slot(1, 149, 4, 100, 30, 1)] });
  assert.equal(checkStackConflict(worn, cast, 50, 50), 1);
});

test('junk records never throw', () => {
  for (const bad of [{}, { effects: null }, { effects: [{}] }, { effects: [[1]] }]) {
    assert.doesNotThrow(() => checkStackConflict(spellView(bad), spellView(bad), 50, 50));
  }
});

module.exports = () => report('spell-stacking-engine');
if (require.main === module) report('spell-stacking-engine').then((n) => process.exit(n ? 1 : 0));
