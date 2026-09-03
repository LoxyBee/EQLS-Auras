'use strict';

// The actual character-stat numbers a buff grants - for the buff optimiser (buffPlanner.js).
// the owner, 27 Aug: "rank them by best, that means numerical" / "actual character stats only".
//
// Each spell's effect slots now travel on the roster itself (`stackEffects` on every buffs.json
// entry, written by build-roster.js). This module reads those slots and keeps ONLY the ones that
// are a real character stat - STR, AC, haste, a resist - each under its plain name; every other
// kind (a heal component, a proc, vision, an illusion, a spell-focus limit) is discarded here and
// never reaches the planner. The value is computed by the ported engine's own calcSpellValue (the
// full EQEmu formula table), replacing the hand-cut effectValue that used to live in
// spellStacking.js and returned the raw base for any formula it didn't implement.

const { spellView, calcSpellValue } = require('../shared/spellStackingEngine');

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
  // Verified against the owner's real spells_us.txt (AEM, 2 Sep): 8 = INT, 9 = WIS, 10 = CHA.
  // Charisma / Glamour (category Charisma) carry effect 10 at 100%, effect 8 at 0%; the two were
  // swapped here, so every Charisma buff rendered "+40 INT".
  { name: 'INT', effect: 8 },
  { name: 'CHA', effect: 10 },
  { name: 'haste', effect: 11 }, // stored 100-based: 141 = +41%
  { name: 'cast speed', effect: 127 }, // reduces cast time. the owner, 27 Aug: same priority as haste.
  { name: 'HP regen', effect: 0 }, // per-tick on a duration buff (heals/HoTs are filtered out before this)
  { name: 'mana regen', effect: 15 }, // per-tick mana on a duration buff (Clarity etc.), not a max-mana raise
  { name: 'endurance regen', effect: 189 },
  // effect 121 (reverse damage shield). On EQL's "Blessing of the X" cleric line it is a passive
  // heal-on-melee - owner, 3 Sep: "it heals you passively, it's basically like hp regen for melee
  // characters", "the entire blessing of the lord commander line needs to be in the 14". Weighted
  // like regen (x4) so the line reliably takes a slot; caster preset un-ticks it.
  { name: 'HP on hit', effect: 121 },
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
// down - "situational and lower priority" (the owner, 27 Aug) - so a resist buff doesn't outrank a
// real stat buff for a slot. HP/mana totals are scaled so a 500 HP buff doesn't dwarf a 50 STR
// one. Rough on purpose.
const RESIST_STATS = new Set(['fire resist', 'cold resist', 'poison resist', 'disease resist', 'magic resist', 'all resists']);
const STAT_WEIGHT = {
  // 0.02 -> 0.25 (AEM/owner, 2 Sep). At 0.02 the largest max-HP buff in the game (Symbol of
  // Naltron, +406) scored 8 - below a single point of any attribute. 0.25 puts 100 HP at 25 pts,
  // just under exact parity with a median attribute buff (0.30 = parity). max mana affects exactly
  // one spell (Gift of Magic) - matched for principle, not impact.
  'max HP': 0.25, 'max mana': 0.25, rune: 0.05, 'spell rune': 0.05, 'damage shield': 0.5,
  // Regen is a top priority (the owner, 27 Aug: "mana and endurance regen should be a high priority").
  // A per-tick value is small (~10-15), so it needs a big multiplier to rank alongside a +40 stat.
  // "HP on hit" (effect 121, the Blessing line) is the same idea for melee - owner wants the whole
  // line slotted, so it rides the same x4.
  'HP regen': 4, 'mana regen': 4, 'endurance regen': 4, 'HP on hit': 4,
  // Resists are "situational and lower priority" - dropped well below a real stat so 4-5 single-
  // element resist buffs don't fill the tail of the 14 ahead of anything useful. MAGIC RESIST is
  // the exception (owner, 3 Sep: "magic resist in general is worth a lot more than any other type
  // ... needs a higher priority than any other resistance buff") - it ranks above `all resists`,
  // which in turn beats the single-element ones.
  'fire resist': 0.1, 'cold resist': 0.1, 'poison resist': 0.1, 'disease resist': 0.1,
  'magic resist': 0.4, 'all resists': 0.2,
};

// A curated snapshot (like buffStore's CHARM_SPELL_NAMES) of combat-proc buffs the owner wants
// treated as clearly slot-worthy. Effect 85's value is a SPELL ID, not a magnitude (Spirit of the
// Puma's is 6908), so the proc can't be scored from the file - modelling proc rate + proc damage
// is out of scope. A flat +50 in statScore() puts each of these level with Dexterity/Celerity:
// worth a slot, not dominating. The owner drags to reorder within that. Excludes Spirit of
// Inferno/Lightning/Blizzard/Scorpion/Vermin - same effect, but [Pet Misc Buffs] (the proc lands
// on the pet). (AEM/owner, 2 Sep.)
const PROC_SCORE_BOOST = new Set([
  'Spirit of the Puma', 'Boon of the Garou', 'Call of Sky', 'Divine Might',
  "Katta's Song of Sword Dancing", 'Scream of Death', 'Vampiric Embrace',
  'Instrument of Nife', 'Ward of the Divine',
]);
const PROC_BOOST_POINTS = 50;

// Every stat name the planner knows, in stat-sheet order.
const STAT_NAMES = STATS.map((s) => s.name);

// The stats the user gets a toggle chip for. Resists and the rune stats are deliberately NOT here
// (owner, 3 Sep: "res buffs don't need a toggle as they are low priority anyway ... rune doesn't
// need a toggle either") - they still score, at their low STAT_WEIGHT, they just can't be turned
// off by hand. Order follows the stat sheet.
const NON_EXCLUDABLE = new Set([...RESIST_STATS, 'rune', 'spell rune']);
const EXCLUDABLE_STATS = STAT_NAMES.filter((n) => !NON_EXCLUDABLE.has(n));
const EXCLUDABLE_SET = new Set(EXCLUDABLE_STATS);

// The Balanced / Melee / Caster buttons are stat-toggle PRESETS now, not a weighting (owner,
// 3 Sep: "remove the balanced melee/caster 0.5 weighting and instead have it just deselect them
// from the toggles when stats are useless ... more visual for the user"). Picking Melee un-ticks
// the caster-only stats; Caster un-ticks the melee-only ones; Balanced ticks everything. The end
// result is weight 0 for a deselected stat - same as the old x0.35 taken to its limit - but the
// user sees exactly which stats got dropped and can re-tick any of them.
const PRESET_EXCLUDES = {
  balanced: [],
  melee: ['WIS', 'INT', 'mana regen', 'cast speed', 'max mana'],
  caster: ['STR', 'DEX', 'AGI', 'ATK', 'haste', 'HP on hit'],
};

// The weight multiplier statScore() uses: a hard 0 for every excludable stat the user has turned
// off ("dump Charisma" -> a Charisma buff scores nothing and drops out of the fill order).
// Unknown / non-excludable names are ignored. Returns {} when nothing is excluded.
function combinedWeightScale(excluded) {
  const scale = {};
  for (const name of Array.isArray(excluded) ? excluded : []) {
    if (EXCLUDABLE_SET.has(name)) scale[name] = 0;
  }
  return scale;
}

const ASSUMED_LEVEL = 50;

let cache = null; // Map<category, statName>, rebuilt from the roster; cleared by resetCache()

// Every real character stat a buff grants: [{ stat, value, order }], strongest first.
// `entry` is a roster entry (buffs.json) - it carries `stackEffects`. Anything without effect data
// (a custom entry, a spell not in the client) yields [].
function spellStats(entry, level = ASSUMED_LEVEL) {
  if (!entry || (entry.stackEffects == null && entry.effects == null)) return [];
  const out = [];
  for (const [spa, base, limit, formula, max] of spellView(entry).effects) {
    const known = STAT_BY_EFFECT.get(spa);
    if (!known) continue;
    const value = calcSpellValue(base, formula, max, level);
    if (!value) continue;
    // Effect 0 is the generic hit-points effect, not "HP regen" - it's negative on 260 roster
    // entries (damage / life-drain conversions like Lich). statScore does abs()*4x, which ranked
    // Lich as the strongest regen buff in the game. A negative HP-regen entry is a drain; drop it
    // here so it never reaches the score, the headline stat, or the totals card. (AEM/owner, 2 Sep.)
    if (known.name === 'HP regen' && value < 0) continue;
    out.push({ stat: known.name, value, order: known.order });
  }
  return out.sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
}

// Which stat is a category's headline, learned from the roster: the stat that appears in the most
// of that category's spells. "Strength" -> STR because every strength spell grants STR.
function categoryStatMap(roster) {
  if (cache) return cache;
  const tally = new Map(); // category -> Map<statName, count>
  for (const entry of roster || []) {
    if (entry.kind !== 'buff' || !entry.category) continue;
    const seen = new Set();
    for (const s of spellStats(entry)) {
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
  cache = categoryStat;
  return categoryStat;
}

// The category's headline stat on a spell: { stat, value }, or null. Matched by the stat's NAME
// (not by value), so a "Charisma"-category buff that also happens to give +40 INT still leads with
// its CHA figure.
function categoryHeadline(roster, entry, category) {
  const want = categoryStatMap(roster).get(category);
  if (!want) return null;
  const matching = spellStats(entry).filter((s) => s.stat === want);
  if (!matching.length) return null;
  const best = matching.reduce((m, s) => (Math.abs(s.value) > Math.abs(m.value) ? s : m));
  return { stat: best.stat, value: best.value };
}

// One number for ranking a buff against buffs of OTHER stats (fill order when slots run out).
// `name` is optional - only the curated proc list needs it. `weightScale` is the exclusion map
// from combinedWeightScale: `{ 'CHA': 0, ... }` for every stat the user turned off, defaulting to
// 1 for anything not named. Proc boost is flat and not affected by exclusions.
function statScore(entry, name = null, weightScale = null) {
  const scale = (stat) => (weightScale && weightScale[stat] != null ? weightScale[stat] : 1);
  let score = 0;
  for (const s of spellStats(entry)) {
    if (s.stat === 'haste') score += Math.max(0, Math.abs(s.value) - 100) * scale('haste'); // 141 -> +41
    // Raw %, not 100-based like haste - a +10% cast-speed buff is `10`, not `110`. x5.0 (was x1.5)
    // puts Blessing of Faith level with Celerity, which is the owner's "same priority as haste".
    else if (s.stat === 'cast speed') score += Math.abs(s.value) * 5.0 * scale('cast speed');
    else score += Math.abs(s.value) * (STAT_WEIGHT[s.stat] ?? 1) * scale(s.stat);
  }
  if (name && PROC_SCORE_BOOST.has(name)) score += PROC_BOOST_POINTS;
  return Math.round(score);
}

function resetCache() {
  cache = null;
}

module.exports = {
  spellStats, categoryStatMap, categoryHeadline, statScore, MULTIPLIER_STATS, RESIST_STATS,
  resetCache, PROC_SCORE_BOOST, STAT_WEIGHT,
  STAT_NAMES, EXCLUDABLE_STATS, PRESET_EXCLUDES, combinedWeightScale,
};
