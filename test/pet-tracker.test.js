'use strict';
/**
 * petTracker.js - the player's own charmed pets and everyone else's.
 *
 * A charm landing line names no caster; the tell that a pet is YOURS is that you cast a charm
 * spell a moment before. Two same-named pets must stay distinct (`name#gen`).
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { PetTracker, ARM_WINDOW_MS, STALE_MS } = require('../src/main/petTracker');

const T = '[Wed Aug 19 21:14:02 2026] ';

test('a charm cast then a charm landing inside the window makes it your pet', () => {
  const p = new PetTracker();
  p.handleLine(`${T}You begin casting Beguile.`, 1000);
  p.handleLine(`${T}a spite golem has been charmed.`, 3000);
  const snap = p.snapshot();
  assert.equal(snap.ownPetKeyByName.get('a spite golem'), 'a spite golem#1');
  assert.equal(snap.unknownPetNames.size, 0);
});

test('a charm landing with no preceding cast is an unknown-owner pet', () => {
  const p = new PetTracker();
  p.handleLine(`${T}a spite golem has been charmed.`, 3000);
  const snap = p.snapshot();
  assert.equal(snap.ownPetKeyByName.size, 0);
  assert.ok(snap.unknownPetNames.has('a spite golem'));
});

test('a charm landing long after the cast is NOT yours', () => {
  const p = new PetTracker();
  p.handleLine(`${T}You begin casting Beguile.`, 1000);
  p.handleLine(`${T}a spite golem has been charmed.`, 1000 + ARM_WINDOW_MS + 1);
  assert.equal(p.snapshot().ownPetKeyByName.size, 0);
});

test('two same-named pets charmed in turn get different generations', () => {
  const p = new PetTracker();
  p.handleLine(`${T}You begin casting Beguile.`, 1000);
  p.handleLine(`${T}a spite golem has been charmed.`, 2000);
  p.handleLine(`${T}a spite golem has been slain by Baxa!`, 5000);
  p.handleLine(`${T}You begin casting Beguile.`, 6000);
  p.handleLine(`${T}a spite golem has been charmed.`, 7000);
  assert.equal(p.snapshot().ownPetKeyByName.get('a spite golem'), 'a spite golem#2');
});

test('the charm breaking retires the pet', () => {
  const p = new PetTracker();
  p.handleLine(`${T}You begin casting Beguile.`, 1000);
  p.handleLine(`${T}a spite golem has been charmed.`, 2000);
  p.handleLine(`${T}Your Beguile spell has worn off of a spite golem.`, 9000);
  assert.equal(p.snapshot().ownPetKeyByName.size, 0);
});

test('a "My leader is" line naming another player marks the pet as an ally pet, not unknown', () => {
  const p = new PetTracker();
  p.handleLine(`${T}a spite golem has been charmed.`, 2000);
  p.handleLine(`${T}a spite golem says, 'My leader is Vaela.'`, 2500);
  const snap = p.snapshot();
  assert.equal(snap.unknownPetNames.size, 0);
  assert.equal(snap.allyPetLeader.get('a spite golem'), 'vaela');
});

test('a "My leader is <me>" line makes it your pet', () => {
  const p = new PetTracker();
  p.setOwnNameFn(() => 'Zzz');
  p.handleLine(`${T}a spite golem has been charmed.`, 2000);
  p.handleLine(`${T}a spite golem says, 'My leader is Zzz.'`, 2500);
  assert.equal(p.snapshot().ownPetKeyByName.get('a spite golem'), 'a spite golem#1');
});

test('an own charm-spell check can come from the roster', () => {
  const p = new PetTracker();
  p.setCharmSpellCheck((name) => name === 'Ancient Wound'); // pretend this is a charm
  p.handleLine(`${T}You begin casting Ancient Wound.`, 1000);
  p.handleLine(`${T}a spite golem has been charmed.`, 2000);
  assert.equal(p.snapshot().ownPetKeyByName.size, 1);
});

test('a stale pet is dropped on tick', () => {
  const p = new PetTracker();
  p.handleLine(`${T}You begin casting Beguile.`, 1000);
  p.handleLine(`${T}a spite golem has been charmed.`, 2000);
  p.tick(2000 + STALE_MS + 1);
  assert.equal(p.snapshot().ownPetKeyByName.size, 0);
});

// charmSeen - the damage meter reads this to decide whether an unattributable article-prefixed
// "friendly attacker" is a wild charm (show it as "Charmed pets") or bootstrap pollution (drop it).
test('charmSeen is false with no charm activity at all', () => {
  const p = new PetTracker();
  p.handleLine(`${T}You begin casting Minor Healing.`, 1000);
  p.handleLine(`${T}a greater kobold hits YOU for 10 points of damage.`, 2000);
  assert.equal(p.snapshot(3000).charmSeen, false);
});

test('charmSeen is true right after a charm cast, even before any pet lands', () => {
  const p = new PetTracker();
  p.handleLine(`${T}You begin casting Beguile.`, 1000);
  assert.equal(p.snapshot(2000).charmSeen, true);
});

test('charmSeen is true while an ally pet is tracked, and after a bare charm landing', () => {
  const p = new PetTracker();
  p.handleLine(`${T}a spite golem has been charmed.`, 1000); // no preceding cast -> unknown-owner
  assert.equal(p.snapshot(2000).charmSeen, true);
});

test('charmSeen decays STALE_MS after the last charm activity, once no pet is tracked', () => {
  const p = new PetTracker();
  p.handleLine(`${T}You begin casting Beguile.`, 1000);
  p.handleLine(`${T}a spite golem has been charmed.`, 2000); // last charm activity: t=2000
  p.handleLine(`${T}a spite golem has been slain by Bob!`, 3000); // pet gone
  assert.equal(p.snapshot(2000 + STALE_MS - 1).charmSeen, true, 'still within the window');
  assert.equal(p.snapshot(2000 + STALE_MS + 1).charmSeen, false, 'decayed');
});

module.exports = () => report('pet-tracker');
if (require.main === module) report('pet-tracker').then((n) => process.exit(n ? 1 : 0));
