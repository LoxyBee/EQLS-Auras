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

// ---------------------------------------------------------------------------
// Session restore — surviving a restart without forgetting a live charmed pet
// ---------------------------------------------------------------------------
//
// Unlike the group roster or the current zone, nothing re-derives charmed pets from log history at
// startup - a restart mid-fight used to forget which mobs were own/ally pets until a fresh
// charm/leader line happened to refresh them, silently misbucketing a still-alive own pet into
// "Other" on the damage meter in the meantime. captureState()/restoreState() use real wall-clock
// timestamps (matching how handleLine is actually driven in production), not the synthetic small
// offsets the tests above use for readability.

test('captureState is null with nothing tracked at all', () => {
  const p = new PetTracker();
  assert.equal(p.captureState(), null);
});

test('a restored own pet renders exactly as it did before capture', () => {
  const p = new PetTracker();
  const now = Date.now();
  p.handleLine(`${T}You begin casting Beguile.`, now);
  p.handleLine(`${T}a spite golem has been charmed.`, now + 500);
  const snap = p.captureState();
  assert.ok(snap && snap.ownPets.length === 1);

  const fresh = new PetTracker();
  const n = fresh.restoreState(snap);
  assert.equal(n, 1, 'restored exactly one live entry');
  assert.deepEqual(fresh.snapshot(now + 600), p.snapshot(now + 600));
});

test('a pet older than STALE_MS is not restored - a wrong "still charmed" is worse than an empty list', () => {
  const p = new PetTracker();
  const longAgo = Date.now() - STALE_MS - 1000;
  p.handleLine(`${T}You begin casting Beguile.`, longAgo);
  p.handleLine(`${T}a spite golem has been charmed.`, longAgo + 500);
  const snap = p.captureState();

  const fresh = new PetTracker();
  const n = fresh.restoreState(snap);
  assert.equal(n, 0, 'nothing restored - it is stale');
  assert.equal(fresh.snapshot().ownPetKeyByName.size, 0);
});

test('an ally (unowned) pet survives the same round trip as an own one', () => {
  const p = new PetTracker();
  const now = Date.now();
  p.handleLine(`${T}a spite golem has been charmed.`, now); // no preceding cast -> unknown-owner
  p.handleLine(`${T}a spite golem says, 'My leader is Vaela.'`, now + 500);
  const snap = p.captureState();

  const fresh = new PetTracker();
  fresh.restoreState(snap);
  assert.equal(fresh.snapshot().allyPetLeader.get('a spite golem'), 'vaela');
});

test('restoring the generation counter takes the higher value, never a downgrade', () => {
  const p = new PetTracker();
  const now = Date.now();
  // Charm and retire "a spite golem" 3 times, so its counter sits at 3 with nothing currently live.
  for (let i = 0; i < 3; i++) {
    p.handleLine(`${T}You begin casting Beguile.`, now + i * 100);
    p.handleLine(`${T}a spite golem has been charmed.`, now + i * 100 + 10);
    p.handleLine(`${T}a spite golem has been slain by Bob!`, now + i * 100 + 20);
  }
  const snap = p.captureState();
  assert.deepEqual(snap.genByName, [['a spite golem', 3]]);

  const fresh = new PetTracker();
  fresh.restoreState(snap);
  // A fresh charm right after restart must get generation 4, not collide back down to 1.
  fresh.handleLine(`${T}You begin casting Beguile.`, now + 1000);
  fresh.handleLine(`${T}a spite golem has been charmed.`, now + 1010);
  assert.equal(fresh.snapshot().ownPetKeyByName.get('a spite golem'), 'a spite golem#4');
});

test('an armedUntil in the past is not restored - a stale charm arm-window must not fire late', () => {
  const p = new PetTracker();
  p.restoreState({ ownPets: [], otherPets: [], genByName: [], armedUntil: Date.now() - 1, lastCharmSeenAt: 0 });
  assert.equal(p._armedUntil, 0);
});

module.exports = () => report('pet-tracker');
if (require.main === module) report('pet-tracker').then((n) => process.exit(n ? 1 : 0));
