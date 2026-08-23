'use strict';
/**
 * Notes 11 and 17 - how long a buff actually lasts.
 *
 * Three things multiply: the roster's base duration, the mote tier (the Roman numeral outside the
 * name field), and the AA/Exaltation bonus. Every number asserted here was measured from the
 * owner's own logs rather than taken from the spreadsheet, because two of the spreadsheet's rates
 * were marked unverified and one thing the code already did was measurably wrong.
 *
 * The measurements have a known bias worth stating: the wear-off line lags true expiry by up to
 * one six-second tick, so a measured duration sits AT or slightly ABOVE the truth and never below.
 * That is why the assertions below lean on lower bounds where the exact value is in question - a
 * prediction that undershoots every observation is refuted, and one that all observations clear is
 * supported.
 *
 * The engine is the real one. Nothing here reimplements the arithmetic in order to check it.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');

function makeEngine(aaMultiplier = 1) {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const engine = new BuffEngine(new BuffStore(store), store);
  engine.stop();
  engine.setDurationMultiplierFn(() => aaMultiplier);
  return engine;
}

// The roster entry as _scaledDuration receives it. Only the four fields it reads.
const spell = (name, durationSec, scaleCategory, extra = {}) => ({
  name,
  durationSec,
  scaleCategory,
  ...extra,
});

// Puts the engine in the state a landing arrives in: a cast of this exact ranked name has just
// been confirmed. That is where _rankForEntry reads the numeral from.
function afterCasting(engine, castName) {
  engine.recentSelfCast = { name: castName, expiresAt: Date.now() + 60000 };
  return engine;
}

// ---------------------------------------------------------------------------
// The mote tier
// ---------------------------------------------------------------------------

// Base 60, tier 7, AA band 1.65. Linear predicts 60 x 1.70 x 1.65 = 168.3; the measured mode
// across 24 castings is 167, and the whole distribution runs 163-177.
test('a tier VII buff scales linearly, matching the measured 167s', () => {
  const e = afterCasting(makeEngine(1.65), 'Spirit of the Puma VII');
  const d = e._scaledDuration(spell('Spirit of the Puma', 60, 'buff'));
  assert.equal(d, 168);
  assert.ok(Math.abs(d - 167) <= 2, `predicted ${d}s against a measured mode of 167s`);
});

// The alternative reading of the same sheet, and the reason it is not the one implemented.
// Compounding predicts 60 x 1.1^7 x 1.65 = 192.9s. Twenty-three of the twenty-four observations
// fall below that, and since measurement error only ever runs long, they cannot be explained away.
test('compounding is refuted, not merely unused', () => {
  const e = afterCasting(makeEngine(1.65), 'Spirit of the Puma VII');
  const d = e._scaledDuration(spell('Spirit of the Puma', 60, 'buff'));
  assert.ok(d < 180, `${d}s would be the compounding answer, which the observations rule out`);
});

// Base 24, tier 4, AA 1.65. The sheet marked heal-over-time's duration rate "+5% ?" - a guess.
// +5% predicts 47.5s and every one of 32 observations is 48 or more. +10% predicts 55.4s and 28
// of the 32 fall short of it, which they could not do if it were true.
test('heal over time uses +5% per tier, which the logs confirm and +10% fails', () => {
  const e = afterCasting(makeEngine(1.65), 'Celestial Healing IV');
  const d = e._scaledDuration(spell('Celestial Healing', 24, 'hot'));
  assert.equal(d, 48);
  assert.ok(d < 55, 'a +10% rate would predict 55s, which 28 of 32 observations fall short of');
});

test('an unranked cast of the same spell gets no tier bonus', () => {
  const e = afterCasting(makeEngine(1.65), 'Spirit of the Puma');
  assert.equal(e._scaledDuration(spell('Spirit of the Puma', 60, 'buff')), 99); // 60 x 1 x 1.65
});

// The rank comes from the cast that is landing. A stale cast of something else must not lend it.
test('a tier from a different spell is never borrowed', () => {
  const e = afterCasting(makeEngine(1), 'Cannibalize VII');
  assert.equal(e._scaledDuration(spell('Spirit of the Puma', 60, 'buff')), 60);
});

// Somebody else's rank is in the log, but which of their casts caused which landing is not
// established - so an unscaled number is preferred to a confidently wrong one.
test("a groupmate's buff is not given a tier the app cannot attribute", () => {
  const e = makeEngine(1); // nothing cast by us at all
  assert.equal(e._scaledDuration(spell('Spirit of the Puma', 60, 'buff')), 60);
});

test('the pending cast counts as well as the confirmed one', () => {
  const e = makeEngine(1);
  e.pendingCast = { name: 'Spirit of the Puma VII', timer: null, landingText: null };
  assert.equal(e._scaledDuration(spell('Spirit of the Puma', 60, 'buff')), 102); // 60 x 1.7
});

// ---------------------------------------------------------------------------
// The AA gate - the part that was wrong before this
// ---------------------------------------------------------------------------

// THE BUG. Curse is a dot with base 30. On 9 and 10 August her buffs measured x1.53, and across 31
// castings in those same sessions Curse measured 31-36 seconds. The multiplier would make it 45.
// Before this gate existed, 155 roster entries would have started over-timing by up to 65% the
// moment she set her AA level in the app.
test('the AA bonus does not extend a damage-over-time spell', () => {
  const e = makeEngine(1.53);
  assert.equal(e._scaledDuration(spell('Curse', 30, 'dot')), 30);
});

test('nor a debuff, nor a charm', () => {
  const e = makeEngine(1.65);
  assert.equal(e._scaledDuration(spell('Togor’s Insects', 210, 'debuff')), 210);
  assert.equal(e._scaledDuration(spell('Mesmerize', 24, 'charm')), 24);
});

test('but it does extend a buff, a heal over time and a pet', () => {
  const e = makeEngine(1.5);
  assert.equal(e._scaledDuration(spell('Valor', 3240, 'buff')), 4860);
  assert.equal(e._scaledDuration(spell('Celestial Healing', 24, 'hot')), 36);
  assert.equal(e._scaledDuration(spell('Warder', 100, 'pet')), 150);
});

// A whitelist, not a blacklist - so an unrecognised category is under-timed rather than left
// running after the thing it is timing has gone.
test('an unknown category gets no AA bonus rather than the benefit of the doubt', () => {
  const e = makeEngine(1.65);
  assert.equal(e._scaledDuration(spell('Something New', 100, 'somethingelse')), 100);
  assert.equal(e._scaledDuration(spell('No Category', 100, undefined)), 100);
});

// A detrimental still takes its mote tier - it is only the AA bonus that is beneficial-only.
test('a debuff still scales with its tier, just not with AA', () => {
  const e = afterCasting(makeEngine(1.65), 'Togor’s Insects V');
  assert.equal(e._scaledDuration(spell('Togor’s Insects', 210, 'debuff')), 315); // 210 x 1.5
});

// ---------------------------------------------------------------------------
// Spells that scale with nothing
// ---------------------------------------------------------------------------

// Measured across 225 castings at ranks 0, V, VII and IX: the median is 15 seconds at every one of
// them, including rank-0 casts made on a day when buffs were running x1.53. Neither factor touches
// it, which is what noDurationScaling has always claimed and is now checked.
test('a spell flagged as unscaling ignores both the tier and the AA bonus', () => {
  const e = afterCasting(makeEngine(1.65), 'Promised Renewal IX');
  assert.equal(e._scaledDuration(spell('Promised Renewal', 15, 'none', { noDurationScaling: true })), 15);
});

// The test above does not actually exercise the flag, and mutation testing is what showed that:
// Promised Renewal's category scales with nothing anyway, so removing the guard entirely left it
// passing. This one uses a SYNTHETIC entry - a buff-category spell carrying the flag - because
// today's roster has exactly one flagged entry and it is not in a scaling category.
//
// That makes the guard currently redundant in practice, and it is kept and pinned rather than
// deleted as dead code: the flag means "this spell's duration does not scale", and the day someone
// sets it on a buff is the day it has to override both factors rather than neither.
test('the unscaling flag beats both factors, not just the ones that happen to be zero', () => {
  const e = afterCasting(makeEngine(1.65), 'Fixed Thing VII');
  const flagged = spell('Fixed Thing', 100, 'buff', { noDurationScaling: true });
  assert.equal(e._scaledDuration(flagged), 100);
  // Without the flag the same entry would take both, which is what makes the assertion above mean
  // something rather than describe a spell nothing applies to.
  assert.equal(e._scaledDuration(spell('Fixed Thing', 100, 'buff')), 281); // 100 x 1.7 x 1.65
});

test('nuke, heal and pet-summon durations do not scale with tier', () => {
  const e = afterCasting(makeEngine(1), 'Envenomed Bolt IV');
  assert.equal(e._scaledDuration(spell('Envenomed Bolt', 10, 'nuke')), 10);
});

// ---------------------------------------------------------------------------
// Arithmetic
// ---------------------------------------------------------------------------

// Rounding once over the combined multiplier, not after each step. 7 x 1.05 = 7.35 rounds to 7;
// rounding there first and then applying 1.5 gives 11 rather than the correct 11.
test('rounding happens once, over both multipliers together', () => {
  const e = afterCasting(makeEngine(1.5), 'Trickle IV');
  // 7 x (1 + 0.05 x 4) x 1.5 = 12.6 -> 13. Two roundings would give round(round(8.4) x 1.5) = 12.
  assert.equal(e._scaledDuration(spell('Trickle', 7, 'hot')), 13);
});

test('a tier X cast is handled, since one appears in the logs', () => {
  const e = afterCasting(makeEngine(1), 'Frenzied Spirit X');
  assert.equal(e._scaledDuration(spell('Frenzied Spirit', 100, 'buff')), 200); // 100 x (1 + 0.1 x 10)
});

module.exports = () => report('duration-scaling');
if (require.main === module) process.exit(report('duration-scaling') ? 1 : 0);
