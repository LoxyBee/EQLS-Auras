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
//     `castsByAttacker` (session-wide - a class is a fact about the person, not one pull; the owner
//     confirmed loadout swaps happen BETWEEN zone instances, not mid-instance, so evidence within
//     one continuous session is expected to describe one stable set of 3 classes).
//   - A skill castable by exactly one class is a real (if not certain - a weapon proc can fire it
//     for anyone wielding that weapon, see below) signal; a skill shared by a small number of
//     classes narrows things down a little. A skill shared by more classes than MAX_MAYBE_CLASSES
//     says nothing useful and is ignored outright.
//   - A multiclass character has EXACTLY 3 classes, never more - the result is capped at
//     MAX_TOTAL_CLASSES regardless of how much evidence comes in.
//   - RANKING IS BY VOLUME, NOT TIER - "avenrae... is not an enchanter. you are using chaos flux
//     as evidence but that is specifically an enchanter skill that is on a weapon PROC that a
//     ranger can have... you are seeing 1 evidence of enchanter and ignoring the 3 cases of
//     ranger. 3 > 1." A weapon proc fires the exact same cast line for WHOEVER wields it,
//     regardless of their real class, so a lone single-class match is not inherently more
//     trustworthy than several shared-class matches. Every class is ranked by how many DISTINCT
//     spells named it, tier or no tier; `confidence` is a display hint only, never a tiebreaker.
//   - AMBIGUOUS EVIDENCE IS EXPLAINED AWAY BY AN ALREADY-CONFIRMED CLASS, NOT SPREAD TO BYSTANDERS
//     - live-verified against the owner's own real log (Avenrae, The Plane of Fear, 12 Sep): she
//     has 6 spells that are Ranger-exclusive and 5 that are Wizard-exclusive, real and correct -
//     but also 4 spells shared between Ranger and Druid (Spikecoat, Wolf Form, Shield of Brambles,
//     Bramblecoat) plus one genuinely Druid-only spell (Circle of Feerrott). Counting every shared
//     spell toward EVERY one of its candidates let those 4 Ranger/Druid spells inflate "Druid" to
//     nearly Ranger's own total, crowding Wizard out of the top 3 - even though Ranger was already
//     independently PROVEN six times over, so those 4 spells needed no help from Druid to be
//     explained; Druid had exactly one real spell to its name. A shared spell now credits a class
//     it's ambiguous between ONLY when NONE of its candidates are already confirmed elsewhere - if
//     one is, the spell is fully accounted for and contributes nothing further. This directly
//     turned "SHD/Rng/Dru" into the owner's own verified-correct "Wiz/SHD/Rng" against the real
//     data, with no change to the "3 > 1" case above (Enchanter/Ranger has no confirmed overlap to
//     explain anything away with, so nothing there changes).
const MAX_MAYBE_CLASSES = 3;
const MAX_TOTAL_CLASSES = 3;

function estimateClasses(castSkillNames, classesForSpell) {
  const names = castSkillNames || [];
  const counts = new Map(); // class -> number of distinct spells that named it
  const confirmedBy = new Set(); // classes named by at least one single-class spell

  // Pass 1: single-class spells only - these are what "confirmed" means, and must all be known
  // before pass 2 can tell whether an ambiguous spell is already explained by one of them.
  for (const name of names) {
    if (!name) continue;
    const classes = classesForSpell(name);
    if (classes && classes.length === 1) {
      confirmedBy.add(classes[0]);
      counts.set(classes[0], (counts.get(classes[0]) || 0) + 1);
    }
  }

  // Pass 2: multi-class ("maybe") spells. Fully explained (contributes nothing further) the
  // moment any one of its candidates is already confirmed - only a spell whose every candidate is
  // still an open question actually narrows anything down.
  for (const name of names) {
    if (!name) continue;
    const classes = classesForSpell(name);
    if (!classes || classes.length < 2 || classes.length > MAX_MAYBE_CLASSES) continue;
    if (classes.some((c) => confirmedBy.has(c))) continue;
    for (const c of classes) counts.set(c, (counts.get(c) || 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_TOTAL_CLASSES)
    .map(([name]) => ({ name, confidence: confirmedBy.has(name) ? 'confirmed' : 'maybe' }));
}

module.exports = { estimateClasses, MAX_MAYBE_CLASSES, MAX_TOTAL_CLASSES };
