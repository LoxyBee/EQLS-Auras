'use strict';

// Telling a pet apart from a player by name alone, for the damage meter's Pets / Other buckets.
//
// TWO signals, deliberately different strengths:
//
//   1. A POSSESSIVE name - "Chrysaetos`s pet", "Pacis`s warder", "Aradia`s familiar". The game
//      writes an owner's name, an apostrophe-s (the EQL client emits a backtick), and a pet word.
//      Unambiguous: nothing but a pet is named this way. Roster-independent.
//
//   2. A GENERATED pet name - "Gaser", "Vebekn", "Jartik", "Kobektik". EQ builds a summoned pet's
//      name from a fixed syllable pool (EQEmu's GetRandPetName; the owner confirmed EQ Legends uses
//      the stock algorithm). The invariants hold across every version: it starts with one of
//      G J K L V X Z, ends in er / ab / n / tik, and is one short word. This has a real (medium-low)
//      collision rate with actual names - Xander, Kaan, Jager - so it is CORROBORATION ONLY:
//      never sole grounds to reclassify a name the group roster already vouches for.

const POSSESSIVE_PET = /^(.+?)[`'’]s (pet|warder|familiar|companion|ward)$/i;

// An article-prefixed name - "a Teir`Dal rogue", "an ancient sarnak", "the Priest of Discord". EQ
// writes a generic monster this way and never a player (a player name is one capitalised word, no
// spaces, no leading article - see buffEngine gotcha #20). So a name of this shape that the damage
// engine has already classified as a FRIENDLY attacker is a charmed / wild-charmed monster
// fighting on your side - a pet nobody has claimed - not a group member. Unambiguous and
// roster-independent, the same strength as the possessive signal.
const ARTICLE_MOB = /^(?:a|an|the)\s+\S/i;

// Start G/J/K/L/V/X/Z, then a short lowercase body, an optional middle syllable, a fixed ending.
// 3-9 chars total, one word, no digits. Deliberately loose on the middle - the exact tables vary
// by EQEmu era and this is a corroborating signal, not a gate.
const GENERATED_PET = /^[GJKLVXZ][a-z]{1,6}(?:er|ab|n|tik)$/;

function isPossessivePetName(name) {
  return POSSESSIVE_PET.test(String(name || '').trim());
}

// See ARTICLE_MOB above. Excludes a possessive name that happens to start with "a"/"an"/"the".
function isArticlePrefixedMobName(name) {
  const n = String(name || '').trim();
  return ARTICLE_MOB.test(n) && !POSSESSIVE_PET.test(n);
}

// The owner's name from a possessive pet name ("Chrysaetos`s pet" -> "Chrysaetos"), or null.
function petOwnerFromName(name) {
  const m = POSSESSIVE_PET.exec(String(name || '').trim());
  return m ? m[1].trim() : null;
}

// A bare word that fits EQ's summoned-pet naming shape. Corroboration only - see the header.
function looksLikeGeneratedPetName(name) {
  const n = String(name || '').trim();
  return n.length >= 3 && n.length <= 9 && GENERATED_PET.test(n);
}

module.exports = { isPossessivePetName, petOwnerFromName, looksLikeGeneratedPetName, isArticlePrefixedMobName };
