'use strict';
/**
 * Live bug, owner's Sep-1 raid: Self Buffs picked up a raid cleric's Quick Buff. The unique-
 * landing-text tier already treats an ally's instant-grant burst (`allyBurstUntil`) as a soft
 * negative - but the AMBIGUOUS tier's "narrowed to 1 by gem / by spellbook" shortcuts did not, so
 * Dexterity / Augmentation / Talisman of Altuna / Resist Magic landed as her own casts. An ally's
 * raid-wide version prints the identical shared landing line; her gems say nothing about who cast
 * the landing that hit her.
 *
 * Driven through the real engine + real roster, same convention as evidence-based-detection.test.js.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');

const TS = '[Mon Sep 01 18:41:03 2026] ';
// "You feel dexterous." is shared by Deftness / Dexterity / Dexterous Aura / Rising Dexterity in
// the shipped roster - genuinely ambiguous, narrows to one only via the player's own gems.
const AMBIG_LINE = `${TS}You feel dexterous.`;
const NARROWS_TO = 'Dexterity';

function makeEngine() {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const engine = new BuffEngine(new BuffStore(store), store);
  engine.stop();
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  // she has it in a gem, nothing scribed-file wise (her real situation - no spellbook file)
  engine.handleLine(`${TS}You have finished memorizing ${NARROWS_TO}.`);
  return { engine, log };
}

const active = (engine) => engine.getActiveBuffs().map((b) => b.name);

test('control: with NO ally burst, the gem-narrowed ambiguous landing still lands (no regression)', () => {
  const { engine, log } = makeEngine();
  engine.handleLine(AMBIG_LINE);
  assert.ok(active(engine).includes(NARROWS_TO), 'the ordinary gem-narrow path must still work');
  assert.ok(log.some((m) => /narrowed to 1 by currently-memorized gem/.test(m)));
});

test('bug: during an ally Quick Buff burst, the gem-narrowed landing is NOT auto-landed', () => {
  const { engine, log } = makeEngine();
  engine.handleLine(`${TS}Eminence activates Quick Buff.`);
  engine.handleLine(AMBIG_LINE);

  assert.ok(!active(engine).includes(NARROWS_TO), 'it landed as her own during an ally burst');
  assert.ok(log.some((m) => /ALLY ACTIVATE/.test(m)), 'the ally burst was not registered');
  assert.ok(log.some((m) => /SUSPECT "Dexterity"[\s\S]*Quick Buff" by an ally just fired/.test(m)),
    'no SUSPECT line explaining why the narrow was skipped');
  // track-others is OFF (her default) -> it should end as a silent IGNORE, not a queued prompt
  assert.ok(log.some((m) => /IGNORED "You feel dexterous\."/.test(m)));
  assert.equal(engine.getAmbiguousCasts().length, 0, 'track-others off should not queue anything');
});

test('with track-others ON, the same ally-burst landing becomes a queued prompt, not a self-land', () => {
  const { engine } = makeEngine();
  engine.setTrackOthersEnabled(true);
  engine.handleLine(`${TS}Eminence activates Quick Buff.`);
  engine.handleLine(AMBIG_LINE);

  assert.ok(!active(engine).includes(NARROWS_TO), 'still must not self-land');
  assert.equal(engine.getAmbiguousCasts().length, 1, 'it should be queued for the user to resolve');
});

test('the ally-burst window is short-lived - a landing well after it still narrows normally', () => {
  const { engine } = makeEngine();
  engine.handleLine(`${TS}Eminence activates Quick Buff.`);
  engine.allyBurstUntil = Date.now() - 1; // burst has expired
  engine.handleLine(AMBIG_LINE);
  assert.ok(active(engine).includes(NARROWS_TO), 'once the ally burst is over, narrowing resumes');
});

test('an ally activating a NORMAL ability (not a multi-grant) does NOT suppress the narrow', () => {
  // This is the whole reason the trigger is scoped to a name list: in a raid an ally activates
  // *something* every few seconds, and gating on "any ally activate" cascaded her own maintained
  // songs into non-detection (-60k landings on the full replay).
  const { engine } = makeEngine();
  engine.handleLine(`${TS}Eminence activates Divine Aura.`);
  engine.handleLine(AMBIG_LINE);
  assert.ok(active(engine).includes(NARROWS_TO), 'a normal ally AA must not block her own gem-narrowed land');
});

test('during Quick Buff, a RENEWAL of something already active is still hers', () => {
  const { engine } = makeEngine();
  engine.handleLine(AMBIG_LINE); // first land - Dexterity is now active
  assert.ok(active(engine).includes(NARROWS_TO));
  engine.handleLine(`${TS}Eminence activates Quick Buff.`);
  engine.handleLine(AMBIG_LINE); // re-land during the burst
  assert.ok(active(engine).includes(NARROWS_TO), 'an active buff renewing during a Quick Buff is not suspect');
});

test('a remembered self-resolution does NOT rescue it during an ally Quick Buff', () => {
  // A remembered resolution answers "which of MY spells is this shared text", not "is it mine at
  // all". An ally's raid-wide Quick Buff printing the same text is exactly the "not mine" case.
  const { engine } = makeEngine();
  engine.selfAmbiguousResolutions.set('You feel dexterous.', NARROWS_TO); // stored, buff not active
  engine.handleLine(`${TS}Eminence activates Quick Buff.`);
  engine.handleLine(AMBIG_LINE);
  assert.ok(!active(engine).includes(NARROWS_TO), 'the ally Quick Buff is a stronger signal than a past resolution');
});

test('a BARD SONG landing during an ally Quick Buff is NOT suppressed (Quick Buff cannot grant songs)', () => {
  const { engine, log } = makeEngine();
  const store = engine.buffStore;
  // Selo's Accelerating Chorus lands "Your feet move faster." shared with Selo's Accelerando -
  // both bard songs. Memorize one so it narrows.
  const song = store.getAll().find((e) => e.isBardSong && e.landingText && (e.landingTextSharedBy || 1) > 1
    && !/\s[IVXLC]+$/.test(e.name));
  if (!song) return; // roster has no shared-text bard song - nothing to assert
  engine.handleLine(`${TS}You have finished memorizing ${song.name}.`);
  engine.handleLine(`${TS}Eminence activates Quick Buff.`);
  engine.handleLine(`${TS}${song.landingText}`);
  assert.ok(active(engine).includes(song.name), 'her own song was suppressed by an ally Quick Buff it cannot have granted');
});

test('if SHE Quick Buffs in the same window it is unsolvable - credit her', () => {
  const { engine } = makeEngine();
  engine.handleLine(`${TS}Eminence activates Quick Buff.`);
  engine.handleLine(`${TS}You activate Quick Buff.`); // her own burst is now open too
  engine.handleLine(AMBIG_LINE);
  assert.ok(active(engine).includes(NARROWS_TO), "her own burst wins the tie - the landing is credited to her");
});

module.exports = () => report('ally-burst-ambiguous-narrow');
if (require.main === module) report('ally-burst-ambiguous-narrow').then((n) => process.exit(n ? 1 : 0));
