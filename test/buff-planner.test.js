'use strict';
/**
 * The buff optimiser - src/main/buffPlanner.js.
 *
 * Shara, 26-27 Aug. The model, after a wrong first pass she caught with a real 14-buff loadout
 * (cleric/shaman/bard, all stacking): the roster's `category` column is a STAT LABEL, not a
 * stacking line - Strength AND Infusion of Spirit AND Talisman of Altuna all stack and all belong.
 * So the planner does NOT collapse by category. It keeps every stat/combat buff the classes can
 * cast; the only thing removed is a weaker tier of a buff line (decided by the game's own stacking
 * data via spellStacking, or by a shared base name when the spell file isn't available). Ranking
 * is purely by the character-stat numbers. The user arranges the 14 by dragging the priority list.
 */

const assert = require('node:assert/strict');
const path = require('node:path');
const { test, report } = require('./harness');
const {
  computePlan,
  normalizeClasses,
  normalizeClassCodes,
  parseSpellClasses,
  clampLevel,
  SLOT_COUNT,
  DEFAULT_LEVEL,
  MAX_CHARACTER_LEVEL,
} = require('../src/main/buffPlanner');

const buff = (over) => ({ kind: 'buff', targets: 'Self', durationSec: 600, ...over });
const stat = (name, value, order = 0) => ({ stat: name, value, order });

// Stand-in for the real spellEffects.js wiring: { spellId -> [{stat,value,order}] }. The headline
// is just the biggest one, which is enough for the tests.
function fakeSpellData(byId) {
  const stats = (id) => (byId[id] || []).slice().sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  return {
    stats,
    headline: (id) => {
      const s = stats(id);
      return s.length ? { stat: s[0].stat, value: s[0].value } : null;
    },
    score: (id) => stats(id).reduce((sum, s) => sum + Math.abs(s.value), 0),
    multiplierStats: new Set(['haste', 'spell haste']),
  };
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

test('the character-level cap is 50, and DEFAULT_LEVEL sits at it', () => {
  assert.equal(MAX_CHARACTER_LEVEL, 50);
  assert.equal(DEFAULT_LEVEL, 50);
});

test('clampLevel keeps a real number, falls back on junk', () => {
  assert.equal(clampLevel(42), 42);
  assert.equal(clampLevel('30'), 30);
  assert.equal(clampLevel(0), 1);
  assert.equal(clampLevel('x'), DEFAULT_LEVEL);
});

test('normalizeClassCodes dedupes, caps at three, drops the unknown', () => {
  assert.deepEqual(normalizeClassCodes(['enc', 'ENC', 'BOGUS', 'SHM', 'CLR', 'DRU']), ['ENC', 'SHM', 'CLR']);
  assert.deepEqual(normalizeClassCodes('not an array'), []);
});

test('normalizeClasses pairs every class with the ONE shared character level', () => {
  assert.deepEqual(normalizeClasses(['ENC', 'SHM'], 44), [
    { code: 'ENC', level: 44 },
    { code: 'SHM', level: 44 },
  ]);
  assert.deepEqual(normalizeClasses(['CLR']), [{ code: 'CLR', level: DEFAULT_LEVEL }]);
});

test('parseSpellClasses reads the roster\'s own "CODE LEVEL · CODE LEVEL" format', () => {
  assert.deepEqual(parseSpellClasses('ENC 21 · SHM 42'), [
    { code: 'ENC', level: 21 },
    { code: 'SHM', level: 42 },
  ]);
});

// ---------------------------------------------------------------------------
// candidate selection
// ---------------------------------------------------------------------------

test('a buff is only a candidate if a chosen class can cast it at the character level', () => {
  const roster = [
    buff({ name: 'Low Str', spellId: 1, category: 'Strength', classes: 'SHM 40', level: 40 }),
    buff({ name: 'High Str', spellId: 2, category: 'Strength', classes: 'SHM 55', level: 55 }),
  ];
  assert.deepEqual(computePlan({ roster, classes: ['SHM'], level: 45 }).candidates.map((c) => c.name), ['Low Str']);
  assert.deepEqual(
    computePlan({ roster, classes: ['SHM'], level: 55 }).candidates.map((c) => c.name).sort(),
    ['High Str', 'Low Str'],
    'both reachable at 55 - different names, both kept (category is not a stacking line)'
  );
});

test('non-player targets and non-buff kinds are excluded outright', () => {
  const roster = [
    buff({ name: 'Real Buff', spellId: 1, category: 'Strength', classes: 'SHM 20', level: 20 }),
    buff({ name: 'Pet Buff', spellId: 2, category: 'Strength', classes: 'SHM 20', level: 20, targets: 'Pet' }),
    buff({ name: 'Enemy Snare', spellId: 3, kind: 'det', category: 'Movement', classes: 'RNG 20', level: 20 }),
    buff({ name: 'Group Buff', spellId: 4, category: 'Armor Class', classes: 'DRU 20', level: 20, targets: 'Group' }),
  ];
  const names = computePlan({ roster, classes: ['SHM', 'RNG', 'DRU'] }).candidates.map((c) => c.name).sort();
  assert.deepEqual(names, ['Group Buff', 'Real Buff']);
});

test('heals and pure-utility categories are dropped; Spell Focus is NOT (it is a real slot)', () => {
  const roster = [
    buff({ name: 'Real Str', spellId: 1, category: 'Strength', classes: 'SHM 20', level: 20 }),
    buff({ name: 'An Echo Heal', spellId: 2, category: 'Echoes', classes: 'CLR 20', level: 20 }),
    buff({ name: 'A Delayed Heal', spellId: 3, category: 'Delayed', classes: 'CLR 20', level: 20 }),
    buff({ name: 'A HoT', spellId: 4, category: 'Whatever', scaleCategory: 'hot', classes: 'SHM 20', level: 20 }),
    buff({ name: 'Run Faster', spellId: 5, category: 'Movement', classes: 'SHM 20', level: 20 }),
    buff({ name: 'Look Like A Bear', spellId: 6, category: 'Illusion: Other', classes: 'SHM 20', level: 20 }),
    buff({ name: 'Blessing of Faith', spellId: 7, category: 'Spell Focus', classes: 'CLR 20', level: 20 }),
  ];
  const names = computePlan({ roster, classes: ['SHM', 'CLR'] }).candidates.map((c) => c.name).sort();
  assert.deepEqual(names, ['Blessing of Faith', 'Real Str']);
});

test('two different buffs in the same category BOTH stay - category is a stat label, not a line', () => {
  // Shara's reference loadout: Strength and Infusion of Spirit, both category "Strength".
  const roster = [
    buff({ name: 'Strength', spellId: 1, category: 'Strength', classes: 'SHM 46', level: 46 }),
    buff({ name: 'Infusion of Spirit', spellId: 2, category: 'Strength', classes: 'SHM 49', level: 49 }),
  ];
  assert.deepEqual(
    computePlan({ roster, classes: ['SHM'] }).candidates.map((c) => c.name).sort(),
    ['Infusion of Spirit', 'Strength']
  );
});

test('a rank line (shared base name) collapses to the highest, when there is no spell file', () => {
  const roster = [
    buff({ name: 'Yaulp', spellId: 1, category: 'Attack', classes: 'CLR 1', level: 1 }),
    buff({ name: 'Yaulp II', spellId: 2, category: 'Attack', classes: 'CLR 16', level: 16 }),
    buff({ name: 'Yaulp III', spellId: 3, category: 'Attack', classes: 'CLR 41', level: 41 }),
  ];
  assert.deepEqual(computePlan({ roster, classes: ['CLR'] }).candidates.map((c) => c.name), ['Yaulp III']);
});

test('a multiclass buff records every chosen class that can cast it', () => {
  const roster = [buff({ name: 'Alacrity', spellId: 1, category: 'Haste', classes: 'ENC 21 · SHM 42', level: 21 })];
  assert.deepEqual(computePlan({ roster, classes: ['ENC', 'SHM'], level: 45 }).candidates[0].castByClasses.sort(), ['ENC', 'SHM']);
  assert.deepEqual(computePlan({ roster, classes: ['ENC', 'SHM'], level: 30 }).candidates[0].castByClasses, ['ENC']);
});

// ---------------------------------------------------------------------------
// the real collapse: the game's stacking data
// ---------------------------------------------------------------------------

test('spellStacking drops the weaker tier of a line but keeps a different buff on other slots', () => {
  const roster = [
    buff({ name: 'Strengthen', spellId: 1, category: 'Strength', classes: 'SHM 1', level: 1 }),
    buff({ name: 'Strength', spellId: 2, category: 'Strength', classes: 'SHM 46', level: 46 }),
    buff({ name: 'Infusion of Spirit', spellId: 3, category: 'Strength', classes: 'SHM 49', level: 49 }),
  ];
  // Strengthen and Strength are the same line (Strength cleanly overwrites Strengthen).
  // Infusion of Spirit puts its STR on a different slot - it overwrites neither and neither
  // overwrites it.
  const checkStack = (activeId, incomingId) => {
    if (activeId === 1 && incomingId === 2) return { overwrites: true }; // Strength beats Strengthen
    return null; // everything else coexists
  };
  const plan = computePlan({ roster, classes: ['SHM'], checkStack });
  assert.deepEqual(plan.candidates.map((c) => c.name).sort(), ['Infusion of Spirit', 'Strength']);
  assert.equal(plan.stackingKnown, true);
  assert.equal(plan.overflow.find((o) => o.name === 'Strengthen').reason, 'Strength is the stronger version');
});

test('a mutual/ambiguous stacking pair keeps both - the player decides', () => {
  const roster = [
    buff({ name: 'A', spellId: 1, category: 'X', classes: 'CLR 10', level: 10 }),
    buff({ name: 'B', spellId: 2, category: 'X', classes: 'CLR 10', level: 10 }),
  ];
  const checkStack = () => ({ overwrites: true }); // both directions say "overwrites"
  assert.deepEqual(computePlan({ roster, classes: ['CLR'], checkStack }).candidates.map((c) => c.name).sort(), ['A', 'B']);
});

test('stackingKnown is false when there is no spell file', () => {
  const plan = computePlan({ roster: [buff({ name: 'X', spellId: 1, category: 'Strength', classes: 'CLR 10', level: 10 })], classes: ['CLR'] });
  assert.equal(plan.stackingKnown, false);
});

test('collapse never fires across categories - Altuna (Shielding) survives a resist talisman', () => {
  const roster = [
    buff({ name: 'Talisman of Altuna', spellId: 1, category: 'Shielding', classes: 'SHM 40', level: 40 }),
    buff({ name: 'Talisman of Jasinth', spellId: 2, category: 'Resist Buff', classes: 'SHM 50', level: 50 }),
  ];
  const checkStack = () => ({ overwrites: true }); // even if the game says they conflict...
  const names = computePlan({ roster, classes: ['SHM'], checkStack }).candidates.map((c) => c.name).sort();
  assert.deepEqual(names, ['Talisman of Altuna', 'Talisman of Jasinth'], 'different categories are never collapsed');
});

test('a buff with a unique stat is not dropped as a "weaker version"', () => {
  const roster = [
    buff({ name: 'AC + Resist', spellId: 1, category: 'Shielding', classes: 'SHM 40', level: 40 }),
    buff({ name: 'Pure Resist', spellId: 2, category: 'Shielding', classes: 'SHM 50', level: 50 }),
  ];
  const spellData = fakeSpellData({
    1: [stat('AC', 40, 0), stat('magic resist', 20, 11)],
    2: [stat('magic resist', 45, 11)],
  });
  const checkStack = (a, b) => (a === 1 && b === 2 ? { overwrites: true } : null); // Pure Resist "overwrites" AC + Resist
  const names = computePlan({ roster, classes: ['SHM'], checkStack, spellData }).candidates.map((c) => c.name).sort();
  assert.deepEqual(names, ['AC + Resist', 'Pure Resist'], 'AC + Resist keeps its slot - it has AC the other lacks');
});

test('a permanent buff and a temp buff of the same line are compared, not both kept', () => {
  const roster = [
    buff({ name: 'Rage', spellId: 1, category: 'Strength', classes: 'SHM 45', level: 45 }),
    buff({ name: 'Fury', spellId: 2, category: 'Strength', classes: 'SHM 30', level: 30, infiniteDuration: true, durationSec: null }),
  ];
  const spellData = fakeSpellData({ 1: [stat('STR', 51, 2)], 2: [stat('STR', 30, 2)] });
  const checkStack = (a, b) => (a === 2 && b === 1 ? { overwrites: true } : null); // Rage overwrites Fury
  const plan = computePlan({ roster, classes: ['SHM'], checkStack, spellData });
  const all = [...plan.candidates, ...plan.permanentSlots].map((c) => c.name);
  assert.deepEqual(all, ['Rage'], 'Fury is dropped - Rage is the stronger version of the same line');
});

test('the dragged priority order still overrides the default score order', () => {
  const roster = [
    buff({ name: 'Big', spellId: 1, category: 'Strength', classes: 'CLR 10', level: 10 }),
    buff({ name: 'Small', spellId: 2, category: 'Agility', classes: 'CLR 10', level: 10 }),
  ];
  const spellData = fakeSpellData({ 1: [stat('STR', 100, 2)], 2: [stat('AGI', 5, 5)] });
  // Big has the bigger score, but the user dragged Small to the top.
  const plan = computePlan({ roster, classes: ['CLR'], spellData, priorityOrder: ['Small', 'Big'] });
  assert.deepEqual(plan.candidates.map((c) => c.name), ['Small', 'Big']);
});

// ---------------------------------------------------------------------------
// ranking, slots, totals
// ---------------------------------------------------------------------------

test('no classes in -> an empty plan out, not a throw', () => {
  const plan = computePlan({ roster: [], classes: [] });
  assert.deepEqual(plan.classes, []);
  for (const k of ['slots', 'overflow', 'candidates', 'songSlots', 'songOverflow', 'songCandidates', 'permanentSlots', 'permanentOverflow', 'totals']) {
    assert.deepEqual(plan[k], [], `${k} should be empty`);
  }
});

test('the 14-slot cap holds; the rest overflow as "no free slot"', () => {
  const big = [];
  for (let i = 0; i < 20; i++) big.push(buff({ name: `BuffNum${i}`, spellId: 100 + i, category: `Cat${i}`, classes: 'CLR 10', level: 10 }));
  const plan = computePlan({ roster: big, classes: ['CLR'] });
  assert.equal(plan.slots.length, SLOT_COUNT);
  assert.equal(plan.overflow.length, 6);
  assert.ok(plan.overflow.every((o) => o.reason === 'no free slot'));
});

test('the dragged priority order decides which buffs win the slots', () => {
  const big = [];
  for (let i = 0; i < 16; i++) big.push(buff({ name: `BuffNum${i}`, spellId: 200 + i, category: `Cat${i}`, classes: 'CLR 10', level: 10 }));
  const plan = computePlan({ roster: big, classes: ['CLR'], priorityOrder: ['BuffNum15', 'BuffNum14'] }); // P/O = the 15th/16th
  assert.equal(plan.slots[0].name, 'BuffNum15');
  assert.equal(plan.slots[1].name, 'BuffNum14');
  assert.equal(plan.slots.length, 14);
  assert.deepEqual(plan.overflow.map((o) => o.name).sort(), ['BuffNum8', 'BuffNum9']);
});

test('best of a stat = the bigger number, not level or duration', () => {
  const roster = [
    buff({ name: 'Weak Haste', spellId: 1, category: 'Haste', classes: 'ENC 50', level: 50, durationSec: 9999 }),
    buff({ name: 'Strong Haste', spellId: 2, category: 'Haste', classes: 'ENC 10', level: 10, durationSec: 60 }),
  ];
  // same line (one overwrites the other), so only one survives - the one with the bigger haste
  const checkStack = (a, b) => (a === 1 && b === 2 ? { overwrites: true } : a === 2 && b === 1 ? null : null);
  const spellData = fakeSpellData({ 1: [stat('haste', 115, 9)], 2: [stat('haste', 141, 9)] });
  const plan = computePlan({ roster, classes: ['ENC'], checkStack, spellData });
  assert.deepEqual(plan.candidates.map((c) => c.name), ['Strong Haste']);
});

test('totals sum each stat across every slotted buff; haste is kept-best not summed', () => {
  const roster = [
    buff({ name: 'Str A', spellId: 1, category: 'Strength', classes: 'SHM 20', level: 20 }),
    buff({ name: 'AC A', spellId: 2, category: 'Armor Class', classes: 'CLR 20', level: 20 }),
    buff({ name: 'Haste A', spellId: 3, category: 'Haste', classes: 'ENC 20', level: 20 }),
    buff({ name: 'Multi', spellId: 4, category: 'Combat Innates', classes: 'SHM 20', level: 20 }),
  ];
  const spellData = fakeSpellData({
    1: [stat('STR', 50, 2)],
    2: [stat('AC', 80, 0)],
    3: [stat('haste', 130, 9)],
    4: [stat('STR', 20, 2), stat('ATK', 40, 1)],
  });
  const plan = computePlan({ roster, classes: ['SHM', 'CLR', 'ENC'], spellData });
  const byStat = Object.fromEntries(plan.totals.map((t) => [t.stat, t.value]));
  assert.equal(byStat.STR, 70);
  assert.equal(byStat.AC, 80);
  assert.equal(byStat.ATK, 40);
  assert.equal(byStat.haste, 130, 'kept-best, not summed');
  assert.deepEqual(plan.totals.map((t) => t.stat), ['AC', 'ATK', 'STR', 'haste'], 'character-sheet order');
});

// ---------------------------------------------------------------------------
// the three pools
// ---------------------------------------------------------------------------

test('bard songs get their own 5-slot pool, only when Bard is picked', () => {
  const roster = [
    buff({ name: 'A Song', spellId: 1, category: 'Haste', classes: 'BRD 10', level: 10, isBardSong: true }),
    buff({ name: 'A Spell', spellId: 2, category: 'Attack', classes: 'ENC 30', level: 30 }),
  ];
  const noBard = computePlan({ roster, classes: ['ENC'] });
  assert.deepEqual(noBard.songSlots, []);
  assert.deepEqual(noBard.candidates.map((c) => c.name), ['A Spell'], 'the song is not castable without a Bard');

  const withBard = computePlan({ roster, classes: ['BRD', 'ENC'] });
  assert.equal(withBard.hasBard, true);
  assert.deepEqual(withBard.songSlots.map((s) => s.name), ['A Song']);
  assert.deepEqual(withBard.slots.map((s) => s.name), ['A Spell']);
});

test('the song pool is capped at five; the rest overflow', () => {
  const roster = [];
  for (let i = 0; i < 8; i++) roster.push(buff({ name: `SongNum${i}`, spellId: 100 + i, category: `SC${i}`, classes: 'BRD 10', level: 10, isBardSong: true }));
  const plan = computePlan({ roster, classes: ['BRD'] });
  assert.equal(plan.songSlots.length, 5);
  assert.equal(plan.songOverflow.length, 3);
});

test('permanent buffs are an uncapped pool of their own, kept even when a temp buff shares the stat', () => {
  const roster = [
    buff({ name: 'Yaulp III', spellId: 1, category: 'Attack', classes: 'CLR 41', level: 41, infiniteDuration: true, durationSec: null }),
    buff({ name: 'Fury', spellId: 2, category: 'Strength', classes: 'SHM 30', level: 30, infiniteDuration: true, durationSec: null }),
    buff({ name: 'Infusion of Spirit', spellId: 3, category: 'Strength', classes: 'SHM 49', level: 49 }),
  ];
  const plan = computePlan({ roster, classes: ['CLR', 'SHM'] });
  assert.deepEqual(plan.slots.map((s) => s.name), ['Infusion of Spirit']);
  assert.deepEqual(plan.permanentSlots.map((s) => s.name).sort(), ['Fury', 'Yaulp III']);
  assert.equal(plan.permanentOverflow.length, 0);
});

// ---------------------------------------------------------------------------
// against the real roster + Shara's reference loadout
// ---------------------------------------------------------------------------

test('the real roster: cleric/shaman/bard has every buff from the reference loadout as a candidate', () => {
  let roster;
  try {
    roster = require(path.join('..', 'src', 'shared', 'data', 'buffs.json'));
  } catch {
    return;
  }
  roster = roster.buffs || roster;
  const plan = computePlan({ roster, classes: ['CLR', 'SHM', 'BRD'], level: 50 });
  const reference = [
    'Stamina', 'Strength', 'Dexterity', 'Infusion of Spirit', 'Agility', 'Charisma',
    'Talisman of Altuna', 'Symbol of Naltron', 'Resolution', 'Shield of Words',
    'Blessing of the Lord Commander', 'Resist Magic', 'Guard of Vie', 'Blessing of Faith',
  ];
  const available = new Set([...plan.candidates, ...plan.songCandidates].map((c) => c.name));
  const missing = reference.filter((n) => !available.has(n));
  assert.deepEqual(missing, [], 'the planner must offer every buff in a real, valid loadout');
});

test('the real roster: a full 14 comes out, and Strength + Infusion of Spirit both survive', () => {
  let roster;
  try {
    roster = require(path.join('..', 'src', 'shared', 'data', 'buffs.json'));
  } catch {
    return;
  }
  roster = roster.buffs || roster;
  const order = ['Strength', 'Infusion of Spirit'];
  const plan = computePlan({ roster, classes: ['CLR', 'SHM', 'BRD'], level: 50, priorityOrder: order });
  assert.equal(plan.slots.length, 14);
  assert.equal(plan.slots[0].name, 'Strength');
  assert.equal(plan.slots[1].name, 'Infusion of Spirit');
});

module.exports = () => report('buff-planner');
if (require.main === module) report('buff-planner').then((n) => process.exit(n ? 1 : 0));
