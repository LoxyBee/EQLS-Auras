'use strict';
/**
 * QOL #47 - fade the timer text through amber as a buff runs down, a readable heads-up before the
 * binary red expiring-soon flash. Builds on the existing per-aura lowTimeThresholdSec: amber runs
 * from 2x the threshold down to the threshold, then `.low` takes over with red + pulse.
 *
 * rampColorFor() in overlay.js is pure apart from reading currentConfig, so it is lifted out and
 * run. The wiring is checked structurally.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const overlayCss = read('src', 'renderer', 'overlay', 'overlay.css');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');
const mainSrc = read('src', 'main', 'main.js');
const managerSrc = read('src', 'main', 'widgetManager.js');

function loadRamp() {
  const m = overlaySrc.match(/function rampColorFor\(buff, low, isZeroDurationPing, threshold\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'rampColorFor has been renamed or restructured');
  // eslint-disable-next-line no-new-func
  return new Function(
    `let currentConfig = {};
     ${m[0]}
     return { rampColorFor, setConfig: (c) => { currentConfig = c; } };`
  )();
}

const buff = (remainingSec, extra) => ({ remainingSec, ...extra });

test('off by default - no ramp colour even deep in the danger zone', () => {
  const R = loadRamp();
  R.setConfig({});
  assert.equal(R.rampColorFor(buff(5), false, false, 30), null);
});

test('with the ramp on: normal above 2x threshold, amber between, null (red takes over) at/under threshold', () => {
  const R = loadRamp();
  R.setConfig({ timerColorRamp: true });
  assert.equal(R.rampColorFor(buff(90), false, false, 30), null, 'well above 2x -> normal colour');
  assert.equal(R.rampColorFor(buff(45), false, false, 30), '#ffbe4d', 'between threshold and 2x -> amber');
  assert.equal(R.rampColorFor(buff(60), false, false, 30), '#ffbe4d', 'exactly 2x -> amber');
  assert.equal(R.rampColorFor(buff(20), true, false, 30), null, 'low is passed true -> red wins, no amber');
});

test('never ramps something without a real countdown', () => {
  const R = loadRamp();
  R.setConfig({ timerColorRamp: true });
  assert.equal(R.rampColorFor(buff(10, { infinite: true }), false, false, 30), null);
  assert.equal(R.rampColorFor(buff(10, { valueText: '1.2M' }), false, false, 30), null);
  assert.equal(R.rampColorFor(buff(10), false, true, 30), null, 'zero-duration ping');
  assert.equal(R.rampColorFor(buff(10), false, false, 0), null, 'flash threshold off -> ramp off too');
  assert.equal(R.rampColorFor({ remainingSec: null }, false, false, 30), null);
});

test('WidgetStore normalises timerColorRamp to a boolean, default false', () => {
  const raw = [
    { id: 'a', name: 'A', kind: 'self-buffs-builtin' },
    { id: 'b', name: 'B', kind: 'self-buffs-builtin', timerColorRamp: true },
    { id: 'c', name: 'C', kind: 'self-buffs-builtin', timerColorRamp: 'yes' },
  ];
  const store = new WidgetStore({
    loadJson: (key) => (key === 'widgets' ? { version: 99, widgets: JSON.parse(JSON.stringify(raw)) } : null),
    saveJson: () => {},
  });
  const by = Object.fromEntries(store.getAll().map((w) => [w.id, w.timerColorRamp]));
  assert.equal(by.a, false);
  assert.equal(by.b, true);
  assert.equal(by.c, true);
});

test('the toggle is wired end to end', () => {
  assert.match(html, /id="widget-timer-color-ramp-checkbox"/);
  assert.match(rendererSrc, /setWidgetTimerColorRamp\(selectedId, timerColorRampCheckbox\.checked\)/);
  assert.match(rendererSrc, /timerColorRampCheckbox\.checked = !!widget\.timerColorRamp/);
  assert.match(preloadSrc, /setWidgetTimerColorRamp: \(id, enabled\) =>/);
  assert.match(mainSrc, /widget:setTimerColorRamp/);
  assert.match(managerSrc, /function setTimerColorRamp\(id, enabled\)/);
  // list mode clears the inline override with '' so CSS (incl. the red .low rule) still wins
  assert.match(overlaySrc, /ref\.timeEl\.style\.color = rampAmber \|\| ''/);
  assert.ok(overlayCss.includes('.buff-row.low .time'));
});

module.exports = () => report('timer-color-ramp');
if (require.main === module) report('timer-color-ramp').then((n) => process.exit(n ? 1 : 0));
