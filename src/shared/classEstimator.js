'use strict';

// Guesses which of a multiclass character's (up to 3) classes an attacker's SKILLS came from.
//
// Owner, 13-14 Sep, in two parts:
//   - Buffs can be used for this, but ONLY when actually seen being CAST ("X cast puma" is an
//     indicator) - never from their damage. A buff's landing/proc damage (Puma Maw, say) proves
//     nothing about who cast the buff: it could be an ally's buff sitting on this attacker. A cast
//     line has no such ambiguity - "X begins casting Y." (or singing, for bard songs) always names
//     the real caster. So the ONLY input this takes is skill names already tied to a CAST line for
//     this specific attacker (self "You begin casting/singing X" or third-person "X begins
//     casting/singing Y.") - never a damage-log skill name. See damageEngine.js's
//     `castsByAttacker` for where these are collected.
//   - "Colour the classes by green for 100% guaranteed, orange for maybe" - a skill castable by
//     exactly one class is CONFIRMED. A skill shared by a small number of classes narrows things
//     down without confirming anything - MAYBE, for each of those classes, unless one of them is
//     already confirmed by something else. A skill shared by more classes than MAX_MAYBE_CLASSES
//     says nothing useful (a spell every caster class knows is not evidence of any one of them) and
//     is ignored outright.
const MAX_MAYBE_CLASSES = 3;

function estimateClasses(castSkillNames, classesForSpell) {
  const confirmed = new Set();
  const maybe = new Set();
  for (const name of castSkillNames || []) {
    if (!name) continue;
    const classes = classesForSpell(name);
    if (!classes || !classes.length) continue;
    if (classes.length === 1) {
      confirmed.add(classes[0]);
    } else if (classes.length <= MAX_MAYBE_CLASSES) {
      for (const c of classes) maybe.add(c);
    }
  }
  for (const c of confirmed) maybe.delete(c);
  return [
    ...[...confirmed].map((name) => ({ name, confidence: 'confirmed' })),
    ...[...maybe].map((name) => ({ name, confidence: 'maybe' })),
  ];
}

module.exports = { estimateClasses, MAX_MAYBE_CLASSES };
