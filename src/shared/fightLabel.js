'use strict';

const { isArticlePrefixedMobName } = require('./petNames');

// "The fight breakdown for each zone should say what fight it is - if a named was fought it
// should list the named; if no named was found, it should just say Trash" (owner, 14 Sep).
//
// A trash mob's name is always article-prefixed ("a zol ghoul knight", "an ice bones") - see
// damageEngine.js's own header comment on why a NAMED mob's bare name ("Fright") reads exactly
// like a player's: nothing in the log distinguishes them, and that is the same tell this borrows.
// Several named targets in one fight (an add pull alongside the boss) are joined rather than
// picking one arbitrarily and silently dropping the rest.
function labelFight(enemyTargets) {
  const named = (enemyTargets || []).filter((n) => n && !isArticlePrefixedMobName(n));
  return named.length ? named.join(' & ') : 'Trash';
}

module.exports = { labelFight };
