'use strict';

// Guesses which of a multiclass character's (up to 3) classes an attacker's SKILLS came from.
//
// Owner, 13-14 Sep, several rounds:
//   - Buffs can be used for this, but ONLY when actually seen being CAST ("X cast puma" is an
//     indicator) - never from their damage. A buff's landing/proc damage (Puma Maw, say) proves
//     nothing about who cast the buff: it could be an ally's buff sitting on this attacker. A cast
//     line has no such ambiguity - "X begins casting Y." (or singing, for bard songs) always names
//     the real caster. So the ONLY input this takes is skill names already tied to a CAST line for
//     this specific attacker, scoped to ONE FIGHT ("it is only supposed to take into account that
//     fight") - never a damage-log skill name, and never the whole session. See damageEngine.js's
//     `castsByAttacker`.
//   - "Colour the classes by green for 100% guaranteed, orange for maybe" - a skill castable by
//     exactly one class is CONFIRMED. A skill shared by a small number of classes narrows things
//     down without confirming anything - MAYBE, for each of those classes, unless one is already
//     confirmed by something else. A skill shared by more classes than MAX_MAYBE_CLASSES says
//     nothing useful (a spell every caster class knows is not evidence of any one of them).
//   - A multiclass character has EXACTLY 3 classes, never more (the same fact the Buff Planner's
//     own "input 3 classes" design already relies on) - so the result is capped at
//     MAX_TOTAL_CLASSES regardless of how much evidence comes in, ranked by how many DISTINCT
//     spells pointed at each class. This is what "what in the fuck happened to the class
//     estimation" (10+ classes shown for one attacker) turned out to be: with castsByAttacker
//     accumulating across an entire multi-hour log, dozens of different ambiguous 2-3-class spells
//     each added their own candidates to "maybe", and a plain set union has no ceiling - given
//     enough distinct spells, it approaches "every class in the game". Per-fight scoping (above)
//     already shrinks the input a great deal; the cap here is the hard backstop regardless.
const MAX_MAYBE_CLASSES = 3;
const MAX_TOTAL_CLASSES = 3;

function estimateClasses(castSkillNames, classesForSpell) {
  const confirmedCounts = new Map();
  const maybeCounts = new Map();
  for (const name of castSkillNames || []) {
    if (!name) continue;
    const classes = classesForSpell(name);
    if (!classes || !classes.length) continue;
    if (classes.length === 1) {
      const c = classes[0];
      confirmedCounts.set(c, (confirmedCounts.get(c) || 0) + 1);
    } else if (classes.length <= MAX_MAYBE_CLASSES) {
      for (const c of classes) maybeCounts.set(c, (maybeCounts.get(c) || 0) + 1);
    }
  }
  for (const c of confirmedCounts.keys()) maybeCounts.delete(c);

  const byCountDesc = (a, b) => b[1] - a[1];
  const confirmed = [...confirmedCounts].sort(byCountDesc).map(([name]) => name).slice(0, MAX_TOTAL_CLASSES);
  const remaining = Math.max(0, MAX_TOTAL_CLASSES - confirmed.length);
  const maybe = [...maybeCounts].sort(byCountDesc).map(([name]) => name).slice(0, remaining);

  return [
    ...confirmed.map((name) => ({ name, confidence: 'confirmed' })),
    ...maybe.map((name) => ({ name, confidence: 'maybe' })),
  ];
}

module.exports = { estimateClasses, MAX_MAYBE_CLASSES, MAX_TOTAL_CLASSES };
