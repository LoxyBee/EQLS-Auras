'use strict';
/**
 * Telling a pet from a player by name (src/shared/petNames.js), for the damage meter's Pets /
 * Other buckets. Owner, 2 Sep: a mage pet ("Kobektik") was showing as its own attacker row.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { isPossessivePetName, petOwnerFromName, looksLikeGeneratedPetName } = require('../src/shared/petNames');

test('a possessive name is a pet, and the owner comes out', () => {
  assert.equal(isPossessivePetName('Chrysaetos`s pet'), true);
  assert.equal(petOwnerFromName('Chrysaetos`s pet'), 'Chrysaetos');
  assert.equal(isPossessivePetName("Pacis`s warder"), true);
  assert.equal(isPossessivePetName('Aradia`s familiar'), true);
  assert.equal(petOwnerFromName('Aradia`s familiar'), 'Aradia');
  // a straight apostrophe works too (some clients)
  assert.equal(isPossessivePetName("Rebazi's pet"), true);
});

test('an ordinary name is not a possessive pet', () => {
  assert.equal(isPossessivePetName('Avenrae'), false);
  assert.equal(isPossessivePetName('Shubthulu tells the guild'), false);
  assert.equal(petOwnerFromName('Avenrae'), null);
});

test('the generated-pet name shape: starts G/J/K/L/V/X/Z, ends er/ab/n/tik, one short word', () => {
  for (const n of ['Kobektik', 'Gaser', 'Vebekn', 'Jartik', 'Konab', 'Xiber', 'Zabtik']) {
    assert.equal(looksLikeGeneratedPetName(n), true, `${n} should look like a summoned pet`);
  }
  for (const n of ['Avenrae', 'Shubthulu', 'Chrysaetos', 'You', 'Bob', 'Aragorn']) {
    assert.equal(looksLikeGeneratedPetName(n), false, `${n} should not`);
  }
});

test('the generated shape has known collisions - it is corroboration only, never sole grounds', () => {
  // Real names that fit the shape. The damage engine only trusts this for a name the group roster
  // does NOT already vouch for.
  assert.equal(looksLikeGeneratedPetName('Xander'), true);
  assert.equal(looksLikeGeneratedPetName('Kaan'), true);
});

test('junk never throws', () => {
  for (const bad of [null, undefined, 42, '', {}, []]) {
    assert.doesNotThrow(() => isPossessivePetName(bad));
    assert.doesNotThrow(() => looksLikeGeneratedPetName(bad));
    assert.doesNotThrow(() => petOwnerFromName(bad));
  }
});

module.exports = () => report('pet-names');
if (require.main === module) report('pet-names').then((n) => process.exit(n ? 1 : 0));
