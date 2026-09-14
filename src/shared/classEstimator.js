'use strict';

// Guesses which of a multiclass character's (up to 3) classes an attacker's SKILLS came from.
//
// Owner, 13-14 Sep, several rounds:
//   - Buffs can be used for this, but ONLY when actually seen being CAST ("X cast puma" is an
//     indicator) - never from their damage. A buff's landing/proc damage (Puma Maw, say) proves
//     nothing about who cast the buff: it could be an ally's buff sitting on this attacker. A cast
//     line has no such ambiguity - "X begins casting Y." (or singing, for bard songs) always names
//     the real caster. So the ONLY input this takes is skill names already tied to a CAST line for
//     this specific attacker - never a damage-log skill name. See damageEngine.js's
//     `castsByAttacker` (session-wide - a class is a fact about the person, not one pull).
//   - A skill castable by exactly one class is a real (if not certain) signal; a skill shared by a
//     small number of classes narrows things down a little for each of them. A skill shared by
//     more classes than MAX_MAYBE_CLASSES says nothing useful and is ignored outright.
//   - A multiclass character has EXACTLY 3 classes, never more (the same fact the Buff Planner's
//     own "input 3 classes" design already relies on) - so the result is capped at
//     MAX_TOTAL_CLASSES regardless of how much evidence comes in.
//   - RANKING IS BY VOLUME, NOT TIER - the owner's own live-caught case is why: "Avenrae... is not
//     an enchanter. you are using chaos flux as evidence but that is specifically an enchanter
//     skill that is on a weapon PROC that a ranger can have... you are seeing 1 evidence of
//     enchanter and ignoring the 3 cases of ranger. 3 > 1." A weapon proc fires the exact same
//     "begins casting" line as a deliberate cast, for WHOEVER wields it, regardless of their real
//     class - a single-class "confirmed" match is therefore not actually more trustworthy than a
//     shared-class "maybe" match; it is just a match on a spell that happens not to be shared. An
//     earlier version of this file gave every confirmed-tier class an unconditional slot ahead of
//     any maybe-tier one, which is exactly backwards when the confirmed one is a lone proc spell
//     and the maybe ones are corroborated by three separate real casts. Every class is now ranked
//     purely by how many DISTINCT spells named it, tier or no tier - "3 > 1" is the whole rule.
//     `confidence` is reported per surviving class only as a display hint (did at least one
//     single-class spell ever name it), never as a ranking tiebreaker on its own.
const MAX_MAYBE_CLASSES = 3;
const MAX_TOTAL_CLASSES = 3;

function estimateClasses(castSkillNames, classesForSpell) {
  const counts = new Map(); // class -> number of distinct spells that named it, any tier
  const confirmedBy = new Set(); // classes that had at least one single-class spell name them

  for (const name of castSkillNames || []) {
    if (!name) continue;
    const classes = classesForSpell(name);
    if (!classes || !classes.length) continue;
    if (classes.length === 1) {
      counts.set(classes[0], (counts.get(classes[0]) || 0) + 1);
      confirmedBy.add(classes[0]);
    } else if (classes.length <= MAX_MAYBE_CLASSES) {
      for (const c of classes) counts.set(c, (counts.get(c) || 0) + 1);
    }
  }

  const ranked = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => name)
    .slice(0, MAX_TOTAL_CLASSES);

  return ranked.map((name) => ({ name, confidence: confirmedBy.has(name) ? 'confirmed' : 'maybe' }));
}

module.exports = { estimateClasses, MAX_MAYBE_CLASSES, MAX_TOTAL_CLASSES };
