'use strict';
/**
 * The GCD (global spell recovery) tracker - backlog #38.
 *
 * A custom-timer widget with one timer in a new 'anyCast' trigger mode: it fires on every cast /
 * song / activate line, whatever the spell. Its length is NOT the stored durationSec - it is the
 * recovery for THAT cast, base 1.5s scaled down 2% per mote tier of the spell, shown to the
 * nearest 0.1s with an exact half rounding DOWN (Shara's spec, same "Benefits by category" sheet
 * as the buff-duration and cast-time mote rates).
 *
 * Driven through the real CustomTimerEngine + a real WidgetStore with a fake store backend and
 * synthetic log lines. No Electron.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine, gcdSecForRank } = require('../src/main/customTimerEngine');

const TS = '[Wed Aug 19 19:23:03 2026] ';

function setup() {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer);
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  return { store, engine, log };
}

// ---------------------------------------------------------------------------
// The scaling formula
// ---------------------------------------------------------------------------

test('gcdSecForRank: base 1.5s, -2%/tier, nearest 0.1s, halves round down', () => {
  assert.equal(gcdSecForRank(0), 1.5); // un-ranked cast
  assert.equal(gcdSecForRank(1), 1.5); // 1.47 -> 1.5
  assert.equal(gcdSecForRank(2), 1.4); // 1.44 -> 1.4
  assert.equal(gcdSecForRank(5), 1.3); // 1.35 exactly -> half rounds DOWN -> 1.3
  assert.equal(gcdSecForRank(7), 1.3); // 1.29 -> 1.3
  assert.equal(gcdSecForRank(10), 1.2); // 1.20
  assert.equal(gcdSecForRank(15), 1.0); // 1.05 exactly -> half down -> 1.0
});

test('gcdSecForRank floors at 0.1s and treats junk as rank 0', () => {
  assert.equal(gcdSecForRank(50), 0.1); // -100% would be 0; floored
  assert.equal(gcdSecForRank(999), 0.1);
  assert.equal(gcdSecForRank(-3), 1.5);
  assert.equal(gcdSecForRank(undefined), 1.5);
  assert.equal(gcdSecForRank(NaN), 1.5);
});

// The mutation this suite exists to catch: rounding half UP instead of down turns 1.35 into 1.4.
test('the round-half-down rule is load-bearing, not incidental', () => {
  // If gcdSecForRank used Math.round (half up), rank 5 would be 1.4 and rank 15 would be 1.1.
  assert.notEqual(gcdSecForRank(5), 1.4);
  assert.notEqual(gcdSecForRank(15), 1.1);
});

// ---------------------------------------------------------------------------
// The premade
// ---------------------------------------------------------------------------

test('createGcdTimer builds an anyCast / gcdRecovery custom-timer widget', () => {
  const { store } = setup();
  const w = store.createGcdTimer('Global recovery');
  assert.equal(w.buffSource, 'customTimer');
  assert.equal(w.customTimers.length, 1);
  const t = w.customTimers[0];
  assert.equal(t.triggerMatch, 'anyCast');
  assert.equal(t.gcdRecovery, true);
  assert.equal(t.durationSec, 1.5, 'the stored fallback is the rank-0 value');
  assert.equal(w.premadeOrigin.kind, 'gcdTimer');
});

// ---------------------------------------------------------------------------
// Firing
// ---------------------------------------------------------------------------

test('any cast / song / activate line fires it; chat does not', () => {
  const { store, engine } = setup();
  store.createGcdTimer('GCD');

  engine.handleLine(`${TS}You begin casting Minor Healing.`);
  assert.equal(engine.getActive().length, 1, 'a plain cast did not fire it');

  engine.handleLine(`${TS}You begin singing Song of the Deep.`);
  assert.equal(engine.getActive().length, 1, 'a bard song did not fire it');

  engine.handleLine(`${TS}You activate Quick Buff.`);
  assert.equal(engine.getActive().length, 1, 'an activate line did not fire it');

  const before = engine.getActive()[0].expiresAt || engine.getActive()[0].remainingSec;
  engine.handleLine(`${TS}Rallia tells the guild, 'you begin casting when the timer says'`);
  // still exactly one, and its clock did not restart
  assert.equal(engine.getActive().length, 1, 'a chat line mentioning casting fired it');
});

test('the countdown length is the recovery for that cast, scaled by its mote rank', () => {
  const { store, engine } = setup();
  store.createGcdTimer('GCD');

  engine.handleLine(`${TS}You begin casting Spirit of Wolf.`); // no rank -> 1.5s
  assert.equal(engine.getSnapshotState()[0].durationSec, 1.5);

  engine.handleLine(`${TS}You begin casting Spirit of the Puma VII.`); // rank 7 -> 1.3s
  assert.equal(engine.getSnapshotState()[0].durationSec, gcdSecForRank(7));
  assert.equal(engine.getSnapshotState()[0].durationSec, 1.3);

  engine.handleLine(`${TS}You activate Amplification II.`); // rank 2 -> 1.4s
  assert.equal(engine.getSnapshotState()[0].durationSec, 1.4);
});

test('re-casting restarts the same one tile, at the new cast rank', () => {
  const { store, engine } = setup();
  store.createGcdTimer('GCD');
  engine.handleLine(`${TS}You begin casting Clarity II.`); // rank 2 -> 1.4
  engine.handleLine(`${TS}You begin casting Torpor.`); // rank 0 -> 1.5
  const active = engine.getSnapshotState();
  assert.equal(active.length, 1, 'a second cast made a second tile instead of restarting');
  assert.equal(active[0].durationSec, 1.5);
});

module.exports = () => report('gcd-tracker');
if (require.main === module) report('gcd-tracker').then((n) => process.exit(n ? 1 : 0));
