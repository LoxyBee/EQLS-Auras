'use strict';
/**
 * The buff-stacking service (src/main/stackingService.js) - the full ported EQEmu engine bound to
 * the roster's per-spell stacking data. Replaced the old narrow spellStacking.checkOverwrite /
 * stackVerdict.
 *
 * Ground truth, confirmed from the owner's real EQ Legends logs + spell file (25 Aug 2026):
 *   - Five real "X did not take hold. (Blocked by Y.)" lines: Strength, Dexterity, Infusion of
 *     Spirit and Talisman of Altuna all blocked while Harnessing of Spirit was up; Armor of
 *     Protection blocked while Talisman of Altuna was up.
 *   - Nimble / Agility (shared fade text "Your agility fades.") and Symbol of Pinzarn / Symbol of
 *     Naltron are the shared-fade-text pairs the tile-removal exists to resolve.
 * Plus the 4 bard-song pairs the reference engine settles (eq-tracker-0f, 3 Sep), including the
 * Cantata / Chorus of Clarity winner-flip around level 32.
 *
 * These run against the REAL roster (src/shared/data/buffs.json, which now carries stackEffects),
 * so no fixture file - the roster IS the data the engine uses at runtime.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { makeStackingService } = require('../src/main/stackingService');
const { BuffStore } = require('../src/main/buffStore');

// A BuffStore over the real bundled roster (no userData writes).
const store = new BuffStore({ loadJson: (k, d) => d, saveJson: () => {} });
const svc = makeStackingService(store);
const ID = {
  harnessing: 2525, strength: 159, dexterity: 157, infusion: 3454, talismanAltuna: 168,
  armorOfProtection: 1445, nimble: 160, agility: 154, pinzarn: 487, naltron: 488,
  chantOfBattle: 700, anthem: 701, jonthans: 749, cantata: 1448, chantOfClarity: 1287, chorusOfClarity: 723,
};

// -1 cast blocked · 0 stack · 1 cast overwrites worn.
const v = (worn, cast, wl = 50, cl = 50) => svc.verdict(worn, cast, wl, cl);

test('the five real "did not take hold (Blocked by X)" pairs are all a conflict', () => {
  for (const [name, id] of [
    ['Strength', ID.strength], ['Dexterity', ID.dexterity],
    ['Infusion of Spirit', ID.infusion], ['Talisman of Altuna', ID.talismanAltuna],
  ]) {
    // cast `id` while Harnessing of Spirit is worn -> blocked (or Harnessing overwrites it)
    const fwd = v(ID.harnessing, id);
    assert.notEqual(fwd, 0, `${name} should conflict with Harnessing of Spirit, got ${fwd}`);
  }
  assert.notEqual(v(ID.talismanAltuna, ID.armorOfProtection), 0, 'Armor of Protection vs Talisman of Altuna conflicts');
});

test('Nimble / Agility: Agility (higher cap) wins the AGI slot', () => {
  assert.equal(v(ID.nimble, ID.agility), 1, 'Agility cast over Nimble overwrites');
  assert.equal(v(ID.agility, ID.nimble), -1, 'Nimble cast over Agility is blocked');
});

test('Symbol of Pinzarn / Symbol of Naltron conflict directionally', () => {
  const a = v(ID.pinzarn, ID.naltron);
  const b = v(ID.naltron, ID.pinzarn);
  assert.notEqual(a, 0);
  assert.notEqual(b, 0);
  assert.notEqual(a, b, 'the two directions disagree on who wins - i.e. one is stronger');
});

test('bard pairs A/B: Chant of Battle vs the haste songs, level-stable', () => {
  assert.equal(v(ID.chantOfBattle, ID.anthem), 1, 'Anthem de Arms overwrites Chant of Battle');
  assert.equal(v(ID.anthem, ID.chantOfBattle), -1);
  assert.equal(v(ID.chantOfBattle, ID.jonthans), -1, "Jonthan's Provocation blocked by Chant of Battle");
  assert.equal(v(ID.jonthans, ID.chantOfBattle), 1);
});

test('bard pair C: Cantata of Soothing vs Cassindra\'s Chant of Clarity (Cantata always wins)', () => {
  assert.equal(v(ID.cantata, ID.chantOfClarity), -1);
  assert.equal(v(ID.chantOfClarity, ID.cantata), 1);
});

test('bard pair D: Cantata vs Chorus of Clarity - the winner FLIPS around level 32', () => {
  assert.equal(v(ID.cantata, ID.chorusOfClarity, 25, 25), -1, 'sub-32: Chorus is weaker, blocked');
  assert.equal(v(ID.cantata, ID.chorusOfClarity, 50, 50), 1, 'L50: Chorus is stronger, overwrites');
  assert.equal(v(ID.chorusOfClarity, ID.cantata, 25, 25), 1);
  assert.equal(v(ID.chorusOfClarity, ID.cantata, 50, 50), -1);
});

test('planConflict reports both directions; a genuinely-unrelated pair is null-safe', () => {
  const c = svc.planConflict(ID.nimble, ID.agility, 50);
  assert.equal(c.conflict, true);
  // a spell with no stacking data -> null, never a throw
  assert.equal(svc.verdict(999999, ID.strength), null);
  assert.equal(svc.planConflict(999999, ID.strength, 50), null);
});

test('wouldOverwriteLive only fires on a clean one-way overwrite', () => {
  // Anthem cleanly overwrites Chant of Battle (fwd 1, rev -1) -> true
  assert.equal(svc.wouldOverwriteLive(ID.chantOfBattle, ID.anthem), true);
  // the reverse is a block, not an overwrite -> false
  assert.equal(svc.wouldOverwriteLive(ID.anthem, ID.chantOfBattle), false);
  // unrelated -> false
  assert.equal(svc.wouldOverwriteLive(ID.strength, ID.dexterity), false);
});

module.exports = () => report('spell-stacking');
if (require.main === module) report('spell-stacking').then((n) => process.exit(n ? 1 : 0));
