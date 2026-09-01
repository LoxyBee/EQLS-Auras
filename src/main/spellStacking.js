// Whether one self-buff would overwrite another, computed from the game's own spell data instead
// of guessed. Exists for note 26: EQ prints an explicit "has been overwritten" line when a buff on
// someone ELSE gets replaced, but nothing at all when it happens to the player's own buff - see the
// gotcha in CLAUDE.md. Some spells even share their fade text (Nimble/Agility both say "Your
// agility fades."), so a naive reading of the log can't tell which of two active buffs a fade line
// belongs to.
//
// EQEmu (the open-source server codebase most EQ emulators, including this one, descend from) has
// a public, well-known algorithm for exactly this - Mob::CheckStackConflict - which the client's
// own spells_us.txt already carries the data for for every spell, the same file bardSongTagger.js
// already mines. This module reimplements the CORE of that algorithm (same
// effect ID landing in the same numbered slot, compared by magnitude, plus the two dedicated
// "stacking command" effect slots spells can carry) against real ground truth pulled from the
// owner's own logs and spell file, 25 Aug: five confirmed "did not take hold... (Blocked by X)"
// pairs (Strength/Dexterity/Infusion of Spirit/Talisman of Altuna, all blocked by Harnessing of
// Spirit; Armor of Protection blocked by Talisman of Altuna) plus the two shared-fade-text pairs
// this file exists to resolve (Nimble/Agility, Symbol of Pinzarn/Symbol of Naltron). All seven
// check out under this rule; two unrelated spells (Spirit of the Puma, Clarity) share no effect ID
// with any of them, so it isn't a coincidence that happens to explain everything.
//
// DELIBERATELY NARROWER than EQEmu's full algorithm. The real one also special-cases identity
// effects (illusions/procs, ranked by an id rather than a magnitude), Complete Heal, DoT-vs-DoT
// coexistence, snares vs movement buffs, bard songs occupying a separate pool from spells, and
// group-spell-vs-single-target blocking - none of which any of the seven confirmed pairs needed,
// and none of which this project has independently verified against its own data. Skipping them
// means an occasional pair this doesn't recognize a conflict for (never a false conflict it
// invents) - see the constructor comment on useStackingModel in buffEngine.js for how that's kept
// safe: a verdict here only ever REMOVES a stale entry when both directions agree, never adds one.
//
// PERFORMANCE: this never runs on every log line. buffEngine.js only calls it from _land(), against
// whichever OTHER self buffs are currently active (typically a handful), and every verdict is
// cached by spell-id pair - a repeated combination (the common case, since self-buffs repeat) is a
// Map lookup, not a recomputation.

const fs = require('fs');
const path = require('path');

const EFFECT_SLOTS = 12;
// SPA (Spell Effect ID) numbers, from EQEmu's own public spell-effects table - not invented here.
const SPA_BLOCK = 148; // StackingBlock - carried by the buff already up
const SPA_OVERWRITE = 149; // StackingCommand_Overwrite - carried by the incoming cast
const SPA_BLANK = 254;
const SPACER = { spa: 10, base: 0, formula: 100 }; // a CHA "spacer" effect - not a real effect

// The character's level isn't tracked anywhere in this app today, and most of the spells this
// exists for (mid-to-high-level stat buffs) saturate at the server's own level cap well before it -
// see _effectValue's comment on formula 101 for the measured example. Assuming max level is a
// known, accepted simplification: it can only misjudge a magnitude comparison for a spell whose
// value hasn't capped out yet, which just means this module declines to find a conflict rather than
// inventing a wrong one (see stackVerdict's "both directions must agree" rule below).
const ASSUMED_LEVEL = 50;

let cache = null; // { installRoot, rowsById: Map<spellId, string> }
const verdictCache = new Map(); // `${activeId}:${incomingId}` -> verdict or null

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

function isBlankEffect(entry) {
  const [, spa, base, , formula] = entry;
  return (
    spa === SPA_BLANK ||
    (spa === SPACER.spa && base === SPACER.base && formula === SPACER.formula) ||
    spa === SPA_BLOCK ||
    spa === SPA_OVERWRITE
  );
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

// "I have `activeId` up. `incomingId` just landed. Does it overwrite the active one?"
// Returns { overwrites: true, why } or null (no conflict found - they simply coexist, or this
// module doesn't have enough to say confidently).
function checkOverwrite(installRoot, activeId, incomingId, level = ASSUMED_LEVEL) {
  if (activeId === incomingId) return null; // a recast; buffEngine already handles refreshing
  const dActive = denseEffects(installRoot, activeId);
  const dIncoming = denseEffects(installRoot, incomingId);

  // The two dedicated stacking-command slots: SPA_OVERWRITE on the incoming spell names an effect
  // to look for, which slot to look in on the OTHER spell, and a threshold - "if that slot's value
  // is under this much, I replace it outright," regardless of ordinary slot-by-slot comparison.
  for (let i = 1; i <= EFFECT_SLOTS; i++) {
    const [, spa, wantSpa, targetSlot, , threshold] = dIncoming[i];
    if (spa !== SPA_OVERWRITE) continue;
    if (targetSlot < 1 || targetSlot > EFFECT_SLOTS) continue;
    const activeSlot = dActive[targetSlot];
    if (activeSlot[1] !== wantSpa) continue;
    const activeValue = effectValue(activeSlot[2], activeSlot[5], activeSlot[4], level);
    if (Math.abs(activeValue) < threshold) {
      return { overwrites: true, why: `slot ${targetSlot} SPA ${wantSpa} on the active buff (${activeValue}) is under the incoming spell's overwrite threshold (${threshold})` };
    }
  }

  // Ordinary slot-by-slot arbitration: two spells only collide where they carry the SAME effect ID
  // in the SAME slot number. Where they do, the higher magnitude wins; if every colliding slot
  // favors the incoming spell (and at least one slot actually collided), it overwrites.
  let collided = false;
  let incomingWinsAll = true;
  const reasons = [];
  for (let i = 1; i <= EFFECT_SLOTS; i++) {
    if (isBlankEffect(dActive[i]) || isBlankEffect(dIncoming[i])) continue;
    if (dActive[i][1] !== dIncoming[i][1]) continue;
    collided = true;
    const activeValue = Math.abs(effectValue(dActive[i][2], dActive[i][5], dActive[i][4], level));
    const incomingValue = Math.abs(effectValue(dIncoming[i][2], dIncoming[i][5], dIncoming[i][4], level));
    if (incomingValue < activeValue) {
      incomingWinsAll = false;
      break;
    }
    reasons.push(`slot ${i} SPA ${dActive[i][1]} (${incomingValue} vs ${activeValue})`);
  }
  if (collided && incomingWinsAll) {
    return { overwrites: true, why: `matches the active buff's effect slots and is at least as strong - ${reasons.join(', ')}` };
  }
  return null;
}

// The pair, both directions. Only reports a verdict when casting the incoming spell would
// overwrite the active one AND the active spell, cast back at the incoming one, would NOT
// overwrite it in return - i.e. the two directions agree on who wins. A tie or a disagreement
// (which can happen once the many special cases this module skips actually matter) means "not
// confident enough," and the caller does nothing rather than guess.
function stackVerdict(installRoot, activeId, incomingId, level = ASSUMED_LEVEL) {
  const key = `${activeId}:${incomingId}:${level}`;
  if (verdictCache.has(key)) return verdictCache.get(key);
  const forward = checkOverwrite(installRoot, activeId, incomingId, level);
  const reverse = incomingId === activeId ? null : checkOverwrite(installRoot, incomingId, activeId, level);
  const verdict = forward && !reverse ? forward : null;
  verdictCache.set(key, verdict);
  return verdict;
}

module.exports = { stackVerdict, checkOverwrite, effectValue, denseEffects, ASSUMED_LEVEL };
