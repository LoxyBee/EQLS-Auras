'use strict';
/**
 * Binds the pure stacking engine (src/shared/spellStackingEngine.js) to the roster's per-spell
 * stacking data - `goodEffect` / `targetType` / `buffDurationFormula` / `buffDuration` /
 * `unstackableDot` / `isDiscipline` / `bardCastable` (named fields) + `stackEffects` (one coded
 * string of the raw slots), written onto every buffs.json entry by build-roster.js from
 * spells_us.txt.
 *
 * This REPLACES spellStacking.js's `checkOverwrite` / `stackVerdict` entirely. `buffLines`
 * (curated, real-log ground truth) still runs FIRST everywhere - this only answers what buffLines
 * returns `unknown` for.
 *
 * The engine needs a caster level. The Buff Planner passes the real one (`profile.plannerLevel`);
 * the live buff engine has no character level, so it passes 50 (the EQL cap) - fine for the common
 * case, and the conservative two-way gate in `wouldOverwriteLive` keeps a not-yet-capped low-level
 * spell from having a tile removed early.
 */

const { checkStackConflict, spellView } = require('../shared/spellStackingEngine');

function makeStackingService(buffStore) {
  const viewCache = new Map(); // spellId -> spellView | null

  function viewFor(spellId) {
    if (spellId == null) return null;
    if (viewCache.has(spellId)) return viewCache.get(spellId);
    const entry = buffStore.getBySpellId(spellId);
    // goodEffect is written for every client-matched entry, so it's the "has stacking data" marker.
    const v = entry && entry.goodEffect != null ? spellView(entry) : null;
    viewCache.set(spellId, v);
    return v;
  }

  // Raw engine verdict: -1 cast blocked · 0 stack/unrelated · 1 cast overwrites worn.
  // null when either spell has no stacking data in the roster.
  function verdict(wornId, castId, wornLevel = 50, castLevel = 50) {
    const w = viewFor(wornId);
    const c = viewFor(castId);
    if (!w || !c) return null;
    return checkStackConflict(w, c, wornLevel, castLevel);
  }

  // For buffPlanner.resolveByHeadings' `unknown` fallback: can these two both be in the loadout?
  // `{ overwrites, blocked, conflict }` (conflict = they collide in EITHER direction), or null.
  function planConflict(activeId, incomingId, level = 50) {
    const fwd = verdict(activeId, incomingId, level, level); // cast incoming while active is worn
    if (fwd == null) return null;
    const rev = verdict(incomingId, activeId, level, level);
    return {
      overwrites: fwd === 1,
      blocked: fwd === -1,
      conflict: fwd !== 0 || rev === 1 || rev === -1,
    };
  }

  // For buffEngine._land tile removal. Returns true ONLY when the incoming buff cleanly and
  // unambiguously replaces the active one: the engine says "incoming overwrites worn" AND "worn
  // does NOT overwrite incoming" (a one-way conflict). A two-way or level-sensitive result leaves
  // the tile alone - the safe direction. Level assumed 50 (see the header).
  function wouldOverwriteLive(activeSpellId, incomingSpellId) {
    const fwd = verdict(activeSpellId, incomingSpellId, 50, 50);
    if (fwd !== 1) return false;
    // The reverse must agree: worn is blocked by / coexists with incoming, not "also overwrites".
    return verdict(incomingSpellId, activeSpellId, 50, 50) !== 1;
  }

  function invalidate() {
    viewCache.clear();
  }

  return { verdict, planConflict, wouldOverwriteLive, invalidate };
}

module.exports = { makeStackingService };
