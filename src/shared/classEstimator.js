'use strict';

// Guesses which of a multiclass character's (up to 3) classes a set of combat SKILLS came from.
// Owner, 13 Sep: a buff landing (e.g. Spirit of the Puma) can't be used for this - the landing
// text never says who cast it, so an ally casting it on the attacker would look identical to the
// attacker casting it on themselves. A combat/damage line has no such ambiguity: `"Baxa hits X for
// N by Puma Maw."` names the actual attacker outright, the same way a self-cast line always means
// "You". So this only ever looks at skill names already attributed to one specific attacker (the
// Combat tab's own per-skill breakdown), never at buffs.
//
// A skill castable by exactly one class is real evidence for that class. A skill several classes
// share (most nukes/procs) is ambiguous and contributes nothing - same "don't guess" rule the buff
// engine already follows for shared landing text. `classesForSpell(name)` is injected so this stays
// pure and testable without touching gameSpellData's file I/O; it should return either an array of
// class abbreviations able to cast that spell, or a falsy value when the spell isn't recognised.
function estimateClasses(skillNames, classesForSpell) {
  const found = new Set();
  for (const name of skillNames || []) {
    if (!name) continue;
    const classes = classesForSpell(name);
    if (classes && classes.length === 1) found.add(classes[0]);
  }
  return [...found];
}

module.exports = { estimateClasses };
