'use strict';
/**
 * Three fixes from the 15 Oct review (owner picked them by number):
 *   1. Editing an aura's triggers resets its running tiles - a running tile used to keep the
 *      duration / cooldown / mode it STARTED with, so an edit "didn't work, then worked after a
 *      restart" (Crip's report).
 *   2. The buff engine's cast-confirm timer can't crash the main process - it runs outside
 *      main.js's per-listener try/catch.
 *   4. A trigger's Cooldown can run up to 3 hours (Lay on Hands is 70 minutes; the old shared
 *      60-minute cap brought it back 10 minutes early). Durations keep their 60-minute cap.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, sanitizeCustomTimers } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const TS = '[Wed Oct 15 10:00:00 2026] ';

function setup() {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const engine = new CustomTimerEngine();
  clearInterval(engine.tickTimer);
  engine.setGetWidgetsFn(() => store.getAll());
  return { store, engine, names: () => engine.getActive().map((t) => t.name).sort() };
}

// ---------------------------------------------------------------- 1. reset on trigger edits

test('resetTimers clears only the edited aura\'s running tiles', () => {
  const { store, engine, names } = setup();
  const a = store.create('A', { buffSource: 'customTimer' });
  const b = store.create('B', { buffSource: 'customTimer' });
  store.addCustomTimer(a.id, { name: 'A1', durationSec: 60, triggerText: 'a one' });
  store.addCustomTimer(b.id, { name: 'B1', durationSec: 60, triggerText: 'b one' });
  engine.handleLine(`${TS}a one`);
  engine.handleLine(`${TS}b one`);
  assert.deepEqual(names(), ['A1', 'B1']);
  engine.resetTimers(a.id, store.getById(a.id).customTimers.map((t) => t.id));
  assert.deepEqual(names(), ['B1']);
});

test('after an edit, the next trigger uses the NEW cooldown (the "worked after a restart" bug)', () => {
  const { store, engine } = setup();
  const w = store.create('HUD', { buffSource: 'customTimer' });
  store.addCustomTimer(w.id, { name: 'Mend', durationSec: 0, triggerText: 'You mend your wounds', triggerMatch: 'contains', cooldownSec: 3600 });
  store.setTriggerDurationSec(w.id, 0);
  const id = store.getById(w.id).customTimers[0].id;
  const realNow = Date.now;
  const t0 = realNow();
  try {
    Date.now = () => t0;
    engine.handleLine(`${TS}You mend your wounds and heal.`);
    Date.now = () => t0 + 1000;
    engine._tick();
    // The fix the main process makes on every trigger edit:
    store.updateCustomTimer(w.id, id, { ...store.getById(w.id).customTimers[0], cooldownSec: 60 });
    engine.resetTimers(w.id, [id]);
    engine.handleLine(`${TS}You mend your wounds and heal.`);
    Date.now = () => t0 + 2000;
    engine._tick();
    const [tile] = engine.getActive();
    assert.equal(tile.phase, 'cooldown');
    assert.equal(tile.durationSec, 60, 'the edited cooldown, not the 60-minute one it started with');
  } finally { Date.now = realNow; }
});

test('a deleted trigger\'s tile and an AND/OR combo tile are reset too', () => {
  const { store, engine, names } = setup();
  const w = store.create('Combo', { buffSource: 'customTimer' });
  store.addCustomTimer(w.id, { name: 'X', durationSec: 60, triggerText: 'x thing' });
  store.addCustomTimer(w.id, { name: 'Y', durationSec: 60, triggerText: 'y thing' });
  store.setTriggerCombineMode(w.id, 'or');
  engine.handleLine(`${TS}x thing`);
  assert.equal(engine.getActive().length, 1);
  engine.resetTimers(w.id, []); // even with no ids, the combo key belongs to the aura
  assert.deepEqual(names(), []);

  store.setTriggerCombineMode(w.id, 'independent');
  engine.handleLine(`${TS}x thing`);
  const before = store.getById(w.id).customTimers.map((t) => t.id);
  store.removeCustomTimer(w.id, before[0]);
  engine.resetTimers(w.id, before); // main.js passes the ids from BEFORE the change too
  assert.deepEqual(names(), [], 'a deleted trigger must not leave its tile running');
});

test('wiring: every trigger-changing handler goes through withAuraReset', () => {
  const mainSrc = read('src', 'main', 'main.js');
  for (const ch of ['addCustomTimer', 'updateCustomTimer', 'removeCustomTimer', 'setTriggerDurationSec',
    'setTriggerCombineMode', 'setReverseDetection', 'setDynamicChatTimer']) {
    const at = mainSrc.indexOf(`'widget:${ch}'`);
    assert.ok(at >= 0, ch);
    const handler = mainSrc.slice(at, mainSrc.indexOf('\n', mainSrc.indexOf(`widgetManager.${ch}(`, at)));
    assert.ok(handler.includes('withAuraReset(id, () =>'), `widget:${ch} must reset the aura's running tiles`);
  }
  assert.ok(mainSrc.includes('customTimerEngine.resetTimers(widgetId, [...before, ...triggerIdsOf(widgetId)]);'));
});

// ---------------------------------------------------------------- 2. cast-confirm timer is contained

test('an error while confirming a timed-out cast is logged, not thrown into the main process', () => {
  const data = {};
  const store = {
    loadJson: (k, f) => (k in data ? JSON.parse(JSON.stringify(data[k])) : f),
    saveJson: (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); },
  };
  const buffStore = new BuffStore(store);
  buffStore.upsert('Textless Ward', 600, {}); // no landing text -> the timeout CONFIRMS the cast
  const engine = new BuffEngine(buffStore, store);
  engine.stop();
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  const realSetTimeout = global.setTimeout;
  let fire = null;
  global.setTimeout = (fn) => { fire = fn; return 0; };
  try {
    engine.handleLine(`${TS}You begin casting Textless Ward.`);
  } finally { global.setTimeout = realSetTimeout; }
  assert.ok(fire, 'the confirm timer was armed');
  engine._onBuffLanded = () => { throw new Error('boom'); };
  assert.doesNotThrow(() => fire());
  assert.equal(engine.pendingCast, null);
  assert.ok(log.some((l) => l.includes('ERROR confirming pending cast') && l.includes('boom')));
});

// ---------------------------------------------------------------- 4. 3-hour cooldown cap

test('a trigger\'s Cooldown keeps up to 3 hours (Lay on Hands, 70 min); durations stay capped at 60', () => {
  const { store, engine } = setup();
  const w = store.create('HUD', { buffSource: 'customTimer' });
  store.addCustomTimer(w.id, { name: 'Lay on Hands', durationSec: 0, triggerText: 'lay hands', cooldownSec: 4200 });
  store.addCustomTimer(w.id, { name: 'Huge', durationSec: 0, triggerText: 'huge', cooldownSec: 99999 });
  store.setTriggerDurationSec(w.id, 0);
  const [loh, huge] = store.getById(w.id).customTimers;
  assert.equal(loh.cooldownSec, 4200);
  assert.equal(huge.cooldownSec, 10800, 'capped at 3 hours');
  assert.equal(sanitizeCustomTimers([{ id: 'x', cooldownSec: 4200, durationSec: 9999 }])[0].cooldownSec, 4200);
  assert.equal(sanitizeCustomTimers([{ id: 'x', durationSec: 9999 }])[0].durationSec, 3600, 'durations unchanged');
  const realNow = Date.now;
  const t0 = realNow();
  try {
    Date.now = () => t0;
    engine.handleLine(`${TS}lay hands`);
    Date.now = () => t0 + 1000;
    engine._tick();
    const [tile] = engine.getActive();
    assert.equal(tile.durationSec, 4200);
    assert.ok(tile.remainingSec > 3600, 'counts the full 70 minutes, not 60');
  } finally { Date.now = realNow; }
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="widget-new-timer-cooldown-min" min="0" max="180"/);
});

module.exports = () => report('aura-edit-reset');
if (require.main === module) report('aura-edit-reset').then((n) => process.exit(n ? 1 : 0));
