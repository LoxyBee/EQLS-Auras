'use strict';
/**
 * Whole-aura Scale - one multiplier on top of icon size / row size / text size (owner, 6 Sep:
 * "one slider that scales icon + list + text together"). Set from a slider, or by dragging the
 * edge of the unlocked aura on screen (which used to just make an empty bigger box).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, clampScale } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

test('clampScale: default 1, clamp 0.3..3 (matches the slider), junk -> 1', () => {
  assert.equal(clampScale(undefined), 1);
  assert.equal(clampScale('x'), 1);
  assert.equal(clampScale(0), 1);
  assert.equal(clampScale(-2), 1);
  assert.equal(clampScale(0.1), 0.3);
  assert.equal(clampScale(9), 3);
  assert.equal(clampScale(1.5), 1.5);
});

test('a fresh aura is scale 1, it is in SHAREABLE_FIELDS (at the end), and a bad stored value clamps', () => {
  const store = newStore();
  const w = store.create('T', { buffSource: 'self' });
  assert.equal(w.scale, 1);
  const ws = read('src', 'main', 'widgetStore.js');
  assert.match(ws, /'dynamicChatTimer',\n\s*'scale',\n/);
  store.update(w.id, { scale: 99 });
  const data = store.store.loadJson('widgets', null);
  const store2 = new WidgetStore({ loadJson: (n, f) => (n === 'widgets' ? data : f), saveJson: () => {} });
  assert.equal(store2.getById(w.id).scale, 3);
});

test('the overlay multiplies every size read by the aura scale', () => {
  const o = read('src', 'renderer', 'overlay', 'overlay.js');
  assert.match(o, /function scaled\(px\)/);
  assert.match(o, /Math\.round\(n \* auraScale\(\)\)/);
  // the CSS vars
  assert.match(o, /'--text-size', `\$\{scaled\(config\.textSize \|\| 13\)\}px`/);
  assert.match(o, /'--icon-size', `\$\{scaled\(config\.iconSize \|\| 46\)\}px`/);
  assert.match(o, /'--row-size', `\$\{scaled\(config\.rowSize \|\| 28\)\}px`/);
  // list width and the icon-grid width estimate
  assert.match(o, /contentWrap\.style\.width = `\$\{scaled\(config\.listWidth \|\| 220\)\}px`/);
  assert.match(o, /const iconSize = scaled\(config\.iconSize \|\| 46\)/);
});

test('dragging the unlocked box is a damped pixel-rate scale change, not a raw ratio', () => {
  const m = read('src', 'main', 'widgetManager.js');
  const h = m.slice(m.indexOf("win.on('resized'"), m.indexOf("win.on('resized'") + 1600);
  assert.match(h, /if \(isUnlocked\(config\.id\)\)/);
  // a FIXED px-per-unit rate, so a short (36px) box doesn't jump on a tiny drag
  assert.match(m, /const SCALE_DRAG_PX_PER_UNIT = 500/);
  assert.match(h, /const delta = dPx \/ SCALE_DRAG_PX_PER_UNIT/);
  assert.match(h, /clampScale\(\(cur && cur\.scale \? cur\.scale : 1\) \+ delta\)/);
  assert.match(h, /widgetStore\.update\(config\.id, \{ scale: next \}\)/);
  // the reference is seeded on unlock so the first drag has something to measure against
  assert.match(m, /resizeRefByWidget\.set\(id, \{ w, h \}\)/);
  // the store clamp and the slider max agree - the drag can't push past 300%
  assert.match(read('src', 'main', 'widgetStore.js'), /Math\.min\(3, n\)/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="widget-scale-slider"[^>]*max="300"/);
});

test('the Scale slider is wired: settings panel, populate, IPC, preload', () => {
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="widget-scale-slider"[^>]*min="30"[^>]*max="300"/);
  const r = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(r, /scaleSlider\.value = String\(pct\)/);
  assert.match(r, /window\.eqTracker\.setWidgetScale\(selectedId, pct \/ 100\)/);
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('widget:setScale'/);
  assert.match(read('src', 'preload', 'preload-main.js'), /setWidgetScale: \(id, scale\) => ipcRenderer\.invoke\('widget:setScale'/);
});

module.exports = () => report('aura-scale');
if (require.main === module) report('aura-scale').then((n) => process.exit(n ? 1 : 0));
