'use strict';
/**
 * spellEffects.js - the actual character-stat numbers the buff optimiser ranks on (the owner,
 * 27 Aug: "rank them by best, that means numerical" / "actual character stats only").
 *
 * Each spell's effect slots travel on the roster now (`stackEffects` on every buffs.json entry).
 * The values below are the real ones from the owner's spells_us.txt (the effect ids / bases /
 * formulas verbatim); `stackEffects` is `slot,spa,base,limit,formula,max;...` with 0-indexed
 * slots. The module keeps only the slots whose effect id maps to a real character stat.
 *
 * The value is computed by the ported engine's calcSpellValue (full formula table), which agrees
 * with the old hand-cut effectValue for every formula effectValue implemented (0 / 100 / 101-105)
 * - the fixtures below are all in that set - and additionally scales the formulas it didn't
 * (109 = base + level/4, the breakpoint formulas, ...), which used to just return the raw base.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const {
  spellStats, categoryStatMap, categoryHeadline, statScore, resetCache,
  EXCLUDABLE_STATS, PRESET_EXCLUDES, combinedWeightScale,
} = require('../src/main/spellEffects');

// name -> a minimal roster entry carrying `stackEffects`.
const E = {
  strength: { name: 'Strength', kind: 'buff', category: 'Strength', stackEffects: '0,4,42,0,101,67' },
  agility: { name: 'Agility', kind: 'buff', category: 'Agility', stackEffects: '0,6,21,0,101,45' },
  aegis: { name: 'Aegis', kind: 'buff', category: 'Armor Class', stackEffects: '0,1,50,0,100,50;1,69,100,0,104,225' },
  melody: { name: 'Melody', kind: 'buff', category: 'Haste', stackEffects: '0,11,141,0,100,0' },
  bigHeal: { name: 'Big Heal', kind: 'buff', category: 'Heals', stackEffects: '0,79,500,0,100,500' },
  resistMagic: { name: 'Resist Magic', kind: 'buff', category: 'Resist Magic', stackEffects: '0,50,40,0,100,40' },
  resistFire: { name: 'Resist Fire', kind: 'buff', category: 'Resist Fire', stackEffects: '0,46,40,0,100,40' },
  clarity: { name: 'Clarity', kind: 'buff', category: 'Clarity', stackEffects: '0,15,12,0,100,12' },
  chloroplast: { name: 'Chloroplast', kind: 'buff', category: 'Regen', stackEffects: '0,0,15,0,100,15;1,189,8,0,100,8' },
  blessingOfFaith: { name: 'Blessing of Faith', kind: 'buff', category: 'Cast Speed', stackEffects: '0,127,30,0,100,30' },
  // formula 109 = base + level/4 - the old effectValue returned the raw base (5); calcSpellValue scales it.
  chantOfBattle: { name: 'Chant of Battle', kind: 'buff', category: 'Chant', stackEffects: '1,4,5,0,109,0' },
};
resetCache();

test('spellStats reads the real value of each character-stat slot', () => {
  const str = spellStats(E.strength, 50);
  assert.equal(str.length, 1);
  assert.equal(str[0].stat, 'STR');
  assert.equal(str[0].value, 67, 'base 42 + level/2 (25), capped at max 67');
});

test('haste keeps its 100-based value (141 = +41%)', () => {
  const [haste] = spellStats(E.melody, 50);
  assert.equal(haste.stat, 'haste');
  assert.equal(haste.value, 141);
});

test('a slot that is not a character stat (a heal) is thrown away entirely', () => {
  assert.deepEqual(spellStats(E.bigHeal, 50), []);
});

test('a multi-stat spell returns every stat, strongest first', () => {
  const s = spellStats(E.aegis, 50);
  assert.deepEqual(s.map((x) => x.stat), ['max HP', 'AC']); // 225 then AC 12 (floor(raw 50 / 4))
  assert.equal(s.find((x) => x.stat === 'AC').value, 12, 'spell AC is stored 4x - floor(50/4) = 12');
});

test('a formula the old parser did not implement (109 = base + level/4) now scales', () => {
  assert.equal(spellStats(E.chantOfBattle, 50)[0].value, 17, 'base 5 + floor(50/4) = 17 (was 5)');
  assert.equal(spellStats(E.chantOfBattle, 1)[0].value, 5, 'at level 1 it is just the base');
});

test("categoryStatMap learns a category's headline stat from the roster", () => {
  resetCache();
  const roster = [E.strength, E.agility, E.melody, E.bigHeal];
  const map = categoryStatMap(roster);
  assert.equal(map.get('Strength'), 'STR');
  assert.equal(map.get('Agility'), 'AGI');
  assert.equal(map.get('Haste'), 'haste');
  assert.equal(map.get('Heals'), undefined, 'a heal category has no character stat');

  assert.deepEqual(categoryHeadline(roster, E.strength, 'Strength'), { stat: 'STR', value: 67 });
  assert.equal(categoryHeadline(roster, E.melody, 'Strength'), null);
});

test('statScore adds attribute points 1:1, turns haste into its bonus, weights resists down', () => {
  assert.equal(statScore(E.strength), 67);
  assert.equal(statScore(E.melody), 41); // haste 141 -> +41
  assert.equal(statScore(E.aegis), 68); // AC 12 (floor(50/4)) + max HP 225 * 0.25 = 56.25 -> 68
  assert.equal(statScore(E.bigHeal), 0);
  // magic resist is the one weighted-up resist (owner, 3 Sep): +40 * 0.4 = 16. A fire/cold/etc
  // buff would be +40 * 0.1 = 4.
  assert.equal(statScore(E.resistMagic), 16);
  assert.equal(statScore(E.resistFire), 4);
});

test('regen and cast speed rank high (the owner, 27 Aug)', () => {
  assert.equal(statScore(E.clarity), 48); // mana regen 12 * 4
  assert.equal(statScore(E.chloroplast), 92); // HP regen 15 * 4 + endurance regen 8 * 4
  assert.equal(statScore(E.blessingOfFaith), 150); // cast speed 30 * 5.0
  assert.equal(spellStats(E.clarity)[0].stat, 'mana regen');
  assert.equal(spellStats(E.blessingOfFaith)[0].stat, 'cast speed');
});

test('an entry with no effect data -> empty, never a throw', () => {
  assert.deepEqual(spellStats(null), []);
  assert.deepEqual(spellStats({ name: 'Custom', kind: 'buff' }), []);
  assert.equal(categoryHeadline([], null, 'Strength'), null);
  assert.equal(statScore(null), 0);
});

test("the module never exposes the game's internal effect numbers by name", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'spellEffects.js'), 'utf8');
  assert.doesNotMatch(src, /\bSPA\b/, 'the term "SPA" must not appear');
  for (const s of spellStats(E.aegis, 50)) {
    assert.equal(typeof s.stat, 'string');
    assert.ok(!/^\d/.test(s.stat), 'a stat name is a word, not a number');
  }
});

test('combinedWeightScale: each excludable stat turned off gets a hard 0; nothing else', () => {
  assert.deepEqual(combinedWeightScale([]), {});
  assert.deepEqual(combinedWeightScale(['CHA']), { CHA: 0 });
  assert.deepEqual(combinedWeightScale(['STR', 'nonsense']), { STR: 0 });
  // a resist / rune stat is not excludable - it always counts, so it can't be zeroed here
  assert.deepEqual(combinedWeightScale(['fire resist', 'rune']), {});
});

test('EXCLUDABLE_STATS is the toggle list - real stats, no resists or rune', () => {
  assert.ok(EXCLUDABLE_STATS.includes('CHA') && EXCLUDABLE_STATS.includes('STR') && EXCLUDABLE_STATS.includes('haste'));
  assert.ok(!EXCLUDABLE_STATS.includes('fire resist') && !EXCLUDABLE_STATS.includes('all resists'));
  assert.ok(!EXCLUDABLE_STATS.includes('rune') && !EXCLUDABLE_STATS.includes('spell rune'));
  assert.ok(EXCLUDABLE_STATS.every((n) => typeof n === 'string' && !/^\d/.test(n)));
});

test('PRESET_EXCLUDES: melee drops caster stats, caster drops melee stats, balanced drops none', () => {
  assert.deepEqual(PRESET_EXCLUDES.balanced, []);
  assert.ok(PRESET_EXCLUDES.melee.includes('WIS') && PRESET_EXCLUDES.melee.includes('INT'));
  assert.ok(PRESET_EXCLUDES.caster.includes('STR') && PRESET_EXCLUDES.caster.includes('haste'));
  // every stat a preset names must itself be excludable
  for (const list of Object.values(PRESET_EXCLUDES)) {
    for (const s of list) assert.ok(EXCLUDABLE_STATS.includes(s), `${s} in a preset but not excludable`);
  }
});

module.exports = () => report('spell-effects');
if (require.main === module) report('spell-effects').then((n) => process.exit(n ? 1 : 0));
