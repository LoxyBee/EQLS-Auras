'use strict';
/**
 * Per-aura sound cooldown - config.soundCooldownSec (reported live 30 Aug).
 *
 * The shortest gap allowed between two alert sounds from one aura, across ALL of its sound kinds.
 * 0 = off. Ceiling 60s. Built for something that refreshes constantly - a bard song pulsing every
 * 6s set to only sound every 24, say. Distinct from overlay.js's fixed 200ms per-kind
 * anti-double-fire guard: this one is a deliberate, user-set, cross-kind throttle.
 *
 * The owner's framing: this replaces the never-built "looping sound" aura type - the same effect
 * is now reachable with an ordinary sound plus this cooldown.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, clampSoundCooldownSec } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

test('clampSoundCooldownSec: 0..60, rounds, junk -> 0', () => {
  assert.equal(clampSoundCooldownSec(0), 0);
  assert.equal(clampSoundCooldownSec(24), 24);
  assert.equal(clampSoundCooldownSec(60), 60);
  assert.equal(clampSoundCooldownSec(90), 60, 'above the ceiling clamps to 60');
  assert.equal(clampSoundCooldownSec(-5), 0);
  assert.equal(clampSoundCooldownSec(12.6), 13);
  assert.equal(clampSoundCooldownSec('nonsense'), 0);
  assert.equal(clampSoundCooldownSec(undefined), 0);
});

test('a new aura has the cooldown off, and it round-trips through the store', () => {
  const store = newStore();
  const w = store.create('Songs');
  assert.equal(w.soundCooldownSec, 0);

  store.update(w.id, { soundCooldownSec: 24 });
  // A fresh WidgetStore over the same backend re-runs normalize on load - the value has to survive
  // that, and it has to be a persisted field or the restart forgets it.
  const back = new WidgetStore(store.store).getById(w.id);
  assert.equal(back.soundCooldownSec, 24);
});

test('normalize clamps a stored out-of-range value', () => {
  const data = { widgets: { widgets: [{ id: 'x', name: 'Loud', soundCooldownSec: 999 }] } };
  const store = new WidgetStore({
    loadJson: (n, f) => (n === 'widgets' ? JSON.parse(JSON.stringify(data.widgets)) : f),
    saveJson: () => {},
  });
  assert.equal(store.getById('x').soundCooldownSec, 60);
});

test('it is wired end to end', () => {
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('widget:setSoundCooldownSec'/);
  assert.match(read('src', 'main', 'widgetManager.js'), /function setSoundCooldownSec/);
  assert.match(read('src', 'preload', 'preload-main.js'), /setWidgetSoundCooldownSec:/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="widget-sound-cooldown-slider"/);
  assert.match(read('src', 'renderer', 'main-window', 'main-window.js'), /setWidgetSoundCooldownSec\(selectedId/);
  // soundCooldownSec must be a persisted field or a restart forgets it.
  assert.match(read('src', 'main', 'widgetStore.js'), /'soundCooldownSec',/);
});

test('the overlay gate throttles across kinds, and bails before anything is played', () => {
  const src = read('src', 'renderer', 'overlay', 'overlay.js');
  const fn = src.slice(src.indexOf('function playAlertSound('), src.indexOf('function playAlertSound(') + 1400);
  assert.match(fn, /currentConfig\.soundCooldownSec/, 'the gate does not read the per-aura value');
  assert.match(fn, /lastAnyAlertAt/, 'no shared cross-kind timestamp');
  // The bail (`... return;`) must come before the play calls AND before the debug "SOUND" log line
  // that only fires for a sound that actually plays.
  const gateReturn = fn.search(/lastAnyAlertAt < cooldownMs\) return;/);
  const played = fn.search(/playCustomSound|beep\(|SOUND \$\{kind\}/);
  assert.ok(gateReturn !== -1, 'the cooldown bail is missing');
  assert.ok(gateReturn < played, 'the cooldown check must come before any sound is made');
});

module.exports = () => report('sound-cooldown');
if (require.main === module) report('sound-cooldown').then((n) => process.exit(n ? 1 : 0));
