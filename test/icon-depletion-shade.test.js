'use strict';
/**
 * QOL #46 - a shrinking depletion shade over icon-mode buff tiles, reusing the two looks the
 * action bars already use for cooldowns ('wipe' = top-down clip, 'radial' = conic clock sweep).
 *
 * updateTileShade() in overlay.js is pure apart from touching one element's .style and reading the
 * module-level currentConfig, so it is lifted out and run against a fake element - the same trick
 * merged-tiles.test.js uses. The wiring (store field, IPC, preload, panel control) is checked
 * structurally.
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

/** Lift updateTileShade() out of overlay.js with a settable currentConfig. */
function loadShade() {
  const m = overlaySrc.match(/function updateTileShade\(ref, buff\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'updateTileShade has been renamed or restructured');
  // eslint-disable-next-line no-new-func
  return new Function(
    `let currentConfig = {};
     ${m[0]}
     return { updateTileShade, setConfig: (c) => { currentConfig = c; } };`
  )();
}

const fakeRef = () => ({ shadeEl: { style: { display: '', background: '', clipPath: '' } } });
const dur = (durationSec, remainingSec, extra) => ({ durationSec, remainingSec, ...extra });

// ---------------------------------------------------------------------------
// behaviour
// ---------------------------------------------------------------------------

test("'none' keeps the shade hidden", () => {
  const S = loadShade();
  S.setConfig({ iconDepletionShade: 'none' });
  const ref = fakeRef();
  S.updateTileShade(ref, dur(100, 50));
  assert.equal(ref.shadeEl.style.display, 'none');
});

test("'wipe' clips away the elapsed portion from the top, leaving the remainder pinned to the bottom", () => {
  const S = loadShade();
  S.setConfig({ iconDepletionShade: 'wipe' });
  const ref = fakeRef();
  S.updateTileShade(ref, dur(100, 25)); // 25% left
  assert.equal(ref.shadeEl.style.display, '');
  assert.equal(ref.shadeEl.style.clipPath, 'inset(75% 0 0 0)');
  assert.match(ref.shadeEl.style.background, /rgba\(0, 0, 0/);
});

test("'radial' sweeps a wedge proportional to time remaining", () => {
  const S = loadShade();
  S.setConfig({ iconDepletionShade: 'radial' });
  const ref = fakeRef();
  S.updateTileShade(ref, dur(100, 50)); // half left -> 180deg
  assert.match(ref.shadeEl.style.background, /conic-gradient\(rgba\(0, 0, 0, [0-9.]+\) 180deg/);
  assert.equal(ref.shadeEl.style.clipPath, 'none');
});

test('an infinite buff, a damage-meter row, and a zero-duration entry all get no shade', () => {
  const S = loadShade();
  S.setConfig({ iconDepletionShade: 'wipe' });
  for (const buff of [dur(100, 50, { infinite: true }), dur(100, 50, { valueText: '1.2M' }), dur(0, 0), { remainingSec: 5 }]) {
    const ref = fakeRef();
    S.updateTileShade(ref, buff);
    assert.equal(ref.shadeEl.style.display, 'none', JSON.stringify(buff));
  }
});

test('the fraction is clamped - a buff somehow past its own duration does not over-clip', () => {
  const S = loadShade();
  S.setConfig({ iconDepletionShade: 'wipe' });
  const ref = fakeRef();
  S.updateTileShade(ref, dur(100, 140));
  assert.equal(ref.shadeEl.style.clipPath, 'inset(0% 0 0 0)');
});

// ---------------------------------------------------------------------------
// store
// ---------------------------------------------------------------------------

test('WidgetStore normalises iconDepletionShade: default none, wipe/radial kept, junk rejected', () => {
  const raw = [
    { id: 'a', name: 'A', kind: 'self-buffs-builtin' },
    { id: 'b', name: 'B', kind: 'self-buffs-builtin', iconDepletionShade: 'wipe' },
    { id: 'c', name: 'C', kind: 'self-buffs-builtin', iconDepletionShade: 'radial' },
    { id: 'd', name: 'D', kind: 'self-buffs-builtin', iconDepletionShade: 'sideways' },
  ];
  const store = new WidgetStore({
    loadJson: (key) => (key === 'widgets' ? { version: 99, widgets: JSON.parse(JSON.stringify(raw)) } : null),
    saveJson: () => {},
  });
  const by = Object.fromEntries(store.getAll().map((w) => [w.id, w.iconDepletionShade]));
  assert.equal(by.a, 'none');
  assert.equal(by.b, 'wipe');
  assert.equal(by.c, 'radial');
  assert.equal(by.d, 'none');
});

// ---------------------------------------------------------------------------
// wiring
// ---------------------------------------------------------------------------

test('the setting is wired end to end', () => {
  assert.match(html, /id="widget-icon-depletion-select"/);
  assert.ok(html.includes('value="wipe"') && html.includes('value="radial"'));
  assert.match(rendererSrc, /setWidgetIconDepletionShade\(selectedId, iconDepletionSelect\.value\)/);
  assert.match(rendererSrc, /iconDepletionSelect\.value = widget\.iconDepletionShade \|\| 'none'/);
  assert.match(preloadSrc, /setWidgetIconDepletionShade: \(id, value\) =>/);
  assert.match(mainSrc, /widget:setIconDepletionShade/);
  assert.match(managerSrc, /function setIconDepletionShade\(id, value\)/);
  assert.match(overlayCss, /\.tile-shade\s*\{/);
  // it lives inside the icon-only settings block, so it only shows in icon mode
  const iconBlock = html.slice(html.indexOf('id="widget-display-icon-only-settings"'), html.indexOf('id="widget-ally-grouping-settings"'));
  assert.ok(iconBlock.includes('widget-icon-depletion-select'), 'the control must sit in the icon-only settings block');
});

module.exports = () => report('icon-depletion-shade');
if (require.main === module) report('icon-depletion-shade').then((n) => process.exit(n ? 1 : 0));
