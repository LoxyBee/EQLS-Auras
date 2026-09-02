'use strict';

// The buff optimiser (the owner's ask, 26-27 Aug): "input 3 classes, spit out your highest buffs and
// the best setup across the buff slots" - ranked by the actual character-stat numbers, "level and
// duration have absolutely 0 to do with anything".
//
// Pure and dependency-free on purpose - it takes the roster, the three classes + one character
// level, an optional priority order, a stacking-check function, and a `spellData` reader (the real
// stat numbers), and returns a plan. `main.js` wires the real roster (buffStore), the real
// spellStacking.checkOverwrite, and spellEffects.js into it; tests wire fakes. Nothing here reads
// a file or knows an install path.
//
// HOW IT DECIDES:
//   - Candidates: every kind:'buff' roster entry one of the three classes can cast at the
//     character level, that can land on the player (Self/Group/Friendly/Single - not
//     Pet/Animal/Undead), that grants a real character stat. Heals, illusions, run speed, vision,
//     spell-focus and other pure utility are dropped - NON_STAT_CATEGORIES plus, when the spell
//     file is available, a fine check that the buff carries at least one recognised stat.
//   - "One per slot line" is the roster's own `category` column. The planner keeps the ONE buff
//     per category with the biggest headline-stat number - not the highest level, not the longest
//     duration. Where spellStacking has a real verdict for a pair it overrides that grouping (a
//     cross-category conflict it names is collapsed); it never invents one.
//   - Three pools: the 14 spell-buff slots, a 5-slot bard-song pool (only when Bard is picked),
//     and an uncapped permanent-buff pool (Yaulp/Fury). Songs and buffs are reconciled together;
//     permanents keep their own listing even when a temp buff shares their stat.
//   - Slots fill by the user's dragged priority order first, then by total stat contribution, so
//     when there are more buffs than slots it's the least valuable that drop. Overflow always says
//     why (no free slot / blocked by X).
//   - `totals` is the summed stat sheet across every slotted buff.

const SLOT_COUNT = 14;
// Bard songs occupy a separate pool from spell buffs in EQ (see spellStacking.js's own header), so
// they get their own slots on top of the 14. Only computed when Bard is one of the chosen classes.
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
    // name + weightScale feed the curated proc boost (Fix 10) and the playstyle preset (Fix 11).
    score: spellData.score(cand.spellId, cand.name, weightScale) || 0,
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

// FALLBACK collapse for when the line data isn't wired in (`lines` is null). Uses the game's own
// effect-slot data (spellStacking.checkOverwrite) for a same-category tier collapse; without even
// that, only merges shared base names. Imperfect - the real answer is resolveByHeadings below.
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
//   4. A buff with no line data falls back to spellStacking.checkOverwrite against the placed set.
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
    dropped.push({ ...worse, reason: `${better.name} is the higher tier` });
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
    // the candidates it would displace. No buff-specific code - it's a score comparison over the
    // real numbers, so it moves with the weights and the playstyle preset. Compared against the
    // whole ordered set (placed AND still-pending), because a high-scoring individual walked first
    // is already in `kept` and the combo must still be measured against it.
    const cLine = lines.lineForName(c.name);
    if (cLine && cLine.combination) {
      const displaced = ordered.filter(
        (o) => o !== c && lines.stackDecision(c.name, o.name) === 'overwrites'
      );
      const displacedScore = displaced.reduce((s, o) => s + (o.score || 0), 0);
      if (displaced.length && (c.score || 0) < displacedScore) {
        dropped.push({
          ...c,
          reason: `${displaced.map((d) => d.name).join(' + ')} together are worth more (${displacedScore} vs ${c.score || 0})`,
        });
        continue;
      }
    }

    let clash = null;
    for (const placed of kept) {
      const dec = lines.stackDecision(c.name, placed.name);
      if (dec === 'blocked' || dec === 'overwrites') {
        clash = placed.name;
        break;
      }
      if (dec === 'unknown' && checkStack && c.spellId != null && placed.spellId != null) {
        const a = checkStack(placed.spellId, c.spellId);
        const b = checkStack(c.spellId, placed.spellId);
        if ((a && a.overwrites) || (b && b.overwrites)) {
          clash = placed.name;
          break;
        }
      }
    }
    if (!clash) clash = headings.map((h) => occupied.get(h)).find(Boolean)?.name || null;

    if (clash) {
      dropped.push({ ...c, reason: `conflicts with ${clash}` });
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

// Which of the three pools a candidate belongs to.
//   'permanent' - never runs out (infiniteDuration: Yaulp, Fury), its own uncapped pool. Checked
//                 FIRST: a permanent buff is "cast once and forget" regardless of what else it is,
//                 and it is NOT collapsed against a temp buff of the same category (so Fury, a
//                 permanent shaman Strength buff, still shows even when Infusion of Spirit -
//                 higher-tier temp Strength - is in the 14).
//   'song'      - a bard song (only when Bard is one of the classes), 5-slot symphonic pool
//   'buff'      - everything else, the 14 spell-buff slots
function poolFor(cand, hasBard) {
  if (cand.infiniteDuration) return 'permanent';
  if (hasBard && cand.isSong) return 'song';
  return 'buff';
}

// The whole thing. Returns:
//   { classes, level, hasBard,
//     slots, overflow, candidates,               // the 14 spell-buff slots
//     songSlots, songOverflow, songCandidates,   // the 5 bard-song slots (empty unless Bard picked)
//     permanentSlots, permanentOverflow }        // permanent buffs (Yaulp/Fury), no cap
// `classes` is a list of codes (or {code} objects); `level` is the one shared character level.
const VALID_PLAYSTYLES = ['balanced', 'melee', 'caster'];

function computePlan({ roster, classes, level, priorityOrder, checkStack, spellData, lines, playstyle } = {}) {
  const normClasses = normalizeClasses(classes, level);
  const style = VALID_PLAYSTYLES.includes(playstyle) ? playstyle : 'balanced';
  const empty = {
    classes: [],
    level: clampLevel(level == null ? DEFAULT_LEVEL : level),
    hasBard: false,
    playstyle: style,
    statsKnown: !!spellData,
    stackingKnown: !!(lines || checkStack),
    stackingCoverage: null,
    slots: [], overflow: [], candidates: [],
    songSlots: [], songOverflow: [], songCandidates: [],
    permanentSlots: [], permanentOverflow: [],
    totals: [],
  };
  if (normClasses.length === 0) return empty;

  const hasBard = normClasses.some((c) => c.code === 'BRD');
  // Fix 11 - the playstyle preset. A per-stat weight multiplier the injected spellData knows how to
  // build (spellEffects.playstyleWeightScale). null / 'balanced' => all 1s, byte-identical scoring.
  const weightScale =
    spellData && spellData.weightScale && style !== 'balanced' ? spellData.weightScale(style) : null;

  const raw = candidatesFor(roster || [], normClasses, spellData, weightScale);
  const pool = (c) => poolFor(c, hasBard);

  // Permanent buffs (Yaulp, Fury) are "cast once and forget" - they get their OWN uncapped pool and
  // are resolved SEPARATELY, never deduped against the temp buffs (the owner, 27 Aug: Fury keeps its
  // permanent listing even when a higher-tier temp Strength buff is also in the 14). Resolving them
  // in the same heading walk as the temp buffs was throwing Fury away as "Rage is the higher tier".
  const permRaw = raw.filter((c) => pool(c) === 'permanent');
  const tempRaw = raw.filter((c) => pool(c) !== 'permanent');

  // ONE resolution across the temp spell-buff + bard-song pools together (bard songs claim the same
  // shared headings as spell buffs where they overlap - haste, run speed - and their own private
  // headings elsewhere), THEN split into pools for the slot caps.
  const resolved = resolveByHeadings(tempRaw, priorityOrder, lines, checkStack);
  const resolvedPerm = resolveByHeadings(permRaw, priorityOrder, lines, checkStack);
  const dropped = (which) =>
    which === 'permanent'
      ? resolvedPerm.dropped
      : resolved.dropped.filter((c) => pool(c) === which);
  const keptOrdered = orderCandidates(resolved.kept, priorityOrder);

  const songCands = keptOrdered.filter((c) => pool(c) === 'song');
  const buffCands = keptOrdered.filter((c) => pool(c) === 'buff');
  const permCands = orderCandidates(resolvedPerm.kept, priorityOrder);

  const buffs = fillSlots(buffCands, SLOT_COUNT);
  const songs = fillSlots(songCands, SONG_SLOT_COUNT);

  // Fix 3 - coverage over the buffs that actually take a slot. `lineKnown` was tagged in
  // resolveByHeadings. Null when the fallback path ran (no `lines`), which `stackingKnown` covers.
  const slotted = [...buffs.slots, ...songs.slots, ...permCands];
  const stackingCoverage =
    lines && slotted.length
      ? { known: slotted.filter((c) => c.lineKnown).length, total: slotted.length }
      : null;

  return {
    classes: normClasses,
    level: normClasses[0].level,
    hasBard,
    playstyle: style,
    statsKnown: !!spellData,
    stackingKnown: !resolved.approximate && !resolvedPerm.approximate,
    stackingCoverage,
    slots: buffs.slots,
    overflow: [...buffs.overflow, ...dropped('buff')],
    candidates: buffCands,
    songSlots: songs.slots,
    songOverflow: [...songs.overflow, ...dropped('song')],
    songCandidates: songCands,
    permanentSlots: permCands,
    permanentOverflow: dropped('permanent'),
    totals: sumStats([buffs.slots, songs.slots, permCands], spellData && spellData.multiplierStats),
  };
}

module.exports = {
  computePlan,
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
  VALID_PLAYSTYLES,
  PLAYER_TARGETS,
};
