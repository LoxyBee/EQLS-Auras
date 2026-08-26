'use strict';
/**
 * Spells that never run out.
 *
 * Shara: "some of the 0 duration spells are actually infinite duration... use yaulp and fury as
 * examples of spells that do, and code in functionality for tiles to have infinite duration, and
 * make it easy to find and add more."
 *
 * The distinction that makes this worth building rather than defaulting: a spell can have no
 * duration in the spreadsheet for two completely different reasons. A nuke or a heal has none
 * because it does not last at all. Yaulp and Fury have none because they last until something
 * takes them away. Treating those two the same is what produced a tile counting down from NaN.
 *
 * The place to add more is tools/roster-overrides.json, which already refuses an entry that does
 * not say who verified it and how.
 *
 * Most of what is checked here is what happens at the EDGES of "no number". remainingSec is null
 * for these, and JavaScript is unhelpfully willing to compare null to a number - `null <= 30` is
 * true - so several perfectly reasonable-looking lines elsewhere would quietly treat a permanent
 * buff as one seconds from expiring.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const roster = JSON.parse(read('src', 'shared', 'data', 'buffs.json'));
const overrides = JSON.parse(read('tools', 'roster-overrides.json'));

function makeEngine() {
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const buffStore = new BuffStore(store);
  const engine = new BuffEngine(buffStore, store);
  engine.stop();
  return { engine, buffStore };
}

// ---------------------------------------------------------------------------
// The data
// ---------------------------------------------------------------------------

test('the spells Shara named are marked, and every rank of them', () => {
  const marked = roster.filter((e) => e.infiniteDuration === true).map((e) => e.name).sort();
  for (const name of ['Fury', 'Yaulp', 'Yaulp II', 'Yaulp III']) {
    assert.ok(marked.includes(name), `${name} is not marked as lasting forever`);
  }
  // The ranks matter: marking only "Yaulp" would leave whichever rank she actually casts broken,
  // and they share landing and ended text exactly.
  assert.ok(marked.filter((n) => n.startsWith('Yaulp')).length >= 3, 'the Yaulp ranks are not all marked');
});

test('the marking survives a roster rebuild', () => {
  // The whole reason tools/roster-overrides.json exists: a correction typed straight into
  // buffs.json is undone by the next rebuild without anyone noticing.
  for (const name of ['Fury', 'Yaulp', 'Yaulp II', 'Yaulp III']) {
    assert.ok(overrides[name], `${name} is set in the roster but not in the overrides file`);
    assert.equal(overrides[name].set.infiniteDuration, true);
    assert.ok(overrides[name].why && overrides[name].why.length > 20, `${name} has no real reason recorded`);
  }
});

test('the overrides file says how to add more', () => {
  // "make it easy to find and add more" - so the instructions live where someone doing it will
  // already be looking, not in a document they would have to know about first.
  const raw = read('tools', 'roster-overrides.json');
  assert.match(raw, /infiniteDuration/, 'the file never mentions the flag it is meant to teach');
  assert.match(raw, /TO MARK A SPELL AS LASTING FOREVER/i, 'there is no instruction to find');
});

test('nothing instant was marked by mistake', () => {
  // The failure this guards is a permanent tile for a nuke - it would never go away and there
  // would be nothing on screen explaining why.
  const marked = roster.filter((e) => e.infiniteDuration === true);
  for (const e of marked) {
    assert.ok(
      !['nuke', 'heal'].includes(e.scaleCategory),
      `${e.name} is a ${e.scaleCategory} - an instant spell must never be marked as lasting forever`
    );
  }
});

// ---------------------------------------------------------------------------
// The behaviour
// ---------------------------------------------------------------------------

test('it lands with no remaining time rather than a made-up one', () => {
  const { engine, buffStore } = makeEngine();
  engine._land(buffStore.getByName('Fury'));
  const [buff] = engine.getActiveBuffs();
  assert.equal(buff.name, 'Fury');
  assert.equal(buff.remainingSec, null, 'null, so it can never be mistaken for zero');
  assert.equal(buff.infinite, true);
  assert.equal(buff.durationSec, null);
});

test('no sweep ever removes it', () => {
  const { engine, buffStore } = makeEngine();
  engine._land(buffStore.getByName('Yaulp II'));
  for (let i = 0; i < 5; i++) engine._tick();
  assert.deepEqual(engine.getActiveBuffs().map((b) => b.name), ['Yaulp II'], 'it must outlast the cleanup');
});

test('its ended text still ends it', () => {
  // Which is the whole reason it is safe to let it live forever: there IS a way out.
  const { engine, buffStore } = makeEngine();
  engine._land(buffStore.getByName('Fury'));
  assert.equal(engine.getActiveBuffs().length, 1);
  engine.handleLine('Your frenzy fades.');
  assert.deepEqual(engine.getActiveBuffs(), []);
});

test('an ordinary buff is completely unaffected', () => {
  const { engine, buffStore } = makeEngine();
  engine._land(buffStore.getByName('Spirit of the Puma'));
  const [buff] = engine.getActiveBuffs();
  assert.equal(buff.remainingSec, 60);
  assert.equal(buff.infinite, false);
});

test('it sorts LAST, not first', () => {
  // remainingSec is null, and plain subtraction treats null as zero - which would put a buff that
  // never runs out at the top of the list, in the place the eye checks first, as though it were
  // the most urgent thing on screen.
  const { engine, buffStore } = makeEngine();
  engine._land(buffStore.getByName('Fury'));
  engine._land(buffStore.getByName('Spirit of the Puma'));
  assert.deepEqual(engine.getActiveBuffs().map((b) => b.name), ['Spirit of the Puma', 'Fury']);
});

test('an ally can have one too', () => {
  const { engine, buffStore } = makeEngine();
  engine._landOnAlly(buffStore.getByName('Fury'), 'Avenrae');
  const [buff] = engine.getActiveAllyBuffs();
  assert.equal(buff.infinite, true);
  assert.equal(buff.remainingSec, null);
  engine._tick();
  assert.equal(engine.getActiveAllyBuffs().length, 1);
});

// ---------------------------------------------------------------------------
// The overlay, where "no number" meets code that expects one
// ---------------------------------------------------------------------------

test('the countdown shows a symbol instead of a number', () => {
  const m = overlaySrc.match(/function formatTime\(totalSec, format\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'formatTime has been restructured');
  const body = m[1];
  const nullCheck = body.indexOf('totalSec === null');
  const firstFormat = body.indexOf("format ===");
  assert.ok(nullCheck >= 0, 'nothing handles a buff with no remaining time');
  assert.ok(
    nullCheck < firstFormat,
    'it has to be checked before any format branch, or every one of them prints null or NaN'
  );
});

test('a permanent buff is never coloured as though it were expiring', () => {
  // `null <= 30` is true in JavaScript, so the obvious version of this line marks a buff that
  // never runs out as low on time, permanently.
  const m = overlaySrc.match(/const low = ([^;]+);/);
  assert.ok(m, 'the low-time check has been restructured');
  assert.match(m[1], /!buff\.infinite/, 'a permanent buff would sit there coloured as nearly expired');
});

test('and it never triggers the about-to-expire sound', () => {
  // Same trap, worse symptom: a beep every loop interval, forever.
  const m = overlaySrc.match(/function checkSoundWarnings\(visible\) \{([\s\S]*?)\n\}/);
  assert.ok(m, 'checkSoundWarnings has been restructured');
  const body = m[1];
  const guard = body.indexOf('if (buff.infinite)');
  const compare = body.indexOf('buff.remainingSec > thresholdSec');
  assert.ok(guard >= 0, 'nothing stops a permanent buff warning that it is about to end');
  assert.ok(guard < compare, 'the guard has to come before the comparison it is protecting against');
});

test('its bar is full, not empty', () => {
  // The assignment wraps onto its own line now that note 19's barPercent sits in front of the
  // infinite check, so this tolerates a newline after the "=". The rule being tested is unchanged.
  const m = overlaySrc.match(/const pct =\s*([\s\S]*?);\r?\n/);
  assert.ok(m, 'the bar calculation has been restructured');
  assert.match(m[1], /buff\.infinite\s*\n?\s*\?\s*100/, 'an empty bar says the opposite of the truth');
  // Note 19. A damage row IS infinite - it has no expiry - so if barPercent stopped being read
  // first, every row in the meter would draw a full bar and the comparison would show nothing.
  assert.ok(
    m[1].indexOf('barPercent') >= 0 && m[1].indexOf('barPercent') < m[1].indexOf('buff.infinite'),
    'barPercent has to be read before the infinite check, or a damage meter draws every bar full'
  );
});

module.exports = () => report('infinite-duration');
if (require.main === module) report('infinite-duration').then((n) => process.exit(n ? 1 : 0));
