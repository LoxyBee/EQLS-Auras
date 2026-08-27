'use strict';

// The actual character-stat numbers a buff grants - for the buff optimiser (buffPlanner.js).
// Shara, 27 Aug: "rank them by best, that means numerical" / "actual character stats only".
//
// The game's spells_us.txt stores each spell's effects as numbered slots; spellStacking.js already
// parses them (denseEffects / effectValue). This module reads those slots and keeps ONLY the ones
// that are a real character stat - STR, AC, haste, a resist, and so on - each under its plain
// name. Every other kind of effect (a heal component, a proc, vision, an illusion, a spell-focus
// limit) is discarded here and never reaches the planner. There is one lookup table below that
// pairs the game's internal effect number with a stat name; that number is an implementation
// detail of reading the file and appears nowhere else - not in the returned data, not in the
// planner, not on screen.

const { denseEffects, effectValue } = require('./spellStacking');

// The character stats the planner counts, in the order a stat sheet lists them, paired with the
// effect number the game's spell file uses for each. The attribute block and AC are confirmed
// against the owner's real file (see spell-stacking.test.js's fixtures); the rest use the standard
// client effect numbers. A stat not in here does not exist as far as the planner is concerned.
const STATS = [
  { name: 'AC', effect: 1 },
  { name: 'ATK', effect: 2 },
  { name: 'STR', effect: 4 },
  { name: 'STA', effect: 7 },
  { name: 'AGI', effect: 6 },
  { name: 'DEX', effect: 5 },
  { name: 'WIS', effect: 9 },
  { name: 'INT', effect: 10 },
  { name: 'CHA', effect: 8 },
  { name: 'haste', effect: 11 }, // stored 100-based: 141 = +41%
  { name: 'cast speed', effect: 127 }, // reduces cast time. Shara, 27 Aug: same priority as haste.
  { name: 'HP regen', effect: 0 }, // per-tick on a duration buff (heals/HoTs are filtered out before this)
  { name: 'mana regen', effect: 15 }, // per-tick mana on a duration buff (Clarity etc.), not a max-mana raise
  { name: 'endurance regen', effect: 189 },
  { name: 'fire resist', effect: 46 },
  { name: 'cold resist', effect: 47 },
  { name: 'poison resist', effect: 48 },
  { name: 'disease resist', effect: 49 },
  { name: 'magic resist', effect: 50 },
  { name: 'all resists', effect: 111 },
  { name: 'damage shield', effect: 59 },
  { name: 'rune', effect: 55 },
  { name: 'spell rune', effect: 78 },
  { name: 'max HP', effect: 69 },
  { name: 'max mana', effect: 97 },
];
const STAT_BY_EFFECT = new Map(STATS.map((s, i) => [s.effect, { name: s.name, order: i }]));
const MULTIPLIER_STATS = new Set(['haste', 'cast speed']); // 100-based, a bonus not a point total

// How much a point of each stat is worth when ranking buffs of DIFFERENT stats for the default
// slot order (the user drags to override). Attributes / AC / ATK count 1:1. Resists are weighted
// down - "situational and lower priority" (Shara, 27 Aug) - so a resist buff doesn't outrank a
// real stat buff for a slot. HP/mana totals are scaled so a 500 HP buff doesn't dwarf a 50 STR
// one. Rough on purpose.
const RESIST_STATS = new Set(['fire resist', 'cold resist', 'poison resist', 'disease resist', 'magic resist', 'all resists']);
const STAT_WEIGHT = {
  'max HP': 0.02, 'max mana': 0.02, rune: 0.05, 'spell rune': 0.05, 'damage shield': 0.5,
  // Regen is a top priority (Shara, 27 Aug: "mana and endurance regen should be a high priority").
  // A per-tick value is small (~10-15), so it needs a big multiplier to rank alongside a +40 stat.
  'HP regen': 4, 'mana regen': 4, 'endurance regen': 4,
  // Resists are "situational and lower priority" - dropped well below a real stat so 4-5 single-
  // element resist buffs don't fill the tail of the 14 ahead of anything useful.
  'fire resist': 0.1, 'cold resist': 0.1, 'poison resist': 0.1, 'disease resist': 0.1,
  'magic resist': 0.1, 'all resists': 0.15,
};

const EFFECT_SLOTS = 12;
const ASSUMED_LEVEL = 50;

let cache = null; // { installRoot, categoryStat: Map<category, statName> }

// Every real character stat a buff grants: [{ stat, value, order }], strongest first.
function spellStats(installRoot, spellId, level = ASSUMED_LEVEL) {
  if (!installRoot || spellId == null) return [];
  const slots = denseEffects(installRoot, spellId);
  const out = [];
  for (let i = 1; i <= EFFECT_SLOTS; i++) {
    const slot = slots[i];
    const known = slot && STAT_BY_EFFECT.get(slot[1]);
    if (!known) continue;
    const value = effectValue(slot[2], slot[5], slot[4], level);
    if (!value) continue;
    out.push({ stat: known.name, value, order: known.order });
  }
  return out.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

// Which stat is a category's headline, learned from the roster: the stat that appears in the most
// of that category's spells. "Strength" -> STR because every strength spell grants STR.
function categoryStatMap(installRoot, roster) {
  if (cache && cache.installRoot === installRoot) return cache.categoryStat;
  const tally = new Map(); // category -> Map<statName, count>
  for (const entry of roster || []) {
    if (entry.kind !== 'buff' || entry.spellId == null || !entry.category) continue;
    const seen = new Set();
    for (const s of spellStats(installRoot, entry.spellId)) {
      if (seen.has(s.stat)) continue;
      seen.add(s.stat);
      if (!tally.has(entry.category)) tally.set(entry.category, new Map());
      const m = tally.get(entry.category);
      m.set(s.stat, (m.get(s.stat) || 0) + 1);
    }
  }
  const categoryStat = new Map();
  for (const [category, m] of tally) {
    let best = null;
    let bestCount = 0;
    for (const [stat, count] of m) {
      if (count > bestCount) {
        bestCount = count;
        best = stat;
      }
    }
    if (best) categoryStat.set(category, best);
  }
  cache = { installRoot, categoryStat };
  return categoryStat;
}

// The category's headline stat on a spell: { stat, value }, or null. Matched by the stat's NAME
// (not by value), so a "Charisma"-category buff that also happens to give +40 INT still leads with
// its CHA figure.
function categoryHeadline(installRoot, roster, spellId, category) {
  const want = categoryStatMap(installRoot, roster).get(category);
  if (!want) return null;
  const matching = spellStats(installRoot, spellId).filter((s) => s.stat === want);
  if (!matching.length) return null;
  const best = matching.reduce((m, s) => (Math.abs(s.value) > Math.abs(m.value) ? s : m));
  return { stat: best.stat, value: best.value };
}

// One number for ranking a buff against buffs of OTHER stats (fill order when slots run out).
function statScore(installRoot, spellId) {
  let score = 0;
  for (const s of spellStats(installRoot, spellId)) {
    if (s.stat === 'haste') score += Math.max(0, Math.abs(s.value) - 100); // 141 -> +41
    else if (s.stat === 'cast speed') score += Math.abs(s.value) * 1.5; // raw %, top-priority like haste
    else score += Math.abs(s.value) * (STAT_WEIGHT[s.stat] ?? 1);
  }
  return Math.round(score);
}

function resetCache() {
  cache = null;
}

module.exports = { spellStats, categoryStatMap, categoryHeadline, statScore, MULTIPLIER_STATS, RESIST_STATS, resetCache };
