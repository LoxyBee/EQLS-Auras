'use strict';
/**
 * The raid-lockout aura's plumbing (owner request, 2 Sep 2026). The board ROW logic is in
 * lockout-board.test.js; this covers the aura itself: the store factory, the per-aura settings and
 * their clamps, and that the premade / IPC / preload / manager wiring all name the same things.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const {
  WidgetStore,
  normalizeWidget,
  SHARE_CODE_PREFIX,
  cleanLockoutTriggerWord,
  clampLockoutAutoHideSec,
} = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

test('createLockoutBoard makes a lockout aura with the defaults', () => {
  const w = newStore().createLockoutBoard('LB');
  assert.equal(w.buffSource, 'lockout');
  assert.equal(w.lockoutTriggerWord, 'eqrlm');
  assert.equal(w.lockoutAutoHideSec, 20);
  assert.equal(w.sortOrder, 'default', 'a lockout board must not be re-sortable');
  assert.equal(w.landingGlowEnabled, false, 'nothing lands on this aura');
});

test('the trigger word is cleaned to a valid /tell target', () => {
  assert.equal(cleanLockoutTriggerWord('EQ RLM!!'), 'eqrlm');
  assert.equal(cleanLockoutTriggerWord(''), 'eqrlm', 'empty falls back to the default');
  assert.equal(cleanLockoutTriggerWord('  My-Word  '), 'myword');
  assert.equal(cleanLockoutTriggerWord('x'.repeat(50)).length, 24, 'capped');
});

test('the auto-hide seconds are clamped to 3..120', () => {
  assert.equal(clampLockoutAutoHideSec(9999), 120);
  assert.equal(clampLockoutAutoHideSec(0), 3);
  assert.equal(clampLockoutAutoHideSec('nope'), 20);
  assert.equal(clampLockoutAutoHideSec(45), 45);
});

test('normalizeWidget clamps a hostile lockout config (share codes are pasted from chat)', () => {
  const w = normalizeWidget({ buffSource: 'lockout', lockoutTriggerWord: '../etc/passwd', lockoutAutoHideSec: Infinity });
  assert.equal(w.lockoutTriggerWord, 'etcpasswd');
  assert.equal(w.lockoutAutoHideSec, 20);
});

test('both lockout fields are in SHAREABLE_FIELDS so a share code carries them', () => {
  const store = newStore();
  const w = store.createLockoutBoard('LB');
  store.update(w.id, { lockoutTriggerWord: 'raids', lockoutAutoHideSec: 30 });
  const code = store.exportCode(w.id);
  assert.ok(code.startsWith(SHARE_CODE_PREFIX));
  const imported = store.importCode(code);
  assert.equal(imported.lockoutTriggerWord, 'raids');
  assert.equal(imported.lockoutAutoHideSec, 30);
});

test('the aura is wired end to end - premade, shape, IPC, preload, manager all agree', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const main = read('src', 'main', 'main.js');
  const preload = read('src', 'preload', 'preload-main.js');
  const preloadOverlay = read('src', 'preload', 'preload-overlay.js');
  const manager = read('src', 'main', 'widgetManager.js');
  const html = read('src', 'renderer', 'main-window', 'index.html');

  assert.match(renderer, /id: 'lockout-board'/, 'no premade entry');
  assert.match(renderer, /createLockoutBoardWidget/, 'premade does not call the create bridge');
  assert.match(renderer, /widget\.buffSource === 'lockout'\) return 'lockout'/, 'widgetShape does not map it');
  assert.match(renderer, /'lockout':\s*\[.*'lockout-settings'/, 'SHAPE_FIELDS has no lockout entry');
  assert.match(preload, /createLockoutBoardWidget:.*widget:createLockoutBoard/);
  assert.match(preload, /setWidgetLockoutOptions:.*widget:setLockoutOptions/);
  assert.match(preloadOverlay, /onLockoutBoardChanged:[\s\S]{0,80}'lockout:board'/);
  assert.match(main, /ipcMain\.handle\('widget:createLockoutBoard'/);
  assert.match(main, /ipcMain\.handle\('widget:setLockoutOptions'/);
  assert.match(main, /ipcMain\.handle\('lockout:getBoard'/);
  assert.match(main, /onLogLine\('lockoutCommand'/);
  assert.match(manager, /function createLockoutBoardWidget/);
  assert.match(manager, /function setLockoutOptions/);
  assert.match(html, /id="widget-lockout-settings"/);
  assert.match(html, /id="widget-lockout-command-input"/);
  assert.match(html, /id="widget-lockout-autohide-slider"/);
});

module.exports = () => report('lockout-aura');
if (require.main === module) report('lockout-aura').then((n) => process.exit(n ? 1 : 0));
