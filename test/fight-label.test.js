'use strict';
/**
 * "The fight breakdown for each zone should say what fight it is - if a named was fought it
 * should list the named, if no named was found it should just say Trash" (owner, 14 Sep).
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { labelFight } = require('../src/shared/fightLabel');

test('a fight with only article-prefixed trash targets is labelled Trash', () => {
  assert.equal(labelFight(['a zol ghoul knight', 'an ice bones']), 'Trash');
});

test('a fight against a bare-named target lists that name', () => {
  assert.equal(labelFight(['a zol ghoul knight', 'Fright']), 'Fright');
});

test('a fight with more than one named target (an add pull) joins them, dropping none', () => {
  assert.equal(labelFight(['Fright', 'Djarn']), 'Fright & Djarn');
});

test('no enemy targets at all is Trash, not a crash', () => {
  assert.equal(labelFight([]), 'Trash');
  assert.equal(labelFight(null), 'Trash');
  assert.equal(labelFight(undefined), 'Trash');
});

// Owner, 14 Sep: "the 'named' here are actually just trash mobs, not named" - "Amygdalan warrior"
// and "Amygdalan knight" (The Plane of Fear) are a race+role trash naming, the same shape as
// article-prefixed trash ("a Teir`Dal rogue") but missing the article this zone's mob type
// happens to omit. Confirmed against the owner's own curated named list for this exact zone -
// "Phoboplasm" is a real mini-boss there, "Amygdalan warrior"/"knight" are not listed at all.
test('a capitalised "Race role" trash name is not mistaken for a real named mob', () => {
  assert.equal(labelFight(['Amygdalan warrior']), 'Trash');
  assert.equal(labelFight(['Amygdalan knight']), 'Trash');
});

test('a real named mob mixed with race+role trash still lists only the real one', () => {
  assert.equal(labelFight(['Amygdalan warrior', 'Amygdalan knight', 'Phoboplasm']), 'Phoboplasm');
});

// The fix must not regress the multi-word REAL named mobs already confirmed working - every
// significant word capitalised, or joined by a short grammatical connector, never a bare
// lowercase common noun as the last word.
test('a real multi-word named mob (every word capitalised, or a short connector) still counts', () => {
  assert.equal(labelFight(['Efreeti Lord Djarn']), 'Efreeti Lord Djarn');
  assert.equal(labelFight(['Stonesoul the Unmoving']), 'Stonesoul the Unmoving');
});

module.exports = () => report('fight-label');
if (require.main === module) report('fight-label').then((n) => process.exit(n ? 1 : 0));
