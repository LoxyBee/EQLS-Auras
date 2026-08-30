'use strict';
/**
 * Backlog #12 - auras/timers stop when the player dies.
 *
 * "You have been slain by <x>!" is the player's own death. The game strips every buff and song at
 * that point; if you rez you come back with none unless something restores them, and those
 * re-register like any other landing. So the engines clear:
 *   - BuffEngine: activeBuffs (self), bardSongs (on you), any pending cast
 *   - CustomTimerEngine: every active timer EXCEPT one in its recast cooldown phase - a cooldown
 *     keeps ticking whether you are alive or not
 * and NOT: allyBuffs (a buff on a living groupmate), enemy debuffs (on a mob).
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const TS = '[Wed Aug 19 20:15:02 2026] ';
const DEATH = `${TS}You have been slain by a goblin!`;

function makeBuffEngine() {
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

// A roster buff whose landing text belongs to it alone, so a bare landing line starts its timer.
function uniqueLandingBuff(buffStore) {
  const counts = new Map();
  for (const e of buffStore.getAll()) {
    if (!e.landingText) continue;
    counts.set(e.landingText, (counts.get(e.landingText) || 0) + 1);
  }
  return buffStore.getAll().find(
    (e) => e.landingText && counts.get(e.landingText) === 1 && (e.durationSec > 0 || e.infiniteDuration)
  );
}

test('death clears active self buffs', () => {
  const { engine, buffStore } = makeBuffEngine();
  const buff = uniqueLandingBuff(buffStore);
  assert.ok(buff, 'no uniquely-landing buff in the roster to test with');
  engine.handleLine(TS + buff.landingText);
  assert.equal(engine.getActiveBuffs().length, 1, 'the buff did not start');

  engine.handleLine(DEATH);
  assert.equal(engine.getActiveBuffs().length, 0, 'the self buff survived death');
});

test('death clears a pending cast', () => {
  const { engine, buffStore } = makeBuffEngine();
  const spell = buffStore.getAll().find((e) => e.landingText && (e.durationSec > 0 || e.infiniteDuration));
  engine.handleLine(`${TS}You begin casting ${spell.name}.`);
  engine.handleLine(DEATH);
  assert.equal(engine.pendingCast, null, 'a pending cast survived death - its confirm timer would fire on a corpse');
});

test('death also clears bard songs on the player', () => {
  const { engine, buffStore } = makeBuffEngine();
  const song = buffStore.getAll().find((e) => e.isBardSong && e.landingText);
  if (song) {
    engine.handleLine(`${TS}You begin singing ${song.name}.`);
    engine.handleLine(TS + song.landingText);
  }
  // Whether or not a song landed, death must leave the songs map empty.
  engine.handleLine(DEATH);
  assert.equal(engine.getActiveBardSongs().length, 0);
});

test('a MOB dying does NOT clear the player\'s buffs', () => {
  const { engine, buffStore } = makeBuffEngine();
  const buff = uniqueLandingBuff(buffStore);
  engine.handleLine(TS + buff.landingText);
  engine.handleLine(`${TS}A goblin has been slain by Shara!`);
  assert.equal(engine.getActiveBuffs().length, 1, 'a mob death wrongly cleared a self buff');
  engine.handleLine(`${TS}You have slain a goblin!`);
  assert.equal(engine.getActiveBuffs().length, 1, 'killing a mob wrongly cleared a self buff');
});

// --- custom timers ---------------------------------------------------------

function makeTimerEngine() {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer);
  engine.setDebugLogFn(() => {});
  return { store, engine };
}

test('death clears active custom timers, but not one in its recast cooldown', () => {
  const { store, engine } = makeTimerEngine();
  const w = store.create('T', { buffSource: 'customTimer' });
  store.addCustomTimer(w.id, { name: 'On a line', durationSec: 30, triggerText: 'you feel the power', triggerMatch: 'contains' });
  engine.handleLine(`${TS}You feel the power surge through you.`);
  assert.equal(engine.getActive().length, 1, 'the timer did not fire');

  // A separate timer sitting in its cooldown phase.
  engine.activeTimers.set('cd', { id: 'cd', name: 'Recast', phase: 'cooldown', durationSec: 60, expiresAt: Date.now() + 60000 });

  engine.handleLine(DEATH);

  assert.ok(engine.activeTimers.has('cd'), 'a recast cooldown was wrongly cleared by death');
  assert.equal(
    [...engine.activeTimers.values()].filter((t) => t.phase !== 'cooldown').length, 0,
    'a non-cooldown timer survived death'
  );
});

module.exports = () => report('death-clears');
if (require.main === module) report('death-clears').then((n) => process.exit(n ? 1 : 0));
