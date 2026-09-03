// Spell effect-slot parsing from the client's own spells_us.txt.
//
// The buff-STACKING logic that used to live here (checkOverwrite / stackVerdict - a deliberately
// narrow EQEmu port) is GONE, replaced by the full ported engine: src/shared/spellStackingEngine.js
// (verdict) + src/main/stackingService.js (data binding). The per-spell effect slots it needs now
// travel on the roster itself (`stackEffects` on every buffs.json entry, written by
// build-roster.js), so the runtime no longer parses spells_us.txt for stacking at all.
//
// What's LEFT here: `denseEffects` + `effectValue`, still used by spellEffects.js for the Buff
// Planner's stat totals. Folding those onto the ported engine's own calcSpellValue and dropping
// this file entirely is the next step (its numbers show on the Total Stats card, so that swap gets
// verified against the owner's real spell file first).

const fs = require('fs');
const path = require('path');

const EFFECT_SLOTS = 12;
const SPA_BLANK = 254;

// The character's level isn't tracked anywhere in this app, and most stat buffs saturate at the
// server's own cap well before 50. Assuming max level is an accepted simplification for the
// planner's totals.
const ASSUMED_LEVEL = 50;

let cache = null; // { installRoot, rowsById: Map<spellId, string> }

function loadRows(installRoot) {
  if (cache && cache.installRoot === installRoot) return cache.rowsById;
  const rowsById = new Map();
  try {
    const raw = fs.readFileSync(path.join(installRoot, 'spells_us.txt'), 'utf8');
    for (const line of raw.split(/\r\n|\n/)) {
      if (!line) continue;
      const id = line.slice(0, line.indexOf('^'));
      if (id) rowsById.set(Number(id), line);
    }
  } catch {
    // No install root, or the file isn't there yet - callers get an empty map and every stack
    // check comes back "no verdict", the same as if this module didn't exist.
  }
  cache = { installRoot, rowsById };
  return rowsById;
}

// The pipe-delimited tail after the caret-delimited fields: one $-separated segment per occupied
// effect slot, each `slot|effectId|base|limitOrTargetSlot|formula|max`. A spell with fewer than 12
// real effects simply has fewer segments - denseEffects below fills the rest in as blank.
//
// The FIRST slot's number has no caret before it - the row's very last caret-delimited field IS
// the start of this block (e.g. `...^0^1|6|16|0|101|36`, where "1" is slot 1's number, not part of
// the field before it). Searching the whole row for the first literal "|" and slicing after it
// drops that leading "1" - confirmed the hard way, 25 Aug: it silently produced slot-1-blank for
// every single-effect spell, including Nimble and Agility, which is exactly the case this module
// exists for. Splitting on "^" first and taking the last field is what CLAUDE.md's own field-count
// check already relied on (173 fields, index 172 being this whole block) - safer than any pipe
// search over the raw string.
function parseEffectSegments(row) {
  const fields = row.split('^');
  const tail = fields[fields.length - 1];
  if (!tail || tail.indexOf('|') === -1) return [];
  return tail
    .split('$')
    .map((seg) => seg.split('|').map(Number))
    .filter((e) => e.length === 6 && Number.isFinite(e[0]));
}

// A dense 1-indexed array of 12 slots, so slot N always exists even when the spell has nothing
// there - a spell that leaves slot 2 blank still HAS a slot 2, and the comparison has to line up by
// slot number.
function denseEffects(installRoot, spellId) {
  const rowsById = loadRows(installRoot);
  const row = rowsById.get(spellId);
  const d = new Array(EFFECT_SLOTS + 1);
  for (let i = 1; i <= EFFECT_SLOTS; i++) d[i] = [i, SPA_BLANK, 0, 0, 0, 0];
  if (!row) return d;
  for (const e of parseEffectSegments(row)) {
    if (e[0] >= 1 && e[0] <= EFFECT_SLOTS) d[e[0]] = e;
  }
  return d;
}

// Mirrors EQEmu's Mob::CalcSpellEffectValue_formula for the formulas this project's own roster
// actually uses (confirmed against the roster's kind/scaleCategory buffs) - flat values and the
// handful of "+ some fraction of level" ramps. Anything outside that set falls back to the raw
// base value rather than guessing a formula shape with no ground truth behind it; an unscaled
// number here only makes this module less likely to find a match, never more (see the module
// comment's "never invents a conflict" guarantee).
function effectValue(base, max, formula, level) {
  const U = Math.abs(base);
  const sign = max !== 0 && max < base ? -1 : 1;
  let v;
  if (formula === 0 || formula === 100) v = U;
  else if (formula === 101) v = sign * (U + Math.floor(level / 2));
  else if (formula === 102) v = sign * (U + level);
  else if (formula === 103) v = sign * (U + 2 * level);
  else if (formula === 104) v = sign * (U + 3 * level);
  else if (formula === 105) v = sign * (U + 4 * level);
  else v = sign * U;
  if (max !== 0) {
    if (sign === 1 && v > max) v = max;
    if (sign === -1 && v < max) v = max;
  }
  if (base < 0 && v > 0) v = -v;
  return v;
}

module.exports = { effectValue, denseEffects, ASSUMED_LEVEL };
