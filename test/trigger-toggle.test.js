'use strict';
/**
 * Per-trigger on/off, per loadout profile (owner, 16 Oct: "add a toggle to disable triggers, so we
 * can use this one but disable some" + "allow these toggles to be different per profile as well").
 * A trigger's `offInProfiles` lists the profiles it is switched off in; switched off, it keeps every
 * setting but never fires, shows no Reverse "ready" tile, and does not hold up an AND set.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, sanitizeCustomTimers } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const TS = '[Thu Oct 16 10:00:00 2026] ';

function setup() {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const w = store.create('HUD', { buffSource: 'customTimer' });
  store.addCustomTimer(w.id, { name: 'A', durationSec: 60, triggerText: 'a fires' });
  store.addCustomTimer(w.id, { name: 'B', durationSec: 60, triggerText: 'b fires' });
  const idOf = (n) => store.getById(w.id).customTimers.find((t) => t.name === n).id;
  let profile = 'raid';
  const engine = new CustomTimerEngine();
  clearInterval(engine.tickTimer);
  engine.setGetWidgetsFn(() => store.getAll());
  engine.setActiveProfileIdFn(() => profile);
  const say = (...l) => l.forEach((x) => engine.handleLine(TS + x));
  const names = () => engine.getActive().map((t) => t.name).sort();
  return { store, w, idOf, engine, say, names, setProfile: (p) => { profile = p; engine.onProfileChanged(); } };
}

test('switched off in this profile: never fires; another profile still fires it', () => {
  const { store, w, idOf, say, names, setProfile } = setup();
  store.setCustomTimerOff(w.id, idOf('A'), 'raid', true);
  say('a fires', 'b fires');
  assert.deepEqual(names(), ['B']);
  setProfile('solo');
  say('a fires');
  assert.deepEqual(names(), ['A', 'B'], 'on in the solo profile');
});

test('switching to a profile where a running trigger is off drops its tile', () => {
  const { store, w, idOf, say, names, setProfile } = setup();
  store.setCustomTimerOff(w.id, idOf('A'), 'solo', true);
  say('a fires');
  assert.deepEqual(names(), ['A']);
  setProfile('solo');
  assert.deepEqual(names(), [], 'off here - its running tile goes');
});

test('switched off: no Reverse "ready" tile, and an AND set does not wait for it', () => {
  const { store, w, idOf, engine, say, names } = setup();
  store.setReverseDetection(w.id, true);
  store.setCustomTimerOff(w.id, idOf('B'), 'raid', true);
  assert.deepEqual(names(), ['A'], 'only the switched-on trigger shows ready');
  store.setReverseDetection(w.id, false);
  store.addCustomTimer(w.id, { name: 'C', durationSec: 60, triggerText: 'c fires' });
  store.setTriggerCombineMode(w.id, 'and');
  engine.resetTimers(w.id, store.getById(w.id).customTimers.map((t) => t.id));
  say('a fires', 'c fires');
  assert.equal(engine.getActive().length, 1, 'A + C complete the set - B is off and not waited for');
});

test('the store keeps one list per trigger, per profile, and switching back on clears it', () => {
  const { store, w, idOf } = setup();
  store.setCustomTimerOff(w.id, idOf('A'), 'raid', true);
  store.setCustomTimerOff(w.id, idOf('A'), 'solo', true);
  store.setCustomTimerOff(w.id, idOf('A'), 'raid', true); // idempotent
  assert.deepEqual(store.getById(w.id).customTimers.find((t) => t.name === 'A').offInProfiles, ['raid', 'solo']);
  store.setCustomTimerOff(w.id, idOf('A'), 'raid', false);
  store.setCustomTimerOff(w.id, idOf('A'), 'solo', false);
  assert.equal(store.getById(w.id).customTimers.find((t) => t.name === 'A').offInProfiles, undefined);
  assert.equal(store.setCustomTimerOff(w.id, idOf('A'), '', true), null, 'needs a profile');
  const [t] = sanitizeCustomTimers([{ id: 'x', offInProfiles: ['p', 'p', 3, ''] }]);
  assert.deepEqual(t.offInProfiles, ['p']);
  store.setCustomTimerOff(w.id, idOf('B'), 'raid', true);
  const copy = store.importCode(store.exportCode(w.id));
  assert.ok(copy.customTimers.every((x) => x.offInProfiles === undefined), 'a share code carries no local profile ids');
});

test('wiring: the checkbox acts on the ACTIVE profile, resets the aura, and follows profile switches', () => {
  const mainSrc = read('src', 'main', 'main.js');
  assert.ok(mainSrc.includes('withAuraReset(id, () => widgetManager.setCustomTimerOff(id, timerId, profileStore.getActiveId(), !!off))'));
  assert.ok(mainSrc.includes('customTimerEngine.setActiveProfileIdFn(() => profileStore.getActiveId());'));
  assert.match(mainSrc, /function activateProfile\(id\) \{[\s\S]*?customTimerEngine\.onProfileChanged\(\);/);
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(renderer, /timer\.offInProfiles\.includes\(currentActiveProfileId\)/);
  assert.match(renderer, /setWidgetTriggerOff\(widget\.id, timer\.id, !onBox\.checked\)/);
});

module.exports = () => report('trigger-toggle');
if (require.main === module) report('trigger-toggle').then((n) => process.exit(n ? 1 : 0));
