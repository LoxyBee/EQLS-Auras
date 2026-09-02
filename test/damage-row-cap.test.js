'use strict';
/**
 * Damage meter "Show at most N rows" (owner's ask, default 6). The engine sends every attacker row
 * sorted biggest-first; the overlay keeps the top N, and never counts the Total row against the
 * cap. Clamp 1..20.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, clampDamageRowCap } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const managerSrc = read('src', 'main', 'widgetManager.js');
const htmlSrc = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

test('clampDamageRowCap: default 6, clamp 1..20, junk -> 6', () => {
  assert.equal(clampDamageRowCap(undefined), 6);
  assert.equal(clampDamageRowCap('x'), 6);
  assert.equal(clampDamageRowCap(0), 1);
  assert.equal(clampDamageRowCap(-3), 1);
  assert.equal(clampDamageRowCap(50), 20);
  assert.equal(clampDamageRowCap(4), 4);
  assert.equal(clampDamageRowCap(4.6), 5);
});

test('a fresh damage meter defaults to 6, and normalizeWidget clamps a stored bad value', () => {
  const store = newStore();
  const w = store.createDamageMeter('DPS');
  assert.equal(w.damageRowCap, 6);
  store.update(w.id, { damageRowCap: 999 });
  // update() doesn't normalize (by design); a reload does
  const data = store.store.loadJson('widgets', null);
  const store2 = new WidgetStore({ loadJson: (n, f) => (n === 'widgets' ? data : f), saveJson: () => {} });
  assert.equal(store2.getById(w.id).damageRowCap, 20);
});

test('damageRowCap is in SHAREABLE_FIELDS so it rides a share code', () => {
  assert.match(read('src', 'main', 'widgetStore.js'), /'showCharmedPetsRow',\s*\n\s*'damageRowCap',/);
});

test('the overlay keeps the top N attacker rows and never caps the Total', () => {
  assert.match(overlaySrc, /const cap = Number\(currentConfig\.damageRowCap\);/);
  assert.match(overlaySrc, /rows = rows\.filter\(\(b\) => b\.totalRow \|\| \+\+kept <= cap\);/,
    'the cap either miscounts the Total row or drops it');
  // and it sits inside the damage branch, after the other row filters
  const dmgAt = overlaySrc.indexOf("if (currentConfig.buffSource === 'damage') {");
  const capAt = overlaySrc.indexOf('currentConfig.damageRowCap');
  const retAt = overlaySrc.indexOf('return rows;', dmgAt);
  assert.ok(dmgAt !== -1 && capAt > dmgAt && capAt < retAt, 'the cap is not in the damage branch');
});

test('widgetManager.setDamageOptions accepts and clamps rowCap', () => {
  assert.match(managerSrc, /rowCap.*=.*\{\}|showCharmedPetsRow, rowCap \}/);
  assert.match(managerSrc, /changes\.damageRowCap = Math\.min\(20, Math\.max\(1, Math\.round\(rowCap\)\)\)/);
});

test('the settings panel has the slider, wired both ways', () => {
  assert.match(htmlSrc, /id="widget-damage-row-cap-slider"[^>]*min="1"[^>]*max="20"/);
  assert.match(rendererSrc, /damageRowCapSlider\.addEventListener\('input'/);
  assert.match(rendererSrc, /setWidgetDamageOptions\(selectedId, \{ rowCap: n \}\)/);
  assert.match(rendererSrc, /damageRowCapSlider\.value = String\(cap\)/);
});

module.exports = () => report('damage-row-cap');
if (require.main === module) report('damage-row-cap').then((n) => process.exit(n ? 1 : 0));
