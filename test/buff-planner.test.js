'use strict';
/**
 * The buff optimiser - src/main/buffPlanner.js.
 *
 * Vaela, 26-27 Aug. The model, after a wrong first pass she caught with a real 14-buff loadout
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
const buffLines = require('../src/shared/buffLines');

const buff = (over) => ({ kind: 'buff', targets: 'Self', durationSec: 600, ...over });
const stat = (name, value, order = 0) => ({ stat: name, value, order });

// Load a hand-built line set for a test, restore the shipped data after.
function withLines(headings, lines, blockedPairs, fn) {
  buffLines.loadData({ headings: headings || {}, lines: lines || [], blockedPairs: blockedPairs || [] });
  try {
    fn(buffLines);
  } finally {
    buffLines.loadData();
  }
}

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
  // Vaela's reference loadout: Strength and Infusion of Spirit, both category "Strength".
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
// the heading model (src/shared/buffLines.js)
// ---------------------------------------------------------------------------

const HEADING_LINES = [
  { id: 'shm.str', headings: ['str.primary'], members: ['Strengthen', 'Strength'], stacksWith: ['shm.frenzy'] },
  { id: 'shm.frenzy', headings: ['ac.slot3', 'str.short'], members: ['Frenzy', 'Fury', 'Rage'], stacksWith: ['shm.str'] },
  { id: 'shm.infusion', headings: ['str.infusion', 'dex.infusion'], members: ['Infusion of Spirit'], stacksWith: ['shm.str'] },
  { id: 'shm.talisman', headings: ['hp.talisman'], members: ['Talisman of Altuna', 'Talisman of Kragg'] },
  { id: 'shm.jasinth', headings: ['resist.disease'], members: ['Talisman of Jasinth'] },
  { id: 'cleric.aegis', headings: ['ac.slot4'], members: ['Shield of Words', 'Aegis'] },
  { id: 'shm.ac', headings: ['ac.slot4'], members: ['Guardian'], conflictsWith: ['cleric.aegis'] },
  { id: 'cleric.aegolism', combination: true, headings: ['ac.slot1', 'ac.slot4', 'hp.combination'], blocks: ['cleric.aegis', 'shm.ac'], members: ['Aegolism'] },
];

test('two buffs that share a stat but sit on different headings BOTH stay', () => {
  const roster = [
    buff({ name: 'Strength', spellId: 1, category: 'Strength', classes: 'SHM 46', level: 46 }),
    buff({ name: 'Fury', spellId: 2, category: 'Strength', classes: 'SHM 30', level: 30 }),
    buff({ name: 'Infusion of Spirit', spellId: 3, category: 'Strength', classes: 'SHM 49', level: 49 }),
  ];
  withLines({}, HEADING_LINES, [], (lines) => {
    const names = computePlan({ roster, classes: ['SHM'], lines }).candidates.map((c) => c.name).sort();
    assert.deepEqual(names, ['Fury', 'Infusion of Spirit', 'Strength'], 'all three sit on different headings');
  });
});

test('a line collapses to its highest castable tier', () => {
  const roster = [
    buff({ name: 'Strengthen', spellId: 1, category: 'Strength', classes: 'SHM 1', level: 1 }),
    buff({ name: 'Strength', spellId: 2, category: 'Strength', classes: 'SHM 46', level: 46 }),
  ];
  withLines({}, HEADING_LINES, [], (lines) => {
    const plan = computePlan({ roster, classes: ['SHM'], lines });
    assert.deepEqual(plan.candidates.map((c) => c.name), ['Strength']);
    assert.equal(plan.overflow.find((o) => o.name === 'Strengthen').reason, 'Strength is the higher tier');
  });
});

test('short buffs (<= 5 min) and Combat Innates go to their own pool, out of the 14', () => {
  const roster = [
    buff({ name: 'Standing STR', spellId: 1, category: 'Strength', classes: 'SHM 20', level: 20, durationSec: 3600 }),
    buff({ name: 'Puma', spellId: 2, category: 'Attack', classes: 'SHM 20', level: 20, durationSec: 60 }),
    buff({ name: 'Ward', spellId: 3, category: 'Combat Innates', classes: 'CLR 20', level: 20, durationSec: 1200 }),
  ];
  const spellData = fakeSpellData({ 1: [stat('STR', 40, 0)], 2: [stat('ATK', 30, 0)], 3: [stat('AC', 20, 0)] });
  const plan = computePlan({ roster, classes: ['SHM', 'CLR'], spellData });
  assert.deepEqual(plan.slots.map((s) => s.name), ['Standing STR'], 'only the long buff is in the 14');
  assert.deepEqual(plan.combatSlots.map((s) => s.name).sort(), ['Puma', 'Ward'], 'short + Combat Innates -> combat pool');
  // combat buffs are NOT in the standing totals
  assert.equal(plan.totals.find((t) => t.stat === 'ATK'), undefined);
});

test('a slotted buff carries `beat` - the buffs it displaced for its slot, with reasons', () => {
  const roster = [
    buff({ name: 'Strengthen', spellId: 1, category: 'Strength', classes: 'SHM 1', level: 1 }),
    buff({ name: 'Strength', spellId: 2, category: 'Strength', classes: 'SHM 46', level: 46 }),
    buff({ name: 'Guardian', spellId: 3, category: 'Armor Class', classes: 'SHM 42', level: 42 }),
    buff({ name: 'Shield of Words', spellId: 4, category: 'Armor Class', classes: 'CLR 45', level: 45 }),
  ];
  const spellData = fakeSpellData({
    1: [stat('STR', 10, 0)], 2: [stat('STR', 40, 0)],
    3: [stat('AC', 30, 0)], 4: [stat('AC', 45, 0)],
  });
  withLines({}, HEADING_LINES, [], (lines) => {
    const plan = computePlan({ roster, classes: ['CLR', 'SHM'], lines, spellData });
    const str = plan.slots.find((s) => s.name === 'Strength');
    assert.ok(str.beat.some((b) => b.name === 'Strengthen'), 'Strength beat the lower tier Strengthen');
    assert.match(str.beat.find((b) => b.name === 'Strengthen').reason, /higher tier/);
    const sow = plan.slots.find((s) => s.name === 'Shield of Words');
    assert.ok(sow.beat.some((b) => b.name === 'Guardian'), 'Shield of Words beat Guardian for the AC slot');
    // an uncontested buff has an empty beat list, not undefined
    assert.ok(Array.isArray(str.beat));
  });
});

test('a line collapses to its best tier ACROSS the permanent/temp split (Frenzy vs Rage)', () => {
  // shm.frenzy = Frenzy (finite) -> temp pool, Fury/Rage (permanent) -> permanent pool. Each pool
  // used to collapse only its own members, leaving Frenzy AND Rage both on screen. Reported by the
  // owner: "rage and frenzy are the same spell line and are both permanent".
  const roster = [
    buff({ name: 'Frenzy', spellId: 1, category: 'Strength', classes: 'SHM 16', level: 16 }),
    buff({ name: 'Fury', spellId: 2, category: 'Strength', classes: 'SHM 30', level: 30, infiniteDuration: true, durationSec: null }),
    buff({ name: 'Rage', spellId: 3, category: 'Strength', classes: 'SHM 45', level: 45, infiniteDuration: true, durationSec: null }),
  ];
  withLines({}, HEADING_LINES, [], (lines) => {
    const plan = computePlan({ roster, classes: ['SHM'], lines });
    assert.deepEqual(plan.permanentSlots.map((s) => s.name), ['Rage'], 'only the top tier is listed');
    assert.deepEqual(plan.slots.map((s) => s.name), [], 'Frenzy does not also take a spell slot');
    const frenzy = plan.overflow.find((o) => o.name === 'Frenzy');
    assert.equal(frenzy && frenzy.reason, 'Rage is the higher tier');
    assert.equal(plan.permanentOverflow.find((o) => o.name === 'Fury').reason, 'Rage is the higher tier');
  });
});

test('two different lines that share a heading conflict - one to overflow', () => {
  const roster = [
    buff({ name: 'Shield of Words', spellId: 1, category: 'Armor Class', classes: 'CLR 45', level: 45 }),
    buff({ name: 'Guardian', spellId: 2, category: 'Armor Class', classes: 'SHM 42', level: 42 }),
  ];
  const spellData = fakeSpellData({ 1: [stat('AC', 40, 0)], 2: [stat('AC', 35, 0)] });
  withLines({}, HEADING_LINES, [], (lines) => {
    const plan = computePlan({ roster, classes: ['CLR', 'SHM'], lines, spellData });
    assert.deepEqual(plan.slots.map((s) => s.name), ['Shield of Words'], 'the bigger AC wins slot 4');
    assert.equal(plan.overflow.find((o) => o.name === 'Guardian').reason, 'conflicts with Shield of Words');
  });
});

test('cross-heading pairs never conflict - Talisman of Altuna (HP) and Talisman of Jasinth (disease resist)', () => {
  const roster = [
    buff({ name: 'Talisman of Altuna', spellId: 1, category: 'Shielding', classes: 'SHM 40', level: 40 }),
    buff({ name: 'Talisman of Jasinth', spellId: 2, category: 'Resist Buff', classes: 'SHM 50', level: 50 }),
  ];
  withLines({}, HEADING_LINES, [], (lines) => {
    const names = computePlan({ roster, classes: ['SHM'], lines }).candidates.map((c) => c.name).sort();
    assert.deepEqual(names, ['Talisman of Altuna', 'Talisman of Jasinth']);
  });
});

test('a measured blocked-pair is honoured directionally, even across different lines', () => {
  const roster = [
    buff({ name: 'Arch Shielding', spellId: 1, category: 'Shielding', classes: 'ENC 40', level: 40 }),
    buff({ name: 'Talisman of Altuna', spellId: 2, category: 'Shielding', classes: 'SHM 40', level: 40 }),
  ];
  const pairs = [{ blocked: 'Arch Shielding', by: 'Talisman of Altuna' }];
  withLines({}, [{ id: 'ench.shield', headings: ['x'], members: ['Arch Shielding'] }, { id: 'shm.tal', headings: ['y'], members: ['Talisman of Altuna'] }], pairs, () => {
    // priority puts Talisman first, so Arch Shielding is the one that can't land
    const plan = computePlan({ roster, classes: ['ENC', 'SHM'], lines: buffLines, priorityOrder: ['Talisman of Altuna'] });
    assert.deepEqual(plan.slots.map((s) => s.name), ['Talisman of Altuna']);
    assert.equal(plan.overflow.find((o) => o.name === 'Arch Shielding').reason, 'conflicts with Talisman of Altuna');
  });
});

test('a combination buff blocks the individual lines it subsumes', () => {
  const roster = [
    buff({ name: 'Aegolism', spellId: 1, category: 'HP Buff (Line 1)', classes: 'CLR 50', level: 50 }),
    buff({ name: 'Shield of Words', spellId: 2, category: 'Armor Class', classes: 'CLR 45', level: 45 }),
  ];
  withLines({}, HEADING_LINES, [], (lines) => {
    const plan = computePlan({ roster, classes: ['CLR'], lines, priorityOrder: ['Aegolism', 'Shield of Words'] });
    assert.deepEqual(plan.slots.map((s) => s.name), ['Aegolism']);
    assert.equal(plan.overflow.find((o) => o.name === 'Shield of Words').reason, 'conflicts with Aegolism');
  });
});

test('the dragged priority order still overrides the default score order', () => {
  const roster = [
    buff({ name: 'Big', spellId: 1, category: 'Strength', classes: 'CLR 10', level: 10 }),
    buff({ name: 'Small', spellId: 2, category: 'Agility', classes: 'CLR 10', level: 10 }),
  ];
  const spellData = fakeSpellData({ 1: [stat('STR', 100, 2)], 2: [stat('AGI', 5, 5)] });
  const plan = computePlan({ roster, classes: ['CLR'], spellData, priorityOrder: ['Small', 'Big'], lines: buffLines });
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
    buff({ name: 'Strong Haste', spellId: 2, category: 'Haste', classes: 'ENC 10', level: 10, durationSec: 9999 }),
  ];
  // same line (one overwrites the other), so only one survives - the one with the bigger haste
  const checkStack = (a, b) => (a === 1 && b === 2 ? { overwrites: true } : a === 2 && b === 1 ? null : null);
  const spellData = fakeSpellData({ 1: [stat('haste', 115, 9)], 2: [stat('haste', 141, 9)] });
  const plan = computePlan({ roster, classes: ['ENC'], checkStack, spellData });
  assert.deepEqual(plan.candidates.map((c) => c.name), ['Strong Haste']);
});

test('a haste buff that is not the strongest source loses its haste weight from its score', () => {
  // A bard haste song and a spell-haste buff both land (different headings), but EQ applies only
  // one haste source - the higher. The song still keeps its other stats. So the song's score must
  // not count its wasted haste (or it could push a real buff out of a slot). Owner, 3 Sep.
  const roster = [
    buff({ name: 'Spell Haste', spellId: 1, category: 'Haste', classes: 'ENC 50', level: 50 }),
    buff({ name: 'Song Haste', spellId: 2, category: 'Song', classes: 'BRD 50', level: 50 }),
  ];
  const spellData = fakeSpellData({
    1: [stat('haste', 141, 9)], // +41%
    2: [stat('haste', 130, 9), stat('STR', 50, 2)], // +30% and +50 STR
  });
  const plan = computePlan({ roster, classes: ['ENC', 'BRD'], spellData });
  const spell = plan.slots.find((c) => c.name === 'Spell Haste');
  const song = plan.songSlots.find((c) => c.name === 'Song Haste');
  assert.equal(spell.score, 141, 'the strongest haste source is untouched');
  assert.equal(song.score, 150, 'raw 180 minus the wasted (130-100) haste weight');
  assert.equal(song.redundantMultiplier[0].stat, 'haste');
  assert.equal(song.redundantMultiplier[0].coveredBy, 'Spell Haste');
});

test('a lone haste buff keeps its full haste score', () => {
  const roster = [buff({ name: 'Only Haste', spellId: 1, category: 'Haste', classes: 'ENC 50', level: 50 })];
  const spellData = fakeSpellData({ 1: [stat('haste', 141, 9)] });
  const plan = computePlan({ roster, classes: ['ENC'], spellData });
  assert.equal(plan.slots[0].score, 141);
  assert.ok(!plan.slots[0].redundantMultiplier);
});

test('totals sum each stat across every slotted buff; haste is kept-best not summed', () => {
  const roster = [
    buff({ name: 'Str A', spellId: 1, category: 'Strength', classes: 'SHM 20', level: 20 }),
    buff({ name: 'AC A', spellId: 2, category: 'Armor Class', classes: 'CLR 20', level: 20 }),
    buff({ name: 'Haste A', spellId: 3, category: 'Haste', classes: 'ENC 20', level: 20 }),
    buff({ name: 'Multi', spellId: 4, category: 'Attack', classes: 'SHM 20', level: 20 }),
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
// against the real roster + Vaela's reference loadout
// ---------------------------------------------------------------------------

test('the real roster: cleric/shaman/bard has every buff from the reference loadout as a candidate', () => {
  // buffs.json is committed and always loads - a require failure is a real broken roster and
  // should throw here, not be swallowed into a silent pass (finding #15).
  let roster = require(path.join('..', 'src', 'shared', 'data', 'buffs.json'));
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
  let roster = require(path.join('..', 'src', 'shared', 'data', 'buffs.json'));
  roster = roster.buffs || roster;
  const order = ['Strength', 'Infusion of Spirit'];
  const plan = computePlan({ roster, classes: ['CLR', 'SHM', 'BRD'], level: 50, priorityOrder: order });
  assert.equal(plan.slots.length, 14);
  assert.equal(plan.slots[0].name, 'Strength');
  assert.equal(plan.slots[1].name, 'Infusion of Spirit');
});

// ---------------------------------------------------------------------------
// The 2 Sep bundle - Fix 7 (set comparison), Fix 3 (coverage), plus the stat-toggle presets
// ---------------------------------------------------------------------------

// A combination line that blocks two individual lines, all with a score.
const COMBO_LINES = [
  { id: 'l.str', headings: ['h.str'], members: ['Str'] },
  { id: 'l.dex', headings: ['h.dex'], members: ['Dex'] },
  { id: 'l.combo', combination: true, headings: ['h.str', 'h.dex'], blocks: ['l.str', 'l.dex'], members: ['Combo'] },
];

test('Fix 7: a combination buff is dropped when the individuals it displaces outscore it', () => {
  const roster = [
    buff({ name: 'Combo', spellId: 1, category: 'C', classes: 'SHM 50', level: 50 }),
    buff({ name: 'Str', spellId: 2, category: 'S', classes: 'SHM 50', level: 50 }),
    buff({ name: 'Dex', spellId: 3, category: 'D', classes: 'SHM 50', level: 50 }),
  ];
  const spellData = fakeSpellData({ 1: [{ stat: 'STR', value: 60, order: 0 }], 2: [{ stat: 'STR', value: 40, order: 0 }], 3: [{ stat: 'DEX', value: 40, order: 1 }] });
  withLines({}, COMBO_LINES, [], (lines) => {
    const plan = computePlan({ roster, classes: ['SHM'], lines, spellData });
    // Combo 60 < Str 40 + Dex 40 = 80 -> individuals win
    assert.deepEqual(plan.slots.map((s) => s.name).sort(), ['Dex', 'Str']);
    const over = plan.overflow.find((o) => o.name === 'Combo');
    assert.match(over.reason, /together are worth more \(80 vs 60\)/);
    assert.ok(/Str/.test(over.reason) && /Dex/.test(over.reason));
  });
});

test('Fix 7: the combination buff still wins when it outscores the set', () => {
  const roster = [
    buff({ name: 'Combo', spellId: 1, category: 'C', classes: 'SHM 50', level: 50 }),
    buff({ name: 'Str', spellId: 2, category: 'S', classes: 'SHM 50', level: 50 }),
    buff({ name: 'Dex', spellId: 3, category: 'D', classes: 'SHM 50', level: 50 }),
  ];
  const spellData = fakeSpellData({ 1: [{ stat: 'STR', value: 200, order: 0 }], 2: [{ stat: 'STR', value: 40, order: 0 }], 3: [{ stat: 'DEX', value: 40, order: 1 }] });
  withLines({}, COMBO_LINES, [], (lines) => {
    const plan = computePlan({ roster, classes: ['SHM'], lines, spellData });
    assert.deepEqual(plan.slots.map((s) => s.name), ['Combo']);
  });
});

test('Fix 3: stackingCoverage counts slotted buffs that sat on a known line', () => {
  const roster = [
    buff({ name: 'Str', spellId: 1, category: 'S', classes: 'SHM 50', level: 50 }),
    buff({ name: 'Mystery Buff', spellId: 2, category: 'M', classes: 'SHM 50', level: 50 }),
  ];
  const spellData = fakeSpellData({ 1: [{ stat: 'STR', value: 40, order: 0 }], 2: [{ stat: 'AC', value: 30, order: 1 }] });
  withLines({}, COMBO_LINES, [], (lines) => {
    const plan = computePlan({ roster, classes: ['SHM'], lines, spellData });
    assert.equal(plan.slots.length, 2);
    assert.deepEqual(plan.stackingCoverage, { known: 1, total: 2 }); // Str is on l.str, Mystery Buff isn't
  });
});

test('Balanced/Melee/Caster are stat-toggle presets - a preset excludes stats, weight 0', () => {
  // The renderer applies a preset by writing its stat list into excludedStats; the planner just
  // sees the exclusions. So this is the same path as any hand-toggled exclusion.
  const roster = [
    buff({ name: 'BigStr', spellId: 1, category: 'S', classes: 'SHM 50', level: 50 }),
    buff({ name: 'BigInt', spellId: 2, category: 'I', classes: 'SHM 50', level: 50 }),
  ];
  const byId = { 1: [{ stat: 'STR', value: 50, order: 0 }], 2: [{ stat: 'INT', value: 60, order: 1 }] };
  const spellData = {
    ...fakeSpellData(byId),
    score: (id, name, ws) => byId[id].reduce((s, e) => s + Math.abs(e.value) * ((ws && ws[e.stat] != null) ? ws[e.stat] : 1), 0),
    weightScale: (excluded) => Object.fromEntries((excluded || []).map((n) => [n, 0])),
  };
  const first = (excludedStats) => computePlan({ roster, classes: ['SHM'], spellData, excludedStats }).candidates[0].name;
  assert.equal(first([]), 'BigInt', 'balanced (no exclusions): +60 INT ranks first');
  assert.equal(first(['INT']), 'BigStr', 'a Melee preset un-ticks INT -> the INT buff scores 0');
  assert.equal(first(['STR']), 'BigInt', 'a Caster preset un-ticks STR');
});

test('excludedStats: an ignored stat is scored at zero, so its buff falls to the bottom', () => {
  const roster = [
    buff({ name: 'BigStr', spellId: 1, category: 'S', classes: 'SHM 50', level: 50 }),
    buff({ name: 'BigCha', spellId: 2, category: 'C', classes: 'SHM 50', level: 50 }),
  ];
  const byId = { 1: [{ stat: 'STR', value: 40, order: 0 }], 2: [{ stat: 'CHA', value: 80, order: 1 }] };
  const spellData = {
    ...fakeSpellData(byId),
    score: (id, name, ws) => byId[id].reduce((s, e) => s + Math.abs(e.value) * ((ws && ws[e.stat] != null) ? ws[e.stat] : 1), 0),
    // main.js wires this to spellEffects.combinedWeightScale(excluded)
    weightScale: (excluded) => Object.fromEntries((excluded || []).map((n) => [n, 0])),
  };
  const base = computePlan({ roster, classes: ['SHM'], spellData }).candidates.map((c) => c.name);
  assert.deepEqual(base[0], 'BigCha', 'without exclusions the +80 CHA buff ranks first');

  const dumped = computePlan({ roster, classes: ['SHM'], spellData, excludedStats: ['CHA'] });
  assert.deepEqual(dumped.candidates.map((c) => c.name)[0], 'BigStr', 'ignoring CHA drops it below the STR buff');
  assert.deepEqual(dumped.excludedStats, ['CHA'], 'the result echoes what was ignored');
});

test('excludedStats: junk is filtered, balanced+no-exclusions still means no weightScale call', () => {
  const roster = [buff({ name: 'A', spellId: 1, category: 'S', classes: 'SHM 50', level: 50 })];
  let weightScaleCalls = 0;
  const spellData = {
    ...fakeSpellData({ 1: [{ stat: 'STR', value: 10, order: 0 }] }),
    score: () => 10,
    weightScale: () => { weightScaleCalls++; return {}; },
  };
  computePlan({ roster, classes: ['SHM'], spellData, excludedStats: [null, 5, {}] });
  assert.equal(weightScaleCalls, 0, 'no real exclusions + balanced => scoring path untouched');
});

module.exports = () => report('buff-planner');
if (require.main === module) report('buff-planner').then((n) => process.exit(n ? 1 : 0));
