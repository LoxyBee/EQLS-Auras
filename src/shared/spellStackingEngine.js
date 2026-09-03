'use strict';
/**
 * The full EQEmu buff-stacking conflict engine, ported verbatim into =auras.
 *
 * Owner instruction (2 Sep 2026): "i want the exact engine inside =auras, it doesn't matter if you
 * deem it not important, if it's a mechanic, it needs to be in just in case it's needed." So every
 * branch of the reference engine is here - bard-pool separation, Screech, Stacker A-D, the 148/149
 * stacking directives, Complete Heal, DoT coexistence, movement/snare, AttackSpeed -100, the
 * ~90-entry IGNORED_IN_STACKING set, the group-vs-single tie - not just the parts the older
 * `spellStacking.js` modelled.
 *
 * SOURCE. A published client-side EQL stacking-engine implementation (its `stacking.js` +
 * `stacking_rules.js` + `calcSpellValue`), itself a parity-gated port of EQEmu `zone/spells.cpp`
 * Mob::CheckStackConflict @ b69fa9cbcd75. Ported ESM -> CJS with no other changes;
 * `test/spell-stacking-parity.test.js` asserts identical verdicts against that reference over every
 * ordered pair of the EQL spell set.
 *
 * EQL DEVIATION (carried from the source): the stacking-directive target slot is 1-BASED in the
 * effect's `limit` field, not Live's formula-201 encoding. `directiveSlot(e) = e.limit - 1`.
 *
 * PURE. No fs, no electron, no clock. `checkStackConflict(worn, cast, wornLevel, castLevel)` takes
 * two `spellView` objects and returns -1 (cast is blocked) / 0 (they stack / unrelated) / 1 (cast
 * overwrites worn). The data binding that builds a `spellView` from the user's own spells_us.txt
 * lives in `src/main/spellStacking.js`.
 */

// --- SPA (spell-effect id) constants -------------------------------------------------------------
// GENERATED in the source from EQEmu common/spdat.h @ b69fa9cbcd75. Do not hand-edit.
const SE_CURRENTHP = 0;
const SE_ARMORCLASS = 1;
const SE_MOVEMENTSPEED = 3;
const SE_CHA = 10;
const SE_ATTACKSPEED = 11;
const SE_ATTACKSPEED2 = 98;
const SE_COMPLETEHEAL = 101;
const SE_SCREECH = 123;
const SE_STACKINGCOMMAND_BLOCK = 148;
const SE_STACKINGCOMMAND_OVERWRITE = 149;
const SE_BLANK = 254;
const SE_MANABURN = 350;
const SE_ACV2 = 416;
const SE_GRAVITYEFFECT = 424;
const SE_IMPROVEDTAUNT = 444;
const SE_ASTACKER = 446;
const SE_BSTACKER = 447;
const SE_CSTACKER = 448;
const SE_DSTACKER = 449;

// The ~90 SPAs the server excludes from magnitude arbitration entirely - focus mods, vision
// (see-invis / infravision / ultravision), levitation, corruption counters, every Focus* SPA, etc.
// A collision on one of these never blocks or overwrites.
const IGNORED_IN_STACKING = new Set([
  13, 35, 36, 39, 57, 65, 66, 79, 116, 124, 125, 126, 127, 128, 129, 130, 131, 132, 133, 134, 135,
  136, 137, 138, 139, 140, 141, 142, 143, 144, 148, 149, 167, 220, 235, 254, 286, 287, 296, 297,
  302, 303, 310, 311, 335, 340, 348, 369, 374, 382, 385, 391, 392, 393, 394, 395, 396, 411, 412,
  413, 415, 418, 420, 421, 422, 423, 424, 425, 476, 479, 480, 483, 484, 485, 486, 490, 491, 492,
  493, 495, 500, 501, 511, 512,
]);
// Bard AE DoT component (SPA 334): two bard songs are allowed to share it.
const BARD_ONLY_STACK_EFFECTS = new Set([334]);

const EFFECT_COUNT = 12;
const GROUP_TARGET_TYPES = new Set([0x03, 0x28, 0x29]);
const STACKERS = [SE_ASTACKER, SE_BSTACKER, SE_CSTACKER, SE_DSTACKER];
const BLANK_EFFECT = [SE_BLANK, 0, 0, 100, 0];

// --- calcSpellValue (ported from the source's data.js) -----------------------------------------
// EQEmu spell_effects.cpp CalcSpellEffectValue_formula. Given a slot's raw base / formula / max,
// the value the live client shows at the given caster level. Degenerating formulas (107/108/120/
// 122) return the un-degenerated start value; breakpoint formulas (111-118 / 124-126 / 139-140)
// contribute nothing below their level threshold; the random formula (123) returns a midpoint.
function spellDelta(formula, level, base, max) {
  let delta = 0;
  if (formula === 0 || formula === 100) {
    delta = 0;
  } else if (formula >= 1 && formula <= 10) {
    delta = level * formula;
  } else {
    switch (formula) {
      case 101: delta = Math.floor(level / 2); break;
      case 102: delta = level; break;
      case 103: delta = level * 2; break;
      case 104: delta = level * 3; break;
      case 105: delta = level * 4; break;
      case 106: delta = level * 5; break;
      case 107: delta = 0; break; // degenerating
      case 108: delta = 0; break; // degenerating
      case 109: delta = Math.floor(level / 4); break;
      case 110: delta = Math.floor(level / 6); break;
      case 111: delta = 6 * Math.max(0, level - 16); break;
      case 112: delta = 8 * Math.max(0, level - 24); break;
      case 113: delta = 10 * Math.max(0, level - 34); break;
      case 114: delta = 15 * Math.max(0, level - 44); break;
      case 115: delta = level > 15 ? 7 * (level - 15) : 0; break;
      case 116: delta = level > 24 ? 10 * (level - 24) : 0; break;
      case 117: delta = level > 34 ? 13 * (level - 34) : 0; break;
      case 118: delta = level > 44 ? 20 * (level - 44) : 0; break;
      case 119: delta = Math.floor(level / 8); break;
      case 120: delta = 0; break; // degenerating
      case 121: delta = Math.floor(level / 3); break;
      case 122: delta = 0; break; // degenerating (Splurt)
      case 123: {
        const m = Math.abs(max);
        if (m === 0) { delta = 0; break; }
        delta = Math.floor((m - Math.abs(base)) / 2);
        break;
      }
      case 124: delta = Math.max(0, level - 50); break;
      case 125: delta = 2 * Math.max(0, level - 50); break;
      case 126: delta = 3 * Math.max(0, level - 50); break;
      case 139: delta = level > 30 ? Math.floor((level - 30) / 2) : 0; break;
      case 140: delta = level > 30 ? level - 30 : 0; break;
      default: delta = 0; break;
    }
  }
  return delta;
}

// A property of the FORMULA, not of one level's rounded delta: integer-division formulas
// (101 = /2, 109 = /4) round to 0 at low levels yet still scale.
function scalesWithLevel(formula) {
  return spellDelta(formula, 1, 0, 0) !== spellDelta(formula, 10000, 0, 0);
}

function calcSpellValue(base, formula, max, level) {
  const delta = spellDelta(formula, level, base, max);
  // A genuinely-scaling effect whose cap magnitude is BELOW the base magnitude (SPA-11 Slows:
  // base 90, max 30) shrinks from |base| toward the |max| floor - it does not grow from base.
  if (max !== 0 && Math.abs(max) < Math.abs(base) && scalesWithLevel(formula)) {
    const sign = base < 0 ? -1 : 1;
    return sign * Math.max(Math.abs(base) - delta, Math.abs(max));
  }
  let result = base >= 0 ? base + delta : base - delta;
  if (max !== 0) {
    if (base >= 0) {
      if (result > max) result = max;
    } else {
      const cap = -Math.abs(max);
      if (result < cap) result = cap;
    }
  }
  return result;
}

// --- spellView -------------------------------------------------------------------------------
// The engine's 12-slot view of a spell: `effects` is a dense length-12 array of
// [spa, base, limit, formula, max], blanks filling any gap so slot positions line up exactly.
//
// Two input shapes are accepted, so the same engine serves the parity test and the running app:
//   1. The roster shape (src/shared/data/buffs.json): `goodEffect` / `targetType` /
//      `buffDurationFormula` / `buffDuration` / `unstackableDot` / `isDiscipline` / `bardCastable`
//      as named fields, plus `stackEffects` - one coded string of the sparse 0-indexed non-blank
//      slots, `"slot,spa,base,limit,formula,max;slot,..."` (build-roster.js writes it; there's no
//      readable form of raw effect data). A sparse array of the same 6-tuples is also accepted.
//   2. The reference spells.json record shape (parity test): `good_effect` etc. snake_case, and
//      `effects` as objects with an explicit `slot` (or a dense 12-array of the 5-tuples).
function spellView(sp) {
  const effects = Array.from({ length: EFFECT_COUNT }, () => BLANK_EFFECT);
  if (sp.stackEffects != null && sp.stackEffects !== '') {
    const segs =
      typeof sp.stackEffects === 'string'
        ? sp.stackEffects.split(';').map((x) => x.split(',').map(Number))
        : sp.stackEffects;
    for (const e of segs) {
      if (Array.isArray(e) && e.length >= 6 && e[0] >= 0 && e[0] < EFFECT_COUNT) {
        effects[e[0]] = [e[1], e[2], e[3], e[4], e[5]];
      }
    }
  } else {
    const src = sp.effects || [];
    if (Array.isArray(src) && src.length && Array.isArray(src[0])) {
      for (let i = 0; i < EFFECT_COUNT && i < src.length; i++) {
        const e = src[i];
        if (e && e.length >= 5) effects[i] = [e[0], e[1], e[2], e[3], e[4]];
      }
    } else {
      for (const e of src) {
        if (e && e.slot >= 0 && e.slot < EFFECT_COUNT) {
          effects[e.slot] = [e.effect_id, e.base_value, e.limit_value, e.formula, e.max_value];
        }
      }
    }
  }

  const val = (camel, snake) => (sp[camel] != null ? sp[camel] : sp[snake]);
  // `bardCastable` = "bard can cast this at all" (spells_us.txt classes column, field 43 < 255)
  // MINUS disciplines - NOT the roster's tagged `isBardSong`, which is bard-ONLY and would wrongly
  // drop a shared BRD/other song from the bard pool. A hand-built test view may set `isBardSong`
  // directly; a real record never does (that key means something else on a roster entry).
  const isDisc = !!val('isDiscipline', 'is_discipline');
  let isBardSong;
  if (sp.bardCastable != null) {
    isBardSong = !!sp.bardCastable && !isDisc;
  } else if (Array.isArray(sp.classes)) {
    isBardSong = sp.classes[7] < 255 && !isDisc;
  } else if (typeof sp.bardLevel === 'number') {
    isBardSong = sp.bardLevel < 255 && !isDisc;
  } else {
    isBardSong = !!sp.isBardSong;
  }

  return {
    id: sp.id != null ? sp.id : sp.spellId,
    name: sp.name,
    goodEffect: val('goodEffect', 'good_effect'),
    targetType: val('targetType', 'target_type'),
    buffDurationFormula: val('buffDurationFormula', 'buff_duration_formula'),
    buffDuration: val('buffDuration', 'buff_duration'),
    isBardSong,
    unstackableDot: !!val('unstackableDot', 'unstackable_dot'),
    effects,
  };
}

const isDetrimental = (sp) => sp.goodEffect === 0;
const isGroupSpell = (sp) => GROUP_TARGET_TYPES.has(sp.targetType);
const hasEffect = (sp, spa) => sp.effects.some((e) => e[0] === spa);

function isBlankSlot(e) {
  const spa = e[0];
  const base = e[1];
  const formula = e[3];
  return (
    spa === SE_BLANK ||
    (spa === SE_CHA && base === 0 && formula === 100) ||
    spa === SE_STACKINGCOMMAND_BLOCK ||
    spa === SE_STACKINGCOMMAND_OVERWRITE
  );
}

function isStackableDot(sp) {
  if (sp.unstackableDot || sp.goodEffect || !sp.buffDurationFormula) return false;
  return hasEffect(sp, SE_CURRENTHP) || hasEffect(sp, SE_GRAVITYEFFECT);
}

const value = (sp, slot, level) => {
  const e = sp.effects[slot];
  return calcSpellValue(e[1], e[3], e[4], level);
};

const directiveSlot = (e) => e[2] - 1; // EQL: 1-based target slot in `limit`

// worn = the buff already up (sp1); cast = the buff being cast (sp2).
// -1 : the cast spell is blocked · 0 : unrelated / they stack · 1 : the cast spell overwrites worn.
function checkStackConflict(sp1, sp2, level1 = 50, level2 = 50) {
  if (sp1.id === sp2.id) {
    if (!isStackableDot(sp1) && !hasEffect(sp1, SE_MANABURN)) {
      if (level1 > level2) return hasEffect(sp1, SE_IMPROVEDTAUNT) ? 1 : -1;
      return 1;
    }
    if (hasEffect(sp1, SE_MANABURN)) return -1;
  }

  if (sp1.isBardSong !== sp2.isBardSong && !isDetrimental(sp1) && !isDetrimental(sp2)) return 0;

  let effectMatch = sp1.id === sp2.id;
  if (!effectMatch) {
    effectMatch = true;
    for (let i = 0; i < EFFECT_COUNT; i++) {
      if (sp1.effects[i][0] !== sp2.effects[i][0] || sp1.effects[i][0] === SE_MANABURN) {
        effectMatch = false;
        break;
      }
    }
  }

  if (!effectMatch) {
    for (let i = 0; i < EFFECT_COUNT; i++) {
      const e1 = sp1.effects[i];
      const e2 = sp2.effects[i];

      if (
        e2[0] === SE_SCREECH &&
        e2[1] === -1 &&
        sp1.effects.some((x) => x[0] === SE_SCREECH && x[1] === 1)
      ) {
        return -1;
      }
      for (let k = 0; k < STACKERS.length; k++) {
        const stacker = STACKERS[k];
        if (e2[0] === stacker) {
          const worn = sp1.effects.filter((x) => x[0] === stacker).map((x) => x[1]);
          if (worn.length && e2[1] <= Math.max(...worn)) return -1;
        }
        if (k > 0 && e2[0] === STACKERS[k - 1] && hasEffect(sp1, stacker)) return -1;
      }

      if (e2[0] === SE_STACKINGCOMMAND_OVERWRITE) {
        const slot = directiveSlot(e2);
        if (
          slot >= 0 &&
          slot < EFFECT_COUNT &&
          sp1.effects[slot][0] === e2[1] &&
          value(sp1, slot, level1) < e2[4]
        ) {
          return 1;
        }
      } else if (e1[0] === SE_STACKINGCOMMAND_BLOCK) {
        const slot = directiveSlot(e1);
        if (
          slot >= 0 &&
          slot < EFFECT_COUNT &&
          sp2.effects[slot][0] === e1[1] &&
          value(sp2, slot, level2) < e1[4]
        ) {
          if (!isDetrimental(sp2)) return -1; // Live 2018: detrimentals bypass a block directive
        }
      }
    }
  }

  const sp1Det = isDetrimental(sp1);
  const sp2Det = isDetrimental(sp2);

  let willOverwrite = false;
  let valuesEqual = true;
  for (let i = 0; i < EFFECT_COUNT; i++) {
    const e1 = sp1.effects[i];
    const e2 = sp2.effects[i];
    if (isBlankSlot(e1) || isBlankSlot(e2)) continue;
    if (e1[0] !== e2[0]) continue;
    if (BARD_ONLY_STACK_EFFECTS.has(e1[0]) && sp1.isBardSong && sp2.isBardSong) continue;
    if (IGNORED_IN_STACKING.has(e1[0])) continue;
    if ((e1[0] === SE_ARMORCLASS || e1[0] === SE_ACV2) && e2[1] < 0) continue;
    if (e1[0] === SE_COMPLETEHEAL) return -1;
    if (e1[0] === SE_CURRENTHP && sp1.id !== sp2.id && sp1Det && sp2Det) continue;

    let v1 = value(sp1, i, level1);
    let v2 = value(sp2, i, level2);

    if (e1[0] === SE_MOVEMENTSPEED) {
      if (v1 < 0 && v2 > 0) return -1;
      if (v2 < 0 && v1 > 0) continue;
    }

    if (sp1.buffDuration > 0 && sp2.buffDuration > 0 && e1[0] === SE_CURRENTHP) {
      if (!sp1Det && sp2Det) continue;
      if (sp1Det && !sp2Det) return -1;
    }

    if (e1[0] === SE_ATTACKSPEED || e1[0] === SE_ATTACKSPEED2) {
      v1 -= 100;
      v2 -= 100;
    }
    v1 = Math.abs(v1);
    v2 = Math.abs(v2);

    if (v2 < v1) return -1;
    if (v2 !== v1) valuesEqual = false;
    willOverwrite = true;
  }

  if (willOverwrite) {
    if (valuesEqual && effectMatch && !isGroupSpell(sp2) && isGroupSpell(sp1)) return -1;
    return 1;
  }
  return 0;
}

module.exports = {
  checkStackConflict,
  spellView,
  calcSpellValue,
  spellDelta,
  scalesWithLevel,
  EFFECT_COUNT,
  IGNORED_IN_STACKING,
  BARD_ONLY_STACK_EFFECTS,
};
