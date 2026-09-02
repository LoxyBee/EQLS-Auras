'use strict';
/**
 * spellEffects.js - the actual character-stat numbers the buff optimiser ranks on (Vaela, 27 Aug:
 * "rank them by best, that means numerical" / "actual character stats only").
 *
 * The rows below are copied VERBATIM from the owner's real EQ Legends spells_us.txt (the same
 * source spell-stacking.test.js uses). The pipe tail is one `slot|effect|base|_|formula|max`
 * segment per occupied slot; the module keeps only the segments whose effect number maps to a
 * real character stat and throws everything else away.
 *   - Strength (159): `1|4|42|0|101|67`  -> STR, base 42, formula 101 (+level/2), max 67
 *   - Agility (154):  `1|6|21|0|101|45`  -> AGI
 *   - AC+HP buff:     `1|1|50|0|100|50$2|69|100|0|104|225`  -> AC 50, max HP 225
 *   - Melody:         `1|11|141|0|100|0`  -> haste, kept 100-based (141 = +41%)
 *   - a heal spell:   `1|79|500|0|100|500`  -> effect 79 is not a character stat, dropped
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const { spellStats, categoryStatMap, categoryHeadline, statScore, resetCache } = require('../src/main/spellEffects');

const ROWS = [
  '159^Strength^0^^' + '0^'.repeat(168) + '1|4|42|0|101|67',
  '154^Agility^0^^' + '0^'.repeat(168) + '1|6|21|0|101|45',
  '1445^Aegis^0^^' + '0^'.repeat(168) + '1|1|50|0|100|50$2|69|100|0|104|225',
  '300^Melody^0^^' + '0^'.repeat(168) + '1|11|141|0|100|0',
  '900^Big Heal^0^^' + '0^'.repeat(168) + '1|79|500|0|100|500',
  '500^Resist Magic^0^^' + '0^'.repeat(168) + '1|50|40|0|100|40', // effect 50 = magic resist, +40
  '600^Clarity^0^^' + '0^'.repeat(168) + '1|15|12|0|100|12', // effect 15 = mana regen, +12/tick
  '601^Chloroplast^0^^' + '0^'.repeat(168) + '1|0|15|0|100|15$2|189|8|0|100|8', // HP regen +15, endurance regen +8
  '602^Blessing of Faith^0^^' + '0^'.repeat(168) + '1|127|30|0|100|30', // effect 127 = cast speed, +30%
];

let installRoot;
function setup() {
  installRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-spell-effects-'));
  fs.writeFileSync(path.join(installRoot, 'spells_us.txt'), ROWS.join('\n'), 'utf8');
  resetCache();
}
setup();

test('spellStats reads the real value of each character-stat slot', () => {
  const str = spellStats(installRoot, 159, 50);
  assert.equal(str.length, 1);
  assert.equal(str[0].stat, 'STR');
  assert.equal(str[0].value, 67, 'base 42 + level/2 (25), capped at max 67');
});

test('haste keeps its 100-based value (141 = +41%)', () => {
  const [haste] = spellStats(installRoot, 300, 50);
  assert.equal(haste.stat, 'haste');
  assert.equal(haste.value, 141);
});

test('a slot that is not a character stat (a heal) is thrown away entirely', () => {
  assert.deepEqual(spellStats(installRoot, 900, 50), []);
});

test('a multi-stat spell returns every stat, strongest first', () => {
  const s = spellStats(installRoot, 1445, 50);
  assert.deepEqual(s.map((x) => x.stat), ['max HP', 'AC']); // 225 then 50
  assert.equal(s.find((x) => x.stat === 'AC').value, 50);
});

test('categoryStatMap learns a category\'s headline stat from the roster', () => {
  resetCache();
  const roster = [
    { kind: 'buff', spellId: 159, category: 'Strength' },
    { kind: 'buff', spellId: 154, category: 'Agility' },
    { kind: 'buff', spellId: 300, category: 'Haste' },
    { kind: 'buff', spellId: 900, category: 'Heals' },
  ];
  const map = categoryStatMap(installRoot, roster);
  assert.equal(map.get('Strength'), 'STR');
  assert.equal(map.get('Agility'), 'AGI');
  assert.equal(map.get('Haste'), 'haste');
  assert.equal(map.get('Heals'), undefined, 'a heal category has no character stat');

  assert.deepEqual(categoryHeadline(installRoot, roster, 159, 'Strength'), { stat: 'STR', value: 67 });
  assert.equal(categoryHeadline(installRoot, roster, 300, 'Strength'), null);
});

test('statScore adds attribute points 1:1, turns haste into its bonus, weights resists down', () => {
  assert.equal(statScore(installRoot, 159), 67); // STR 67
  assert.equal(statScore(installRoot, 300), 41); // haste 141 -> +41
  assert.equal(statScore(installRoot, 1445), 106); // AC 50 + max HP 225 * 0.25 = 106.25 -> 106 (Fix 5)
  assert.equal(statScore(installRoot, 900), 0); // heal -> nothing
  assert.equal(statScore(installRoot, 500), 4); // +40 magic resist * 0.1 = 4 - situational, well below a real stat
});

test('regen and cast speed rank high (Vaela, 27 Aug)', () => {
  assert.equal(statScore(installRoot, 600), 48); // mana regen 12 * 4
  assert.equal(statScore(installRoot, 601), 92); // HP regen 15 * 4 + endurance regen 8 * 4
  assert.equal(statScore(installRoot, 602), 150); // cast speed 30 * 5.0 (Fix 8a - level with haste)
  const clarity = spellStats(installRoot, 600);
  assert.equal(clarity[0].stat, 'mana regen');
  const bof = spellStats(installRoot, 602);
  assert.equal(bof[0].stat, 'cast speed');
});

test('no install root -> empty, never a throw', () => {
  assert.deepEqual(spellStats(null, 159), []);
  assert.equal(categoryHeadline(null, [], 159, 'Strength'), null);
  assert.equal(statScore(null, 159), 0);
});

test('the module never exposes the game\'s internal effect numbers by name', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'spellEffects.js'), 'utf8');
  assert.doesNotMatch(src, /\bSPA\b/, 'the term "SPA" must not appear');
  for (const s of spellStats(installRoot, 1445, 50)) {
    assert.equal(typeof s.stat, 'string');
    assert.ok(!/^\d/.test(s.stat), 'a stat name is a word, not a number');
  }
});

module.exports = () => report('spell-effects');
if (require.main === module) report('spell-effects').then((n) => process.exit(n ? 1 : 0));
