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
const { WidgetStore, clampDamageRowCap, clampDamageBothCycleSec } = require('../src/main/widgetStore');

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

test('the overlay keeps the top N rows and never caps the Total', () => {
  assert.match(overlaySrc, /const cap = Number\(currentConfig\.damageRowCap\);/);
  // Only the Total is exempt - the "Pets" / "Other" summary rows count as rows and, being sorted
  // to the bottom, are the first cut (owner, 5 Sep).
  assert.match(overlaySrc, /rows = rows\.filter\(\(b\) => b\.totalRow \|\| \+\+kept <= cap\);/);
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

// ---------------------------------------------------------------------------
// Both mode: cycle damage/heal every N seconds (owner, 5 Sep - side-by-side was too cramped)
// ---------------------------------------------------------------------------

test('clampDamageBothCycleSec: default 10, 0 = off, else clamp 1..20', () => {
  assert.equal(clampDamageBothCycleSec(undefined), 10);
  assert.equal(clampDamageBothCycleSec('x'), 10);
  assert.equal(clampDamageBothCycleSec(0), 0);
  assert.equal(clampDamageBothCycleSec(-2), 0);
  assert.equal(clampDamageBothCycleSec(1), 1);
  assert.equal(clampDamageBothCycleSec(99), 20);
  assert.equal(clampDamageBothCycleSec(3.4), 3);
});

test('damageBothCycleSec: default 10 on a fresh meter, in SHAREABLE_FIELDS, clamped on reload', () => {
  const store = newStore();
  const w = store.createDamageMeter('DPS');
  assert.equal(w.damageBothCycleSec, 10);
  assert.match(read('src', 'main', 'widgetStore.js'), /'damageTrackMode',\s*\n\s*'damageBothCycleSec',/);
  store.update(w.id, { damageBothCycleSec: 99 });
  const data = store.store.loadJson('widgets', null);
  const store2 = new WidgetStore({ loadJson: (n, f) => (n === 'widgets' ? data : f), saveJson: () => {} });
  assert.equal(store2.getById(w.id).damageBothCycleSec, 20);
});

test('the cycle slider is wired: manager, IPC-facing option name, HTML, renderer', () => {
  assert.match(managerSrc, /bothCycleSec, bothMode, damageColor, healColor \} =/);
  assert.match(managerSrc, /changes\.damageBothCycleSec = r <= 0 \? 0 : Math\.min\(20, Math\.max\(1, r\)\)/);
  assert.match(htmlSrc, /id="widget-damage-both-cycle-slider"[^>]*min="0"[^>]*max="20"/);
  assert.match(rendererSrc, /setWidgetDamageOptions\(selectedId, \{ bothCycleSec: sec \}\)/);
  // the rows only show in Both mode
  assert.match(rendererSrc, /damageBothCycleRow\.style\.display = both \? '' : 'none'/);
});

test('a cycling row is prefixed "dmg" / "heal" so which figure is showing is unambiguous', () => {
  assert.match(overlaySrc, /const tag = cyclePhase === 'heal' \? 'heal ' : 'dmg ';/);
  assert.match(overlaySrc, /ref\.timeEl\.textContent = tag \+ /);
});

test('the Both-mode Total row cycles too, with its own damage/heal total pieces', () => {
  assert.match(read('src', 'main', 'damageEngine.js'), /damageTotalText: `\$\{formatDamage\(grandDamage\)\} \(\$\{dmgRate\(grandDamage\)\}\)`/);
  assert.match(read('src', 'main', 'damageEngine.js'), /healTotalText: `\$\{formatDamage\(grandHeal\)\} \(\$\{healRate\(grandHeal\)\}\)`/);
  assert.match(overlaySrc, /buff\.totalRow && buff\.damageTotalText != null/);
  assert.match(overlaySrc, /cyclePhase === 'heal' \? buff\.healTotalText : buff\.damageTotalText/);
});

test('the overlay runs a cycle timer and derives the phase from the wall clock', () => {
  assert.match(overlaySrc, /function updateBothCycleTimer\(\)/);
  assert.match(overlaySrc, /currentConfig\.damageTrackMode === 'both' &&\s*\n\s*bothCycleSecEffective\(\) > 0/);
  assert.match(overlaySrc, /Math\.floor\(Date\.now\(\) \/ \(sec \* 1000\)\) % 2 === 0 \? 'damage' : 'heal'/);
  assert.match(overlaySrc, /updateBothCycleTimer\(\);/); // called from applyConfig
});

test('Both has a Combined vs Swap sub-mode; Swap flips the whole standalone meter', () => {
  assert.match(read('src', 'main', 'widgetStore.js'), /const DAMAGE_BOTH_MODES = \['combined', 'swap'\]/);
  assert.match(managerSrc, /if \(bothMode === 'combined' \|\| bothMode === 'swap'\) changes\.damageBothMode = bothMode/);
  assert.match(htmlSrc, /name="widget-damage-both-mode"/);
  assert.match(rendererSrc, /setWidgetDamageOptions\(selectedId, \{ bothMode: radio\.value \}\)/);
  // Swap always cycles - an 0 slider falls back to a default.
  assert.match(overlaySrc, /currentConfig\.damageBothMode === 'swap'\) return raw > 0 \? raw : BOTH_SWAP_DEFAULT_SEC/);
  // Swap returns the whole standalone damage OR heal view, alternating.
  assert.match(overlaySrc, /trackMode === 'both' && currentConfig\.damageBothMode === 'swap'/);
  assert.match(overlaySrc, /bothCyclePhase\(\) === 'heal' \? lastDamageViews\.healing : lastDamageViews\.damage/);
});

// ---------------------------------------------------------------------------
// Rank colours: pick a hex per metric; it's the #1 row, rows below fade toward grey (owner, 5 Sep)
// ---------------------------------------------------------------------------

test('clampDamageColor / clampHealColor: valid #rrggbb kept (lowercased), junk -> default', () => {
  const { clampDamageColor, clampHealColor } = require('../src/main/widgetStore');
  assert.equal(clampDamageColor('#AABBCC'), '#aabbcc');
  assert.equal(clampDamageColor('red'), '#e0603a');
  assert.equal(clampDamageColor(undefined), '#e0603a');
  assert.equal(clampDamageColor('#abc'), '#e0603a'); // 3-digit not accepted here
  assert.equal(clampHealColor('#123456'), '#123456');
  assert.equal(clampHealColor(42), '#37b56a');
});

test('a fresh meter carries the default colours, they are in SHAREABLE_FIELDS, and reload clamps junk', () => {
  const store = newStore();
  const w = store.createDamageMeter('DPS');
  assert.equal(w.damageColor, '#e0603a');
  assert.equal(w.healColor, '#37b56a');
  const ws = read('src', 'main', 'widgetStore.js');
  assert.match(ws, /'damageColor',\s*\n\s*'healColor',/);
  store.update(w.id, { damageColor: 'nonsense' });
  const data = store.store.loadJson('widgets', null);
  const store2 = new WidgetStore({ loadJson: (n, f) => (n === 'widgets' ? data : f), saveJson: () => {} });
  assert.equal(store2.getById(w.id).damageColor, '#e0603a');
});

test('the colour pickers are wired end to end: manager, HTML, renderer', () => {
  assert.match(managerSrc, /\{ fightTimeoutSec[^}]*damageColor, healColor \} = \{\}/);
  assert.match(managerSrc, /changes\.damageColor = String\(damageColor\)\.toLowerCase\(\)/);
  assert.match(managerSrc, /changes\.healColor = String\(healColor\)\.toLowerCase\(\)/);
  assert.match(htmlSrc, /id="widget-damage-color"[^>]*type="color"|type="color"[^>]*id="widget-damage-color"/);
  assert.match(htmlSrc, /id="widget-heal-color"/);
  assert.match(rendererSrc, /setWidgetDamageOptions\(selectedId, \{ damageColor: damageColorInput\.value \}\)/);
  assert.match(rendererSrc, /setWidgetDamageOptions\(selectedId, \{ healColor: healColorInput\.value \}\)/);
});

test('the overlay derives the shade from barPercent so #1 is the pure pick and the rest fade', () => {
  assert.match(overlaySrc, /function hexToHsl\(hex\)/);
  assert.match(overlaySrc, /function meterShade\(kind, barPercent\)/);
  // not a number (the Total row) is treated as the top of the board
  assert.match(overlaySrc, /const t = typeof barPercent === 'number' \? Math\.max\(0, Math\.min\(1, barPercent \/ 100\)\) : 1/);
  // the split bar tints both segments by the row's own rank
  assert.match(overlaySrc, /const dmgColor = damageBarColor\('damage', buff\.barPercent\)/);
  assert.match(overlaySrc, /const healColor = damageBarColor\('heal', buff\.barPercent\)/);
});

module.exports = () => report('damage-row-cap');
if (require.main === module) report('damage-row-cap').then((n) => process.exit(n ? 1 : 0));
