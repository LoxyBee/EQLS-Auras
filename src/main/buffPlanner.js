'use strict';

// The buff optimiser (the owner's ask, 26-27 Aug): "input 3 classes, spit out your highest buffs and
// the best setup across the buff slots" - ranked by the actual character-stat numbers, "level and
// duration have absolutely 0 to do with anything".
//
// Pure and dependency-free on purpose - it takes the roster, the three classes + one character
// level, an optional priority order, a stacking-check function, and a `spellData` reader (the real
// stat numbers), and returns a plan. `main.js` wires the real roster (buffStore), the real
// stacking engine (stackingService), and spellEffects.js into it; tests wire fakes. Nothing here
// reads a file or knows an install path.
//
// HOW IT DECIDES:
//   - Candidates: every kind:'buff' roster entry one of the three classes can cast at the
//     character level, that can land on the player (Self/Group/Friendly/Single - not
//     Pet/Animal/Undead), that grants a real character stat. Heals, illusions, run speed, vision,
//     spell-focus and other pure utility are dropped - NON_STAT_CATEGORIES plus, when the spell
//     file is available, a fine check that the buff carries at least one recognised stat.
//   - "One per slot line" is the roster's own `category` column. The planner keeps the ONE buff
//     per category with the biggest headline-stat number - not the highest level, not the longest
//     duration. Where the stacking engine has a real verdict for a pair it overrides that grouping
//     (a cross-category conflict it names is collapsed); it never invents one.
//   - Three pools: the 14 spell-buff slots, a 5-slot bard-song pool (only when Bard is picked),
//     and an uncapped permanent-buff pool (Yaulp/Fury). Songs and buffs are reconciled together;
//     permanents keep their own listing even when a temp buff shares their stat.
//   - Slots fill by the user's dragged priority order first, then by total stat contribution, so
//     when there are more buffs than slots it's the least valuable that drop. Overflow always says
//     why (no free slot / blocked by X).
//   - `totals` is the summed stat sheet across every slotted buff.

const SLOT_COUNT = 14;
// Bard songs occupy a separate buff pool from spell buffs in EQ (the stacking engine models it),
// so they get their own slots on top of the 14. Only computed when Bard is one of the chosen classes.
const SONG_SLOT_COUNT = 5;

// EQ Legends caps at level 50 (the owner, 26 Aug). One character level applies to all three classes -
// it's one character with a multiclass loadout, not three separate mains.
const DEFAULT_LEVEL = 50;
const MAX_CHARACTER_LEVEL = 50;
const MIN_LEVEL = 1;
const MAX_LEVEL = 130; // generous internal ceiling; the roster's own required levels are the real gate

const VALID_CLASSES = ['BRD', 'BST', 'CLR', 'DRU', 'ENC', 'MAG', 'NEC', 'PAL', 'RNG', 'SHD', 'SHM', 'WIZ'];

// Targets a buff has to have for it to be something you can keep running ON YOURSELF. Pet/Animal/
// Undead/Targeted AE are real roster targets but never a personal buff slot.
const PLAYER_TARGETS = new Set(['Self', 'Group', 'Friendly', 'Group Member', 'Single']);

// Roster categories that are never a stat/combat buff - heals of every shape, illusions, run
// speed, vision, and other pure utility. Dropped from the planner outright (the owner, 27 Aug: "not
// stat related. no combat power. heals included."). This is the coarse filter that works even
// without the spell file; the fine one (a buff whose effects carry no recognised stat at all) runs
// on top when the EQ folder is set.
const NON_STAT_CATEGORIES = new Set([
  'Duration Heals', 'Heals', 'Echoes', 'Delayed', 'Life Flow', // heals
  'Levitate', 'Movement', 'Vision', 'Invisibility',
  'Illusion: Adventurer', 'Illusion: Other', 'Visages',
  'Calm', 'Memory Blur', 'Fizzle Rate', 'Reflection', 'Alliance',
  'Utility Beneficial', 'Sum: Familiar', 'Pet Haste', 'Pet Misc Buffs',
  'Invulnerability', 'Conversions',
  // NOT excluded, contrary to an earlier guess: 'Spell Focus' (Blessing of Faith is a real slot),
  // 'Blessings', 'Symbol', 'Melee Guard', 'Spell Guard', 'Block', 'Combat Innates' - the owner's
  // 27 Aug reference loadout runs buffs from most of those.
]);


function clampLevel(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return DEFAULT_LEVEL;
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, v));
}

// A clean, de-duped, max-three list of class codes. An unknown code is dropped rather than guessed.
function normalizeClassCodes(input) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(input) ? input : []) {
    const code = String(typeof raw === 'string' ? raw : (raw && raw.code) || '').toUpperCase().trim();
    if (!VALID_CLASSES.includes(code) || seen.has(code)) continue;
    seen.add(code);
    out.push(code);
    if (out.length === 3) break;
  }
  return out;
}

// The three classes paired with the one shared character level - the shape computePlan reads.
function normalizeClasses(input, level) {
  const lvl = clampLevel(level == null ? DEFAULT_LEVEL : level);
  return normalizeClassCodes(input).map((code) => ({ code, level: lvl }));
}

// "ENC 21 · SHM 42" -> [{ code:'ENC', level:21 }, { code:'SHM', level:42 }]
function parseSpellClasses(str) {
  const out = [];
  for (const token of String(str || '').split('·')) {
    const m = token.trim().match(/^([A-Za-z]{2,3})\s+(\d+)$/);
    if (m) out.push({ code: m[1].toUpperCase(), level: Number(m[2]) });
  }
  return out;
}

// A bard song, for the separate 5-slot "symphonic" pool. `isBardSong` is set live by
// bardSongTagger.js and is the primary signal; the fallback (only Bard can cast it) matches that
// tagger's own rule and covers a roster that hasn't been tagged yet (e.g. in tests).
function isBardSongEntry(entry) {
  if (entry.isBardSong === true) return true;
  const casters = parseSpellClasses(entry.classes);
  return casters.length > 0 && casters.every((c) => c.code === 'BRD');
}


// Attaches the numbers the planner ranks on: `stat` + `magnitude` (this category's headline stat,
// matched by name so a "Charisma" buff that also gives +40 INT still leads with CHA), `stats`
// ([{stat,value,order}] - every character stat the buff grants), `score` (one number for the
// default slot order). `spellData` is injected by main.js from spellEffects.js; without it (no EQ
// folder) everything is null/0 and ordering falls to name.
function enrichCandidate(cand, spellData, weightScale) {
  if (!spellData) return { ...cand, magnitude: null, stat: null, stats: [], score: 0 };
  const stats = spellData.stats(cand.spellId) || [];
  const headline = spellData.headline(cand.spellId, cand.category);
  return {
    ...cand,
    magnitude: headline ? headline.value : null,
    stat: headline ? headline.stat : null,
    stats,
    // weightScale zeroes a stat the user turned off; otherwise a plain sum of the character stats.
    score: spellData.score(cand.spellId, weightScale) || 0,
  };
}

// Every castable candidate, one object per roster entry, NOT yet collapsed by category. classes
// is normalized [{code, level}].
function candidatesFor(roster, classes, spellData, weightScale) {
  const wantLevel = new Map(classes.map((c) => [c.code, c.level]));
  const out = [];

  for (const entry of roster) {
    if (entry.kind !== 'buff') continue;
    if (!PLAYER_TARGETS.has(entry.targets)) continue;
    // Not a stat / combat buff - heals, illusions, run speed, vision, utility. Dropped outright.
    if (entry.scaleCategory === 'hot' || entry.scaleCategory === 'heal') continue;
    if (NON_STAT_CATEGORIES.has(entry.category)) continue;

    const casters = parseSpellClasses(entry.classes).filter(
      (sc) => wantLevel.has(sc.code) && sc.level <= wantLevel.get(sc.code)
    );
    if (casters.length === 0) continue;

    const cand = enrichCandidate(
      {
        name: entry.name,
        spellId: entry.spellId,
        iconId: entry.iconId != null ? entry.iconId : null,
        category: entry.category || 'Other',
          reqLevel: Math.min(...casters.map((c) => c.level)),
          durationSec: typeof entry.durationSec === 'number' ? entry.durationSec : null,
          infiniteDuration: !!entry.infiniteDuration,
          targets: entry.targets,
          castByClasses: casters.map((c) => c.code),
          isSong: isBardSongEntry(entry),
        },
        spellData,
        weightScale
      );

    out.push(cand);
  }

  return out;
}

// "Yaulp III" / "Spirit of Puma Rk. II" -> "Yaulp" / "Spirit of Puma". Only a trailing rank
// marker; the roster already collapses "Rk." suffixes, so this mostly catches bare numerals.
function baseName(name) {
  return String(name).replace(/\s+(?:Rk\.?\s*)?(?:[IVXLCDM]+|\d+)$/i, '').trim();
}

// The fallback when the spell file isn't available. The roster's `category` column is a stat
// label, NOT a stacking line - the owner's 27 Aug reference loadout runs Strength AND Infusion of
// Spirit AND Talisman of Altuna, all "stat" categories that overlap - so this does NOT group by
// category. It only merges spells that share a base name (a rank line), keeping the higher one.
// Everything else is shown; the player sorts it out. The real answer needs the spell file.
function collapseByCategory(cands) {
  const byBase = new Map();
  for (const cand of cands) {
    const key = baseName(cand.name).toLowerCase();
    const existing = byBase.get(key);
    byBase.set(key, existing && existing.reqLevel >= cand.reqLevel ? existing : cand);
  }
  return { kept: [...byBase.values()], dropped: [], approximate: true };
}

// Does `a` grant a stat `b` doesn't? Used by the no-line fallback only.
function hasUniqueStat(a, b) {
  const bStats = new Set((b.stats || []).map((s) => s.stat));
  return (a.stats || []).some((s) => s.value && !bStats.has(s.stat));
}

// FALLBACK collapse for when the line data isn't wired in (`lines` is null). Uses the stacking
// engine's verdict (checkStack) for a same-category tier collapse; without even that, only merges
// shared base names. Imperfect - the real answer is resolveByHeadings below.
function collapseByStacking(cands, checkStack) {
  if (!checkStack) return collapseByCategory(cands);
  const droppedBy = new Map();
  for (let i = 0; i < cands.length; i++) {
    if (droppedBy.has(cands[i].name)) continue;
    for (let j = i + 1; j < cands.length; j++) {
      if (droppedBy.has(cands[j].name)) continue;
      const a = cands[i];
      const b = cands[j];
      if (a.spellId == null || b.spellId == null) continue;
      if (a.category !== b.category) continue;
      const bWins = (checkStack(a.spellId, b.spellId) || {}).overwrites;
      const aWins = (checkStack(b.spellId, a.spellId) || {}).overwrites;
      if (bWins && !aWins && !hasUniqueStat(a, b)) droppedBy.set(a.name, b.name);
      else if (aWins && !bWins && !hasUniqueStat(b, a)) droppedBy.set(b.name, a.name);
    }
  }
  return {
    kept: cands.filter((c) => !droppedBy.has(c.name)),
    dropped: cands
      .filter((c) => droppedBy.has(c.name))
      .map((c) => ({ ...c, reason: `${droppedBy.get(c.name)} is the stronger version` })),
    approximate: true,
  };
}

// THE REAL RESOLUTION - the heading model (see docs/BUFF-STACKING.md).
//   1. Each buff line collapses to its highest castable tier.
//   2. Candidates are ordered (user drag first, then stat score).
//   3. Walking that order, each buff claims the effect "headings" its line occupies. A buff whose
//      heading is already taken, or that a placed combination buff blocks, or that a placed buff is
//      recorded as blocking (measured pairs), goes to overflow with the reason.
//   4. A buff with no line data falls back to the stacking engine (checkStack) against the placed set.
// Nothing is dropped just for sharing a stat: Strength + Infusion of Spirit + Fury all stack
// because they sit on different headings.
function resolveByHeadings(cands, priorityOrder, lines, checkStack) {
  if (!lines) return collapseByStacking(cands, checkStack);

  const dropped = [];

  // 1. collapse each line to its best tier
  const byLine = new Map();
  const noLine = [];
  for (const c of cands) {
    const line = lines.lineForName(c.name);
    if (!line) {
      noLine.push(c);
      continue;
    }
    const existing = byLine.get(line.id);
    if (!existing) {
      byLine.set(line.id, c);
      continue;
    }
    const cIsBetter = lines.tierOf(line, c.name) > lines.tierOf(line, existing.name);
    const better = cIsBetter ? c : existing;
    const worse = cIsBetter ? existing : c;
    dropped.push({ ...worse, reason: `${better.name} is the higher tier`, beatenBy: [better.name] });
    byLine.set(line.id, better);
  }

  // 2. order
  const ordered = orderCandidates([...byLine.values(), ...noLine], priorityOrder);

  // 3. walk, claim headings
  const occupied = new Map(); // heading id -> the buff holding it
  const kept = [];
  for (const c of ordered) {
    const headings = lines.headingsForName(c.name);

    // Fix 7 (owner, 2 Sep): "the buff line research should naturally exclude it, and then the
    // weights should realise that the two stacked is better stats." A combination buff (Aegolism,
    // Harnessing of Spirit) claims its headings only if it scores at least as much as the sum of
    // the candidates it genuinely SUBSUMES. Subsumes = it's on the combo's authored `blocks` list.
    // NOT a stackDecision('overwrites') sweep - that also catches buffs which REPLACE the combo
    // (Armor of the Faithful, Talisman of Altuna both overwrite Harnessing of Spirit), which the
    // combo does not displace at all. Owner, 3 Sep: "it's actually REPLACED by armour of the
    // faithful ... this is exactly the kind of nuance the new model was supposed to fix".
    const cLine = lines.lineForName(c.name);
    if (cLine && cLine.combination) {
      const blockIds = new Set(cLine.blocks || []);
      const displaced = ordered.filter((o) => {
        if (o === c) return false;
        const oL = lines.lineForName(o.name);
        return oL && blockIds.has(oL.id);
      });
      const displacedScore = displaced.reduce((s, o) => s + (o.score || 0), 0);
      if (displaced.length && (c.score || 0) < displacedScore) {
        dropped.push({
          ...c,
          reason: `${displaced.map((d) => d.name).join(' + ')} together are worth more (${displacedScore} vs ${c.score || 0})`,
          beatenBy: displaced.map((d) => d.name),
          // The combination-buff breakdown, for the "why this one?" tooltip: what this combo would
          // have blocked, and the score comparison that kept the individuals.
          combo: {
            blocks: displaced.map((d) => ({ name: d.name, stats: d.stats || [], score: d.score || 0 })),
            comboScore: c.score || 0,
            sumScore: displacedScore,
          },
        });
        continue;
      }
    }

    let clash = null;
    let clashKind = 'conflicts with';
    let clashWhy = null; // buffLines.stackReason tag: 'blocked-pair' | 'same-line' | 'shared-slot' | 'cross-class' | ...
    for (const placed of kept) {
      const dec = lines.stackDecision(c.name, placed.name);
      if (dec === 'blocked' || dec === 'overwrites') {
        clash = placed.name;
        clashWhy = lines.stackReason ? lines.stackReason(c.name, placed.name) : null;
        break;
      }
      if (dec === 'unknown' && checkStack && c.spellId != null && placed.spellId != null) {
        // checkStack (stackingService.planConflict) checks both directions itself and returns
        // { overwrites, blocked, conflict } | null. `conflict` = they collide either way.
        const v = checkStack(placed.spellId, c.spellId);
        if (v && v.conflict) {
          clash = placed.name;
          clashKind = v.blocked ? "wouldn't take hold past" : 'shares an effect slot with';
          clashWhy = 'effect-slot';
          break;
        }
      }
    }
    if (!clash) {
      const held = headings.map((h) => occupied.get(h)).find(Boolean);
      if (held) {
        clash = held.name;
        clashKind = 'wants the same slot as';
        clashWhy = 'shared-slot';
      }
    }

    if (clash) {
      dropped.push({ ...c, reason: `${clashKind} ${clash}`, beatenBy: [clash], stackWhy: clashWhy });
      continue;
    }
    // Fix 3: tag whether the LINE model placed this (vs a buff with no line data that only got in
    // because nothing conflicted). Lets computePlan report real "N of M tiers known" coverage
    // instead of the always-true flag.
    kept.push({ ...c, lineKnown: !!lines.lineForName(c.name) });
    for (const h of headings) occupied.set(h, c);
  }

  return { kept, dropped, approximate: false };
}

// A haste / cast-speed buff only helps if it is the STRONGEST source of that multiplier. EQ applies
// one haste source at a time - the owner, 3 Sep: "alacrities 40% haste beats verses of victories
// 30% haste, so only 1 applies, even though only 1 is active ... verses still stacks with
// strength/everything else". A bard haste song and a spell-haste buff sit on different headings, so
// both land in the plan, but only the higher one's haste counts. Without this the weaker one's
// wasted haste inflates its `score`, and score decides slot competition (orderCandidates) and
// combination displacement (Fix 7) - so a genuinely useful buff could be pushed out by a song
// whose haste does nothing. Mutates `score` on the losers and tags `redundantMultiplier` for the
// "why" tooltip. Movement speed is not a scored stat, so Selo's vs SoW needs nothing here.
function discountRedundantMultipliers(cands, multiplierStats, weightScale) {
  if (!multiplierStats || !multiplierStats.size) return cands;
  const scale = (stat) => (weightScale && weightScale[stat] != null ? weightScale[stat] : 1);
  // Mirror spellEffects.statScore's per-stat weighting so the subtraction lines up.
  const contribution = (stat, value) => {
    if (stat === 'haste') return Math.max(0, Math.abs(value) - 100) * scale('haste');
    if (stat === 'cast speed') return Math.abs(value) * 5.0 * scale('cast speed');
    return 0;
  };
  for (const stat of multiplierStats) {
    const providers = cands
      .map((c) => ({ c, s: (c.stats || []).find((x) => x.stat === stat) }))
      .filter((p) => p.s && p.s.value);
    if (providers.length < 2) continue;
    const best = providers.reduce((a, b) => (Math.abs(b.s.value) > Math.abs(a.s.value) ? b : a));
    for (const p of providers) {
      if (p === best) continue;
      p.c.score = Math.max(0, Math.round((p.c.score || 0) - contribution(stat, p.s.value)));
      p.c.redundantMultiplier = [...(p.c.redundantMultiplier || []), { stat, coveredBy: best.c.name }];
    }
  }
  return cands;
}

// The order the candidate list is shown in AND the order the slots are filled in. The user's own
// dragged `priorityOrder` (a list of names) wins; anything not in it follows by stat score
// (biggest total contribution first - so when slots run out it's the least valuable buffs that
// drop), then name. No category priority list, no level, no duration.
function orderCandidates(cands, priorityOrder) {
  const rank = new Map((priorityOrder || []).map((name, i) => [name.toLowerCase(), i]));
  return cands.slice().sort((a, b) => {
    const ra = rank.has(a.name.toLowerCase()) ? rank.get(a.name.toLowerCase()) : Infinity;
    const rb = rank.has(b.name.toLowerCase()) ? rank.get(b.name.toLowerCase()) : Infinity;
    if (ra !== rb) return ra - rb;
    if ((b.score || 0) !== (a.score || 0)) return (b.score || 0) - (a.score || 0);
    return a.name.localeCompare(b.name);
  });
}

// The stat sheet: every slotted buff's stats summed. "A sum total of stats across everything"
// (the owner, 27 Aug). Ordered the way a character sheet lists stats (AC, ATK, the attribute block,
// haste, resists, ...), not by magnitude.
function sumStats(slotLists, multiplierStats) {
  const totals = new Map(); // stat -> { stat, order, value }
  for (const list of slotLists) {
    for (const cand of list) {
      for (const s of cand.stats || []) {
        const t = totals.get(s.stat) || { stat: s.stat, order: s.order, value: 0 };
        // Haste is a multiplier, not additive points - two haste buffs don't add, keep the best.
        if (multiplierStats && multiplierStats.has(s.stat)) t.value = Math.max(t.value, s.value);
        else t.value += s.value;
        totals.set(s.stat, t);
      }
    }
  }
  return [...totals.values()].filter((t) => t.value).sort((a, b) => a.order - b.order);
}

// Fill a fixed number of slots from an ordered candidate list; the rest become "no free slot"
// overflow.
function fillSlots(ordered, count) {
  return {
    slots: ordered.slice(0, count),
    overflow: ordered.slice(count).map((c) => ({ ...c, reason: 'no free slot' })),
  };
}

// The owner's mental model (3 Sep): the 14 are the PRE-COMBAT loadout - long buffs you cast in one
// burst before a fight, then swap loadout to your combat spells. A short buff like Spirit of the
// Puma (60s) or a limited-proc one like Ward of the Divine belongs with THAT set, not the 14.
const COMBAT_BUFF_MAX_SEC = 300; // "something like 5 minutes" (the owner)
const COMBAT_CATEGORIES = new Set(['Combat Innates']);
function isCombatBuff(cand) {
  if (cand.infiniteDuration || cand.isSong) return false;
  if (COMBAT_CATEGORIES.has(cand.category)) return true;
  return typeof cand.durationSec === 'number' && cand.durationSec > 0 && cand.durationSec <= COMBAT_BUFF_MAX_SEC;
}

// Which pool a candidate belongs to.
//   'permanent' - never runs out (infiniteDuration: Yaulp, Fury), its own uncapped pool. NOT
//                 collapsed against a temp buff of the same category (so Fury still shows even when
//                 a higher-tier temp Strength buff is in the 14).
//   'song'      - a bard song (only when Bard is one of the classes), 5-slot symphonic pool
//   'combat'    - a short buff (<= 5 min) or a limited-proc combat innate (Puma, Ward of the
//                 Divine). Cast in a fight, not part of the standing loadout. Own uncapped pool.
//   'buff'      - everything else, the 14 pre-combat slots
function poolFor(cand, hasBard) {
  if (cand.infiniteDuration) return 'permanent';
  if (hasBard && cand.isSong) return 'song';
  if (isCombatBuff(cand)) return 'combat';
  return 'buff';
}

// The whole thing. Returns:
//   { classes, level, hasBard,
//     slots, overflow, candidates,               // the 14 spell-buff slots
//     songSlots, songOverflow, songCandidates,   // the 5 bard-song slots (empty unless Bard picked)
//     permanentSlots, permanentOverflow }        // permanent buffs (Yaulp/Fury), no cap
// `classes` is a list of codes (or {code} objects); `level` is the one shared character level.
function computePlan({ roster, classes, level, priorityOrder, checkStack, spellData, lines, excludedStats } = {}) {
  const normClasses = normalizeClasses(classes, level);
  const excluded = Array.isArray(excludedStats) ? excludedStats.filter((s) => typeof s === 'string') : [];
  const empty = {
    classes: [],
    level: clampLevel(level == null ? DEFAULT_LEVEL : level),
    hasBard: false,
    statsKnown: !!spellData,
    stackingKnown: !!(lines || checkStack),
    stackingCoverage: null,
    slots: [], overflow: [], candidates: [],
    songSlots: [], songOverflow: [], songCandidates: [],
    permanentSlots: [], permanentOverflow: [],
    combatSlots: [], combatOverflow: [],
    totals: [],
  };
  if (normClasses.length === 0) return empty;

  const hasBard = normClasses.some((c) => c.code === 'BRD');
  // The user's ignored-stats list, turned into a per-stat weight of 0 by the injected spellData
  // (spellEffects.combinedWeightScale). null when nothing is excluded => scoring path untouched,
  // byte-identical to before. The Balanced/Melee/Caster buttons are presets that write this list
  // in the renderer, not a separate weighting any more.
  const weightScale =
    spellData && spellData.weightScale && excluded.length ? spellData.weightScale(excluded) : null;

  const raw = candidatesFor(roster || [], normClasses, spellData, weightScale);
  const pool = (c) => poolFor(c, hasBard);

  // Collapse each stacking LINE to its single best castable tier BEFORE the permanent/temp split.
  // A line is an upgrade ladder whose tiers are mutually exclusive, so only the top one you can
  // cast is ever worth listing. The split below sends permanent tiers (Fury, Rage) to one pool and
  // finite ones (Frenzy) to another, and each pool used to collapse only its OWN members - so
  // Frenzy survived in the temp pool while Rage survived in the permanent pool, both on screen,
  // even though Rage being permanently up makes Frenzy pointless. This does NOT touch DIFFERENT
  // lines: a permanent Fury (shaman.frenzy line) and a finite Strength buff (shaman.strength line)
  // still both show - the owner's 27 Aug rule.
  const lineDrops = [];
  let pooledRaw = raw;
  if (lines) {
    const bestByLine = new Map(); // line id -> the highest-tier candidate present
    for (const c of raw) {
      const line = lines.lineForName(c.name);
      if (!line) continue;
      const prev = bestByLine.get(line.id);
      if (!prev || lines.tierOf(line, c.name) > lines.tierOf(line, prev.name)) bestByLine.set(line.id, c);
    }
    pooledRaw = raw.filter((c) => {
      const line = lines.lineForName(c.name);
      if (!line || bestByLine.get(line.id) === c) return true;
      const best = bestByLine.get(line.id).name;
      lineDrops.push({ ...c, reason: `${best} is the higher tier`, beatenBy: [best] });
      return false;
    });
  }

  // A haste / cast-speed buff that isn't the strongest source loses that stat's weight (EQ applies
  // one haste source at a time). Runs on the whole pooled set BEFORE the pool split and every
  // resolve/order pass, so the discounted score is what slot competition and Fix 7 see.
  if (spellData && spellData.multiplierStats) {
    discountRedundantMultipliers(pooledRaw, spellData.multiplierStats, weightScale);
  }

  // A buff/song whose every SCORED stat is one the user turned off is doing nothing for this build
  // (owner, 3 Sep: "frenzied strength is showing under caster buffs, even though it's a melee buff
  // only"). Drop it - re-ticking the stat brings it back. Resist / rune stats can't be excluded, so
  // a resist buff always keeps a live stat; a buff with no scored stat at all (a pure proc) is left
  // alone here - the Combat pool is uncapped and score is only its display order there.
  const excludedSet = new Set(excluded);
  const zeroedDrops = [];
  if (excludedSet.size) {
    pooledRaw = pooledRaw.filter((c) => {
      const scored = (c.stats || []).filter((s) => s.value);
      if (scored.length && scored.every((s) => excludedSet.has(s.stat))) {
        zeroedDrops.push({ ...c, reason: 'every stat it gives is turned off for this preset', beatenBy: [] });
        return false;
      }
      return true;
    });
  }

  // Permanent buffs (Yaulp, Fury) are "cast once and forget" - they get their OWN uncapped pool and
  // are resolved SEPARATELY, never deduped against a temp buff of a DIFFERENT line (the owner,
  // 27 Aug: Fury keeps its permanent listing even when a higher-tier temp Strength buff is also in
  // the 14). Resolving them in the same heading walk as the temp buffs was throwing Fury away as
  // "Rage is the higher tier".
  const permRaw = pooledRaw.filter((c) => pool(c) === 'permanent');
  const combatRaw = pooledRaw.filter((c) => pool(c) === 'combat');
  const tempRaw = pooledRaw.filter((c) => pool(c) !== 'permanent' && pool(c) !== 'combat');

  // ONE resolution across the pre-combat spell-buff + bard-song pools together (bard songs claim
  // the same shared headings where they overlap - haste, run speed - and their own private
  // headings elsewhere), THEN split for the slot caps. Permanent and combat buffs are resolved on
  // their OWN - they're a different loadout you swap to, so a short combat Strength proc does not
  // fight the standing Strength buff for a slot.
  const resolved = resolveByHeadings(tempRaw, priorityOrder, lines, checkStack);
  const resolvedPerm = resolveByHeadings(permRaw, priorityOrder, lines, checkStack);
  const resolvedCombat = resolveByHeadings(combatRaw, priorityOrder, lines, checkStack);
  const crossPoolDrops = [];
  const dropped = (which) =>
    (which === 'permanent'
      ? resolvedPerm.dropped
      : which === 'combat'
        ? resolvedCombat.dropped
        : resolved.dropped.filter((c) => pool(c) === which)
    )
      .concat(lineDrops.filter((c) => pool(c) === which))
      .concat(zeroedDrops.filter((c) => pool(c) === which))
      .concat(crossPoolDrops.filter((c) => pool(c) === which));
  const keptOrdered = orderCandidates(resolved.kept, priorityOrder);

  const songCands = keptOrdered.filter((c) => pool(c) === 'song');
  const buffCands = keptOrdered.filter((c) => pool(c) === 'buff');

  const buffs = fillSlots(buffCands, SLOT_COUNT);
  const songs = fillSlots(songCands, SONG_SLOT_COUNT);

  // The permanent and combat pools are resolved on their own so a Puma-style PROC still shows next
  // to a standing stat buff - a proc does not conflict in the stacking model. But a REAL same-slot
  // clash with a buff that took one of the 14 does matter (owner, 3 Sep: Frenzied Strength shows in
  // the combat pool while the log says "did not take hold. (Blocked by Strength.)"). Drop a
  // permanent/combat buff the model says is blocked by, or would overwrite, a slotted-14 buff.
  const clashWith14 = (c) => {
    for (const placed of buffs.slots) {
      if (lines) {
        const d = lines.stackDecision(c.name, placed.name);
        if (d === 'blocked' || d === 'overwrites') return placed.name;
      }
      if (checkStack && c.spellId != null && placed.spellId != null) {
        const v = checkStack(placed.spellId, c.spellId);
        if (v && v.conflict) return placed.name;
      }
    }
    return null;
  };
  const dropClashes = (cands) =>
    cands.filter((c) => {
      const clash = clashWith14(c);
      if (clash) {
        crossPoolDrops.push({ ...c, reason: `blocked by ${clash}, which is in your 14`, beatenBy: [clash] });
        return false;
      }
      return true;
    });
  const permCands = dropClashes(orderCandidates(resolvedPerm.kept, priorityOrder));
  const combatCands = dropClashes(orderCandidates(resolvedCombat.kept, priorityOrder));

  // "Why this one?" - for the tooltip on a slotted buff. Every dropped buff carries `beatenBy` (the
  // name(s) of the buff(s) that displaced it) + a `reason`; invert that so each winner knows the
  // buffs it beat. VoV keeping the haste slot over Alacrity shows up here as VoV.beat = [Alacrity].
  const allDrops = [
    ...resolved.dropped,
    ...resolvedPerm.dropped,
    ...resolvedCombat.dropped,
    ...lineDrops,
    ...zeroedDrops,
    ...crossPoolDrops,
    ...buffs.overflow,
    ...songs.overflow,
  ];
  const beatMap = new Map(); // winner name (lower) -> [{ name, reason, stats, score, combo }]
  for (const d of allDrops) {
    for (const winner of d.beatenBy || []) {
      const key = winner.toLowerCase();
      if (!beatMap.has(key)) beatMap.set(key, []);
      beatMap.get(key).push({
        name: d.name,
        reason: d.reason,
        stats: d.stats || [],
        score: d.score,
        combo: d.combo || null,
        stackWhy: d.stackWhy || null,
        redundantMultiplier: d.redundantMultiplier || null,
      });
    }
  }
  const withBeat = (list) => list.map((c) => ({ ...c, beat: beatMap.get(c.name.toLowerCase()) || [] }));
  buffs.slots = withBeat(buffs.slots);
  songs.slots = withBeat(songs.slots);
  const permSlots = withBeat(permCands);
  const combatSlots = withBeat(combatCands);

  // Fix 3 - coverage over the buffs that actually take a slot. `lineKnown` was tagged in
  // resolveByHeadings. Null when the fallback path ran (no `lines`), which `stackingKnown` covers.
  const slotted = [...buffs.slots, ...songs.slots, ...permSlots];
  const stackingCoverage =
    lines && slotted.length
      ? { known: slotted.filter((c) => c.lineKnown).length, total: slotted.length }
      : null;

  return {
    classes: normClasses,
    level: normClasses[0].level,
    hasBard,
    excludedStats: excluded,
    statsKnown: !!spellData,
    stackingKnown: !resolved.approximate && !resolvedPerm.approximate && !resolvedCombat.approximate,
    stackingCoverage,
    slots: buffs.slots,
    overflow: [...buffs.overflow, ...dropped('buff')],
    candidates: buffCands,
    songSlots: songs.slots,
    songOverflow: [...songs.overflow, ...dropped('song')],
    songCandidates: songCands,
    permanentSlots: permSlots,
    permanentOverflow: dropped('permanent'),
    // The combat / burst-swap loadout - short buffs (<= 5 min) and limited-proc combat innates
    // (Puma, Ward of the Divine). Own uncapped pool; NOT in `totals` (not part of the standing 14).
    combatSlots,
    combatOverflow: dropped('combat'),
    totals: sumStats([buffs.slots, songs.slots, permSlots], spellData && spellData.multiplierStats),
  };
}

module.exports = {
  computePlan,
  discountRedundantMultipliers,
  normalizeClasses,
  normalizeClassCodes,
  parseSpellClasses,
  isBardSongEntry,
  clampLevel,
  SLOT_COUNT,
  SONG_SLOT_COUNT,
  DEFAULT_LEVEL,
  MAX_CHARACTER_LEVEL,
  VALID_CLASSES,
  PLAYER_TARGETS,
};
