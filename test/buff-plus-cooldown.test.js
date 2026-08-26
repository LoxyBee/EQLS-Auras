'use strict';
/**
 * "Also track when it's ready to cast again" (25 Aug) - the Buff timer panel's own toggle for a
 * spell that has both a real buff duration AND a real recast time. One tile: it counts down the
 * buff's own active time first, then rolls straight into the recast cooldown without resetting -
 * reusing note 10's existing two-phase 'duration'->'cooldown' mechanism in customTimerEngine.js,
 * not a new engine feature. widgetStore.createCooldownTimer grew one new optional parameter
 * (buffDurationSec) to build this; omitted, it is byte-identical to the plain Cooldown timer
 * premade that already existed.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const mainSrc = read('src', 'main', 'main.js');
const managerSrc = read('src', 'main', 'widgetManager.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const html = read('src', 'renderer', 'main-window', 'index.html');

const TS = '[Wed Aug 19 19:17:52 2026] ';

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

// ---------------------------------------------------------------------------
// widgetStore.createCooldownTimer's new optional parameter
// ---------------------------------------------------------------------------

test('without buffDurationSec, createCooldownTimer is unchanged - single phase, no cooldownSec field', () => {
  const store = newStore();
  const widget = store.createCooldownTimer('Cannibalize', { spellName: 'Cannibalize', cooldownSec: 30 });
  const [timer] = widget.customTimers;
  assert.equal(timer.durationSec, 30);
  assert.equal(timer.cooldownSec, undefined, 'a plain cooldown timer must not carry a phantom cooldownSec');
});

test('with buffDurationSec, the trigger gets the buff\'s own duration AND a real cooldownSec', () => {
  const store = newStore();
  const widget = store.createCooldownTimer('Alacrity', {
    spellName: 'Alacrity',
    cooldownSec: 45,
    buffDurationSec: 492,
  });
  const [timer] = widget.customTimers;
  assert.equal(timer.durationSec, 492, 'should count the buff\'s own active time first');
  assert.equal(timer.cooldownSec, 45, 'should roll into the recast time after that');
  assert.equal(timer.triggerMatch, 'castOf');
  assert.equal(timer.triggerText, 'Alacrity');
});

test('premadeOrigin records buffDurationSec too, so "Reset to default" can rebuild the same shape', () => {
  const store = newStore();
  const widget = store.createCooldownTimer('Alacrity', {
    spellName: 'Alacrity',
    cooldownSec: 45,
    buffDurationSec: 492,
  });
  assert.deepEqual(widget.premadeOrigin, {
    kind: 'cooldownTimer',
    spellName: 'Alacrity',
    cooldownSec: 45,
    buffDurationSec: 492,
    iconId: undefined,
  });
});

// ---------------------------------------------------------------------------
// End to end through the real engine - the phase actually rolls
// ---------------------------------------------------------------------------

test('casting the spell counts the buff duration, then rolls into the cooldown without resetting', () => {
  const store = newStore();
  store.createCooldownTimer('Alacrity', { spellName: 'Alacrity', cooldownSec: 10, buffDurationSec: 5 });
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer);

  engine.handleLine(`${TS}You begin casting Alacrity.`);
  let [active] = engine.getActive();
  assert.equal(active.phase, 'duration');
  assert.equal(active.durationSec, 5);

  for (const t of engine.activeTimers.values()) t.expiresAt = Date.now() - 1;
  engine._tick();
  [active] = engine.getActive();
  assert.equal(active.phase, 'cooldown', 'should have rolled into the cooldown, not ended');
  assert.equal(active.remainingSec, 10);

  for (const t of engine.activeTimers.values()) t.expiresAt = Date.now() - 1;
  engine._tick();
  assert.equal(engine.getActive().length, 0, 'should be gone once the cooldown itself finishes');
});

// ---------------------------------------------------------------------------
// The panel wiring
// ---------------------------------------------------------------------------

test('the toggle row and checkbox exist in the markup, next to the source radios', () => {
  assert.match(html, /id="buff-timer-also-cooldown-row"/);
  assert.match(html, /id="buff-timer-also-cooldown-checkbox"/);
});

test('the row is only synced to show for buff mode, a spell with recast data, and "Yourself"', () => {
  const fn = rendererSrc.match(/function syncBuffTimerAlsoCooldownRow\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'syncBuffTimerAlsoCooldownRow has been renamed or restructured');
  assert.match(fn[1], /buffTimerMode === 'buff'/);
  assert.match(fn[1], /!!buffTimerCooldownMatch/);
  assert.match(fn[1], /source === 'self'/);
});

test('picking a spell in buff mode cross-references it against the recast-time list by name', () => {
  assert.match(
    rendererSrc,
    /buffTimerCooldownMatch = castableBuffs\.find\(\(b\) => b\.name === buff\.name\) \|\| null;/
  );
});

test('the create button builds a two-phase cooldown timer only when the checkbox is actually checked', () => {
  const handler = rendererSrc.match(/buffTimerCreateBtn\.addEventListener\('click', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(handler, 'the create-button handler has been restructured');
  assert.match(handler[1], /source === 'self' && buffTimerCooldownMatch && buffTimerAlsoCooldownCheckbox\.checked/);
  assert.match(handler[1], /createCooldownTimerWidget\(/);
  assert.match(handler[1], /buffTimerChoice\.durationSec/, 'the buff\'s own duration must be passed through as the fifth argument');
});

test('the IPC round-trip carries buffDurationSec end to end', () => {
  assert.match(
    preloadSrc,
    /createCooldownTimerWidget: \(name, spellName, cooldownSec, iconId, buffDurationSec\) =>/,
    'preload bridge dropped the new parameter'
  );
  assert.match(
    mainSrc,
    /ipcMain\.handle\('widget:createCooldownTimer', \(_event, \{ name, spellName, cooldownSec, iconId, buffDurationSec \}\) =>/,
    'main.js IPC handler dropped the new parameter'
  );
  assert.match(
    managerSrc,
    /function createCooldownTimerWidget\(name, spellName, cooldownSec, iconId, buffDurationSec\) \{/,
    'widgetManager dropped the new parameter'
  );
});

module.exports = () => report('buff-plus-cooldown');
if (require.main === module) report('buff-plus-cooldown').then((n) => process.exit(n ? 1 : 0));
