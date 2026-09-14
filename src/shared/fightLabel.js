'use strict';

const { isArticlePrefixedMobName, looksLikePet } = require('./petNames');


// "The fight breakdown for each zone should say what fight it is - if a named was fought it
// should list the named; if no named was found, it should just say Trash" (owner, 14 Sep).
//
// A trash mob's name is USUALLY article-prefixed ("a zol ghoul knight", "an ice bones"), and a
// named/unique mob's bare name ("Fright", "Stonesoul the Unmoving") reads exactly like a player's
// - see damageEngine.js's own header comment. Three things can still fool that alone, all reported
// live 14 Sep:
//   - Some generic trash (certain summoned/temporary mob types - "bejeweled elemental") carries NO
//     article either. The one thing that still tells them apart is capitalisation: a real named
//     mob is always a proper noun (capitalised); ordinary trash stays lowercase whether or not it
//     happens to have an article. damageEngine.js excludes damage-SHIELD hits from ever reaching
//     here (their target sits in the SENTENCE-INITIAL position - "A zol ghoul knight is pierced by
//     Baxa's thorns" - so its capitalisation is just grammar, not a real tell); everything that
//     does reach here is from the OBJECT position ("You crush X"), where case is reliable.
//   - A wild/charmed PET's generic type name ("giant wooly spider pet") is not a named mob any
//     more than "a zol ghoul knight" is - excluded outright via looksLikePet, on top of the
//     capitalisation check (belt and suspenders: a pet description occasionally does slip past a
//     grammar quirk with a capital letter, as the shield case above demonstrated once already).
//   - The SAME target can still reach here both properly-cased and not, across different lines in
//     one fight ("giant wooly spider pet" and, before the shield exclusion above, "Giant wooly
//     spider pet") - joined case-INsensitively so a fight is never labelled with what is really
//     one target listed twice under two spellings.
// Several DIFFERENT named targets in one fight (an add pull alongside the boss) are still all
// joined, rather than picking one arbitrarily and silently dropping the rest.
function looksLikeNamedMob(name) {
  return /^[A-Z]/.test(name) && !isArticlePrefixedMobName(name) && !looksLikePet(name);
}

function labelFight(enemyTargets) {
  const named = [];
  const seen = new Set();
  for (const n of enemyTargets || []) {
    if (!n || !looksLikeNamedMob(n)) continue;
    const key = n.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    named.push(n);
  }
  return named.length ? named.join(' & ') : 'Trash';
}

module.exports = { labelFight };
