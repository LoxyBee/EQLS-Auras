'use strict';
/**
 * "Preview this aura" - QOL #1.
 *
 * A button in the settings panel flashes a sample tile on the aura's own overlay window for a few
 * seconds, so its size / position / colour / font can be judged without alt-tabbing into the game
 * and casting something. The overlay renderer builds the sample (previewSampleBuffs), renders it
 * past every filter, and reverts on its own; the main process only makes sure the window is on
 * screen for the duration and then puts it back.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

// Pull previewSampleBuffs out of overlay.js and run it with a controllable currentConfig.
function loadSample() {
  const src = read('src', 'renderer', 'overlay', 'overlay.js');
  const m = src.match(/function previewSampleBuffs\(\) \{[\s\S]*?\n\}/);
  assert.ok(m, 'previewSampleBuffs has been renamed or restructured');
  // eslint-disable-next-line no-new-func
  return new Function(`let currentConfig = {};\n${m[0]}\nreturn { previewSampleBuffs, set: (c) => { currentConfig = c; } };`)();
}

const S = loadSample();

test('the default sample is a couple of real-looking buff tiles', () => {
  S.set({ buffSource: 'self' });
  const out = S.previewSampleBuffs();
  assert.ok(out.length >= 1);
  for (const b of out) {
    assert.equal(typeof b.name, 'string');
    assert.ok(b.name.length > 0);
    assert.equal(typeof b.remainingSec, 'number');
    assert.equal(typeof b.durationSec, 'number');
    assert.ok(b.remainingSec <= b.durationSec);
  }
});

test('an ally sample carries a caster name', () => {
  S.set({ buffSource: 'ally' });
  assert.ok(S.previewSampleBuffs().every((b) => typeof b.allyName === 'string' && b.allyName));
});

test('a bard-songs sample is flagged as songs', () => {
  S.set({ buffSource: 'bardSongs' });
  assert.ok(S.previewSampleBuffs().every((b) => b.isBardSong === true));
});

test('a custom-timer sample uses the aura\'s own name and a stable id', () => {
  S.set({ buffSource: 'customTimer', name: 'Fury cooldown' });
  const out = S.previewSampleBuffs();
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Fury cooldown');
  assert.equal(out[0].id, 'preview');
});

test('render() shows the sample past every filter while a preview is active', () => {
  const src = read('src', 'renderer', 'overlay', 'overlay.js');
  assert.match(src, /const visible = previewActive \? buffs : visibleBuffs\(buffs\);/);
  // currentSourceBuffs hands the sample over.
  assert.match(src, /if \(previewActive\) return previewSampleBuffs\(\);/);
  // and it reverts on a timer.
  assert.match(src, /previewActive = false;\s*render\(currentSourceBuffs\(\)\)/);
});

test('it is wired end to end', () => {
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('widget:preview'/);
  assert.match(read('src', 'main', 'widgetManager.js'), /function previewWidget\(id\)/);
  assert.match(read('src', 'main', 'widgetManager.js'), /webContents\.send\('widget:preview'/);
  // The window is returned to its real state after the preview, not left forced-on.
  assert.match(read('src', 'main', 'widgetManager.js'), /applyVisibility\(cfg\);.*\n\s*\}, PREVIEW_MS/);
  assert.match(read('src', 'preload', 'preload-main.js'), /previewWidget:/);
  assert.match(read('src', 'preload', 'preload-overlay.js'), /onPreview:/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="widget-preview-btn"/);
  assert.match(read('src', 'renderer', 'main-window', 'main-window.js'), /previewWidget\(selectedId\)/);
});

module.exports = () => report('preview-aura');
if (require.main === module) report('preview-aura').then((n) => process.exit(n ? 1 : 0));
