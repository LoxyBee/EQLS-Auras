'use strict';
/**
 * The P0 rework's toggle: setUseEvidenceModel(). See buffEngine.js's constructor comment on
 * useEvidenceModel for the full reasoning. This file pins exactly the one behaviour the toggle is
 * allowed to change, and confirms the hard veto (neverScribed) is untouched by it either way.
 *
 * Driven through the real engine and the real roster (via BuffStore), same convention as
 * detection.test.js - these are behavioural tests against production data, not a mock roster.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');

function makeEngine() {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const buffStore = new BuffStore(store);
  const engine = new BuffEngine(buffStore, store);
  engine.stop();
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  return { engine, buffStore, log };
}

const names = (engine) => engine.getActiveBuffs().map((b) => b.name).sort();

test('off by default', () => {
  const { engine } = makeEngine();
  assert.equal(engine.useEvidenceModel, false);
});

test('legacy behaviour (toggle off): a memorizable-but-not-currently-memorized unique buff is IGNORED, unchanged', () => {
  const { engine, buffStore, log } = makeEngine();
  const puma = buffStore.getByName('Spirit of the Puma');
  assert.ok(puma, 'expected Spirit of the Puma in the roster');

  engine.setSpellbookCheckFn((name) => name === puma.name); // scribed...
  engine._rememberMemorized('Some Other Spell'); // ...but not the spell currently in a gem
  engine.handleLine(puma.landingText);

  assert.deepEqual(names(engine), [], 'legacy behaviour changed - this pins the OLD outcome');
  assert.ok(log.some((m) => m.includes('IGNORED') && m.includes('not currently memorized')));
  assert.equal(engine.getAmbiguousCasts().length, 0, 'legacy behaviour must never queue a prompt');
});

test('toggle on: the same case LANDS directly - a single candidate is never a real ambiguity to ask about', () => {
  // Corrected 25 Aug: this used to queue a one-button "which one was it?" prompt, reported live as
  // "inexcusable no matter the context" - and rightly so, since the identity was never actually in
  // question (unique landing text already settled that). What's uncertain is confidence the cast is
  // the player's own, which is a different question than "which spell is this," and doesn't need a
  // prompt with exactly one possible answer.
  const { engine, buffStore, log } = makeEngine();
  const puma = buffStore.getByName('Spirit of the Puma');

  engine.setUseEvidenceModel(true);
  engine.setSpellbookCheckFn((name) => name === puma.name);
  engine._rememberMemorized('Some Other Spell');
  engine.handleLine(puma.landingText);

  assert.deepEqual(names(engine), [puma.name]);
  assert.equal(engine.getAmbiguousCasts().length, 0, 'a single candidate must never produce a prompt');
  assert.ok(log.some((m) => m.includes('LANDED') && m.includes('only one candidate')));
});

test('toggle on: a remembered resolution for this exact text still lands silently, no re-prompt', () => {
  const { engine, buffStore } = makeEngine();
  const puma = buffStore.getByName('Spirit of the Puma');

  engine.setUseEvidenceModel(true);
  engine.setSpellbookCheckFn((name) => name === puma.name);
  engine._rememberMemorized('Some Other Spell');
  engine.selfAmbiguousResolutions.set(puma.landingText, puma.name);
  engine.handleLine(puma.landingText);

  assert.deepEqual(names(engine), [puma.name], 'a previously-confirmed answer must still apply automatically');
  assert.equal(engine.getAmbiguousCasts().length, 0, 'a remembered answer is not a guess and must not re-queue');
});

test('the hard veto (never scribed by this class at all) is unaffected by the toggle, either way', () => {
  for (const useEvidenceModel of [false, true]) {
    const { engine, buffStore, log } = makeEngine();
    const puma = buffStore.getByName('Spirit of the Puma');

    engine.setUseEvidenceModel(useEvidenceModel);
    engine.setSpellbookCheckFn(() => false); // this class can never scribe it at all
    engine.handleLine(puma.landingText);

    assert.deepEqual(names(engine), [], `useEvidenceModel=${useEvidenceModel}: neverScribed must stay a hard veto`);
    assert.equal(engine.getAmbiguousCasts().length, 0, `useEvidenceModel=${useEvidenceModel}: neverScribed must never queue - it is real negative evidence, not soft`);
    assert.ok(log.some((m) => m.includes('IGNORED') && m.includes('never scribed by you at all')));
  }
});

test('toggle on, track others on: still lands directly - trackOthersEnabled makes no difference to a staleGem case', () => {
  // staleGem is about the player's OWN cast, so trackOthersEnabled (which only ever gates ally
  // attribution) is irrelevant here either way - with a single candidate this always lands.
  const { engine, buffStore } = makeEngine();
  const puma = buffStore.getByName('Spirit of the Puma');

  engine.setUseEvidenceModel(true);
  engine.setTrackOthersEnabled(true);
  engine.setSpellbookCheckFn((name) => name === puma.name);
  engine._rememberMemorized('Some Other Spell');
  engine.handleLine(puma.landingText);

  assert.deepEqual(names(engine), [puma.name]);
  assert.equal(engine.getAmbiguousCasts().length, 0);
});

// ---------------------------------------------------------------------------
// P0b: attributing an ally's burst, split from the stale-gem case (25 Aug)
// ---------------------------------------------------------------------------

test('legacy (toggle off): an ally-burst unique landing still blind-lands as before, unchanged', () => {
  const { engine, buffStore, log } = makeEngine();
  const puma = buffStore.getByName('Spirit of the Puma');

  engine.setTrackOthersEnabled(true);
  engine.handleLine("Dovairous activates Quick Buff.");
  engine.handleLine(puma.landingText);

  assert.deepEqual(names(engine), [puma.name], 'legacy behaviour changed - this pins the OLD outcome');
  assert.ok(log.some((m) => m.includes('LANDED') && m.includes("an ally's instant grant just fired")));
});

test('evidence model on, track others OFF: an ally-burst landing stays a silent IGNORE, never a prompt', () => {
  // Shara, 25 Aug: "track who likely did it, but it shouldn't hit self buffs unless toggled on."
  const { engine, buffStore, log } = makeEngine();
  const puma = buffStore.getByName('Spirit of the Puma');

  engine.setUseEvidenceModel(true);
  engine.handleLine("Dovairous activates Quick Buff.");
  engine.handleLine(puma.landingText);

  assert.deepEqual(names(engine), []);
  assert.equal(engine.getAmbiguousCasts().length, 0, 'must not surface a prompt with track-others off');
  assert.ok(log.some((m) => m.includes('IGNORED') && m.includes("an ally's instant grant just fired")));
});

test('evidence model on, track others ON: an ally-burst landing lands directly, attribution folded into the log', () => {
  // Corrected 25 Aug alongside the single-candidate fix above: this used to queue with an
  // attributedTo field for a future UI. There is no future UI for a one-option prompt - the
  // attribution is real and worth keeping, but it belongs in the log, not a decision the user has
  // to answer.
  const { engine, buffStore, log } = makeEngine();
  const puma = buffStore.getByName('Spirit of the Puma');

  engine.setUseEvidenceModel(true);
  engine.setTrackOthersEnabled(true);
  engine.handleLine("Dovairous activates Quick Buff.");
  engine.handleLine(puma.landingText);

  assert.deepEqual(names(engine), [puma.name]);
  assert.equal(engine.getAmbiguousCasts().length, 0, 'a single candidate must never produce a prompt');
  assert.ok(log.some((m) => m.includes('LANDED') && m.includes('only one candidate') && m.includes('likely "Dovairous"')));
});

test('a stale-gem case (no ally burst involved) is unaffected by trackOthersEnabled - it is about the player, not an ally', () => {
  const { engine, buffStore } = makeEngine();
  const puma = buffStore.getByName('Spirit of the Puma');

  engine.setUseEvidenceModel(true);
  engine.setTrackOthersEnabled(false); // off - staleGem must land regardless
  engine.setSpellbookCheckFn((name) => name === puma.name);
  engine._rememberMemorized('Some Other Spell');
  engine.handleLine(puma.landingText);

  assert.deepEqual(names(engine), [puma.name], 'staleGem must land regardless of trackOthersEnabled');
  assert.equal(engine.getAmbiguousCasts().length, 0);
});

// ---------------------------------------------------------------------------
// P0c: cast-time-aware confirmation window, its own independent toggle (25 Aug)
// ---------------------------------------------------------------------------
//
// The actual timeout firing is never awaited here - each test file runs as its own child process
// (see test/run.js) that calls process.exit() right after the synchronous test run, so a dangling
// setTimeout of a few seconds is simply discarded rather than slowing anything down. What's tested
// is the synchronous CAST BEGIN debug line, which already states the computed wait duration.

test('off by default', () => {
  const { engine } = makeEngine();
  assert.equal(engine.useCastTimeFilter, false);
});

test('legacy (toggle off): the flat window is used regardless of the roster having a cast time', () => {
  const { engine, log } = makeEngine();
  engine.handleLine('You begin casting Spirit of the Puma.');
  assert.ok(log.some((m) => m.startsWith('CAST BEGIN "Spirit of the Puma"') && !m.includes('cast-time filter ON')));
});

test('toggle on: waits the scaled cast time plus tolerance, not the flat 12s', () => {
  const { engine, buffStore, log } = makeEngine();
  const puma = buffStore.getByName('Spirit of the Puma');
  assert.equal(puma.castSec, 3, 'this test is pinned to the real roster value - update it if the roster changes');

  engine.setUseCastTimeFilter(true);
  engine.handleLine('You begin casting Spirit of the Puma.');

  // rank 0 (no numeral): 3s * (1 + -0.04*0) = 3s, +0.5s tolerance = 3.5s
  assert.ok(log.some((m) => m.includes('cast-time filter ON') && m.includes('waiting 3.5s')));
});

test('a higher mote rank casts faster, and the wait window shrinks with it', () => {
  const { engine, log } = makeEngine();
  engine.setUseCastTimeFilter(true);
  engine.handleLine('You begin casting Spirit of the Puma VII.');

  // rank 7: 3s * (1 + -0.04*7) = 3s * 0.72 = 2.16s, +0.5s tolerance = 2.66s -> "2.7s"
  assert.ok(log.some((m) => m.includes('cast-time filter ON') && m.includes('waiting 2.7s')));
});

test('toggle on but no castSec on file: falls back to the flat window, never worse than legacy', () => {
  const { engine, buffStore, log } = makeEngine();
  const noCastSec = buffStore.getAll().find((e) => e.castSec == null && e.landingText);
  assert.ok(noCastSec, 'expected at least one roster entry with no castSec to test the fallback');

  engine.setUseCastTimeFilter(true);
  engine.handleLine(`You begin casting ${noCastSec.name}.`);

  assert.ok(log.some((m) => m.startsWith(`CAST BEGIN "${noCastSec.name}"`) && !m.includes('cast-time filter ON')));
});

// ---------------------------------------------------------------------------
// P0c continued: Spell Casting Subtlety, the second cast-time multiplier (25 Aug)
// ---------------------------------------------------------------------------
//
// Confirmed live from the AA window itself: "reduces the cast time of beneficial spells that have
// a duration and an initial cast time of at least 3 seconds by 10%" at rank 4/6. This is what
// closed the gap between the mote-only prediction (2.16s) and the real in-game value (1.94s) for
// Spirit of the Puma VII.

test('the AA multiplier applies on top of the mote-tier rate for an eligible spell', () => {
  const { engine, buffStore, log } = makeEngine();
  const puma = buffStore.getByName('Spirit of the Puma');
  assert.ok(puma.durationSec > 0 && puma.castSec >= 3, 'Puma must be AA-eligible for this test to mean anything');

  engine.setUseCastTimeFilter(true);
  engine.setCastTimeMultiplierFn(() => 0.9); // the confirmed 10% reduction
  engine.handleLine('You begin casting Spirit of the Puma VII.');

  // rank 7 mote: 3 * 0.72 = 2.16, x0.9 AA = 1.944, +0.5s tolerance = 2.444 -> "2.4s"
  assert.ok(log.some((m) => m.includes('cast-time filter ON') && m.includes('waiting 2.4s')));
});

test('the AA multiplier is skipped for a spell with no duration, per the AA\'s own eligibility text', () => {
  const { engine, buffStore, log } = makeEngine();
  const instant = buffStore.getAll().find((e) => e.castSec >= 3 && !(e.durationSec > 0));
  assert.ok(instant, 'expected at least one instant-ish roster entry with a 3s+ cast to test against');

  engine.setUseCastTimeFilter(true);
  engine.setCastTimeMultiplierFn(() => 0.5); // exaggerated, so a leak would be obvious
  engine.handleLine(`You begin casting ${instant.name}.`);

  const expectedMs = Math.round(instant.castSec * 1000) + 500; // mote rate for its category, rank 0 -> no mote change either
  assert.ok(
    log.some((m) => m.startsWith(`CAST BEGIN "${instant.name}"`) && m.includes(`waiting ${(expectedMs / 1000).toFixed(1)}s`)),
    'a no-duration spell must not receive the cast-speed AA reduction'
  );
});

test('the AA multiplier is skipped for a spell with under 3s base cast time', () => {
  const { engine, buffStore, log } = makeEngine();
  const fast = buffStore.getAll().find((e) => e.durationSec > 0 && e.castSec != null && e.castSec < 3 && e.castSec > 0);
  assert.ok(fast, 'expected at least one sub-3s-cast buff in the roster to test against');

  engine.setUseCastTimeFilter(true);
  engine.setCastTimeMultiplierFn(() => 0.5); // exaggerated, so a leak would be obvious
  engine.handleLine(`You begin casting ${fast.name}.`);

  const expectedMsWithoutAA = Math.round(fast.castSec * 1000) + 500; // mote rate at rank 0 is a no-op either way
  assert.ok(
    log.some((m) => m.startsWith(`CAST BEGIN "${fast.name}"`) && m.includes(`waiting ${(expectedMsWithoutAA / 1000).toFixed(1)}s`)),
    'a sub-3s-cast spell must not receive the cast-speed AA reduction'
  );
});

module.exports = () => report('evidence-based-detection');
if (require.main === module) report('evidence-based-detection').then((n) => process.exit(n ? 1 : 0));
