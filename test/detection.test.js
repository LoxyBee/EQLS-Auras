'use strict';
/**
 * The detection engine's first real coverage.
 *
 * handleLine() is the most consequential code in this project and, until this file, had none. It
 * is also the code that fails silently: when it goes wrong nobody sees an error, a timer somebody
 * relied on simply stops appearing. The owner's constraint on any work here is "if any
 * functionality is lost during this process that is to be considered a failure", and a constraint
 * with no mechanical guard behind it is a hope.
 *
 * BuffEngine takes its store as a constructor argument and imports no Electron, so the real engine
 * runs here against a plain in-memory fake - these are behavioural tests, not structural ones.
 *
 * The bulk of this file pins behaviour that ALREADY WORKED before anything was changed. That is
 * the point: it is a net under the tier work, not a description of new features.
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
  engine.stop(); // no wall-clock tick; every test drives _tick() itself
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  return { engine, buffStore, log };
}

const names = (engine) => engine.getActiveBuffs().map((b) => b.name).sort();

// ---------------------------------------------------------------------------
// The basics, pinned because everything else stands on them
// ---------------------------------------------------------------------------

test('a unique landing text starts a timer', () => {
  const { engine } = makeEngine();
  engine.handleLine('[Wed Aug 19 20:15:02 2026] You begin to snarl as your features become feline.');
  assert.deepEqual(names(engine), ['Spirit of the Puma']);
  assert.equal(engine.getActiveBuffs()[0].remainingSec, 60);
});

test('its ended text stops it', () => {
  const { engine } = makeEngine();
  engine.handleLine('You begin to snarl as your features become feline.');
  assert.equal(engine.getActiveBuffs().length, 1);
  engine.handleLine('The spirit of the puma departs.');
  assert.deepEqual(names(engine), []);
});

test('a blocked buff never lands', () => {
  const { engine } = makeEngine();
  engine.blockBuff('Spirit of the Puma');
  engine.handleLine('You begin to snarl as your features become feline.');
  assert.deepEqual(names(engine), [], '"No longer track" has to mean it');
});

test('landing again refreshes rather than duplicating', () => {
  const { engine } = makeEngine();
  engine.handleLine('You begin to snarl as your features become feline.');
  engine.handleLine('You begin to snarl as your features become feline.');
  assert.equal(engine.getActiveBuffs().length, 1, 'a renewal must not become a second tile');
});

test('an ordinary chat line does nothing at all', () => {
  const { engine } = makeEngine();
  engine.handleLine("Avenrae says, 'You begin to snarl as your features become feline.'");
  assert.deepEqual(names(engine), [], 'a quoted landing message is not a landing');
});

test('an expired buff is swept away', () => {
  const { engine } = makeEngine();
  engine.handleLine('The aria lifts you into the air.'); // Agilmente's Aria of Eagles, 18s
  assert.equal(engine.getActiveBuffs().length, 1);
  const entry = [...engine.activeBuffs.values()][0];
  entry.expiresAt = Date.now() - 1000;
  engine._tick();
  assert.deepEqual(names(engine), []);
});

// ---------------------------------------------------------------------------
// A spell the roster has no duration for - A KNOWN DEFECT, pinned as it stands
// ---------------------------------------------------------------------------
//
// These tests assert BROKEN behaviour on purpose, which is unusual enough to explain.
//
// 275 of the 1,052 roster entries carry a landing text and no duration. An absent duration
// multiplies to NaN, NaN becomes the expiry, and the sweep asks `expiresAt <= now` - false for
// NaN, forever. So one of those landing produces a tile reading "NaN:NaN" that never counts down
// and cannot be dismissed without restarting the app.
//
// It was fixed by refusing to land them, and the fix was reverted after measuring it against 1.6
// million lines of real play: it removed 67 distinct spells and 18,405 landings. Most were
// instants that should never have had a timer, but 31 were real buffs - Armor of Protection,
// Barbcoat, Fury, Wolf Form, Shrink - and dropping those is a genuine loss.
//
// Every available option trades one wrong behaviour for another, so it is the owner's decision.
// Until she makes it, these pin what the app actually does, so nobody changes it by accident and
// nobody has to rediscover the measurement. See FEATURES.md note 24.

test('KNOWN DEFECT: a spell with no duration lands with an expiry of NaN', () => {
  const { engine, buffStore } = makeEngine();
  const noDuration = buffStore.getByName('Alliance');
  assert.equal(typeof noDuration.durationSec, 'undefined', 'the fixture spell now HAS a duration - pick another');

  engine._land(noDuration);
  assert.deepEqual(names(engine), ['Alliance'], 'it does still land - that is the half worth keeping');
  const entry = [...engine.activeBuffs.values()][0];
  assert.ok(Number.isNaN(entry.expiresAt), 'the expiry is NaN - this is the defect');
});

test('KNOWN DEFECT: and the sweep can never remove it', () => {
  // NaN <= anything is false, so the once-a-second cleanup skips it every time, forever.
  const { engine, buffStore } = makeEngine();
  engine._land(buffStore.getByName('Alliance'));
  engine._tick();
  assert.deepEqual(names(engine), ['Alliance'], 'still there after a sweep');
  assert.equal(NaN <= Date.now() + 31536000000, false, 'and a year would not help');
});

test('a duration that IS known behaves correctly', () => {
  // The contrast, and the thing any fix must not disturb.
  const { engine, buffStore } = makeEngine();
  engine._land(buffStore.getByName('Spirit of the Puma'));
  assert.deepEqual(names(engine), ['Spirit of the Puma']);
  assert.equal(engine.getActiveBuffs()[0].remainingSec, 60);
});

test('the sweep still leaves a healthy buff alone', () => {
  const { engine } = makeEngine();
  engine.handleLine('You feel agile.'); // Agility, 3780s
  engine._tick();
  assert.deepEqual(names(engine), ['Agility'], 'the sweep must only remove what is actually over');
});

// ---------------------------------------------------------------------------
// The veto that keeps someone else's buff off your own aura
// ---------------------------------------------------------------------------

test('a buff someone else was seen casting is not counted as yours', () => {
  // Default is self-buffs only. A third-person cast line is the evidence, and it has no time
  // limit on purpose - an auto-renewing song shows that line once and then renews silently.
  const { engine } = makeEngine();
  engine.handleLine('Avenrae begins to cast a spell.');
  engine.handleLine('Avenrae begins casting Spirit of the Puma.');
  engine.handleLine('You begin to snarl as your features become feline.');
  assert.deepEqual(names(engine), [], "someone else's buff must not land on your own aura");
});

test('but it IS counted once you ask to track other people buffs', () => {
  const { engine } = makeEngine();
  engine.setTrackOthersEnabled(true);
  engine.handleLine('Avenrae begins casting Spirit of the Puma.');
  engine.handleLine('You begin to snarl as your features become feline.');
  assert.deepEqual(names(engine), ['Spirit of the Puma']);
});

test('the veto now records WHO, without changing what it decides', () => {
  // The change is a Set to a Map so the debug log can name the caster. The KEY is unchanged
  // and has to stay unchanged: six decisions gate on _hasRecentOtherCast(spellName), and
  // widening the key to caster+spell would quietly weaken all of them.
  const { engine, log } = makeEngine();
  engine.handleLine('Motrin begins casting Spirit of the Puma.');

  assert.equal(engine._hasRecentOtherCast('Spirit of the Puma'), true, 'the veto must still fire');
  assert.equal(engine._hasRecentOtherCast('SPIRIT OF THE PUMA'), true, 'and still be case-insensitive');
  assert.equal(engine._hasRecentOtherCast('Agility'), false);
  assert.equal(engine._recentOtherCaster('Spirit of the Puma'), 'Motrin');
  assert.equal(engine._recentOtherCaster('Agility'), null, 'never seen cast means no name, not undefined');

  engine.handleLine('You begin to snarl as your features become feline.');
  assert.deepEqual(names(engine), [], 'the veto still keeps it off your own aura');
  assert.ok(
    log.some((m) => m.includes('recently cast by "Motrin"')),
    'the whole point of the change is that the log can now say who'
  );
});

test('a second caster of the same spell does not break the veto', () => {
  // The failure this guards: keying on caster+spell instead of spell would mean the same spell
  // cast by two different people stopped matching itself, and the veto would silently stop
  // firing - with track-others off, that lands another player buff on your own aura.
  const { engine } = makeEngine();
  engine.handleLine('Motrin begins casting Spirit of the Puma.');
  engine.handleLine('Avenrae begins casting Spirit of the Puma.');
  assert.equal(engine._hasRecentOtherCast('Spirit of the Puma'), true);
  assert.equal(engine._recentOtherCaster('Spirit of the Puma'), 'Avenrae', 'the latest caster wins');
  engine.handleLine('You begin to snarl as your features become feline.');
  assert.deepEqual(names(engine), []);
});

test('a caster whose name is not one plain word still vetoes', () => {
  // Only about half of the caster names in the real logs are a single alphabetic word.
  // Anything that filtered them by shape - Cazic-Thule, A Teir`Dal something, someone's pet -
  // would silently stop vetoing for the rest.
  const { engine } = makeEngine();
  engine.handleLine('a greater kobold begins casting Spirit of the Puma.');
  assert.equal(engine._hasRecentOtherCast('Spirit of the Puma'), true);
  assert.equal(engine._recentOtherCaster('Spirit of the Puma'), 'a greater kobold');
});

test('a party change still clears the veto', () => {
  // The clear is what stops a veto outliving the group it came from. It has to keep working
  // now that the collection is a Map.
  const { engine } = makeEngine();
  engine.handleLine('Motrin begins casting Spirit of the Puma.');
  assert.equal(engine._hasRecentOtherCast('Spirit of the Puma'), true);
  engine.handleLine('You have been removed from the group.');
  assert.equal(engine._hasRecentOtherCast('Spirit of the Puma'), false, 'a stale veto would hide your own buffs');
});

module.exports = () => report('detection');
if (require.main === module) process.exit(report('detection') ? 1 : 0);
