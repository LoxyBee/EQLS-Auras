'use strict';
/**
 * "Show example content" - a persistent toggle (was QOL #1's timed flash).
 *
 * While it is on, an aura with nothing real to show fills with a sample tile so its size /
 * position / colour / font can be judged, and several auras can be arranged together, without
 * going in-game. The moment a real buff lands it takes over (real always wins). The toggle lives
 * on each aura's own settings AND on the Overlay page's "All auras" card (which flips every aura
 * at once). The overlay window is kept on screen while previewing, the same way a hand-unlock
 * keeps it up; runtime-only, not persisted.
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

test('the sample only stands in when there is nothing real, and real content wins', () => {
  const src = read('src', 'renderer', 'overlay', 'overlay.js');
  // currentSourceBuffs falls back to the sample ONLY when the real feed is empty and preview is on
  assert.match(src, /if \(previewActive && real\.length === 0\) \{\s*\n\s*showingPreviewSample = true;\s*\n\s*return previewSampleBuffs\(\);/);
  assert.match(src, /showingPreviewSample = false;\s*\n\s*return real;/);
  // filters are bypassed only for the actual sample, not for real content shown during preview mode
  assert.match(src, /const visible = showingPreviewSample \? buffs : visibleBuffs\(buffs\);/);
  // it is a toggle now - set by an enabled flag, no revert timer
  assert.match(src, /onPreviewMode\(\(\{ enabled \} = \{\}\) => \{\s*\n\s*previewActive = !!enabled;/);
  assert.doesNotMatch(src, /previewActive = false;\s*render/);
});

test('previewing keeps the overlay window on screen like a hand-unlock', () => {
  const mgr = read('src', 'main', 'widgetManager.js');
  const fn = mgr.match(/function shouldBeOnScreen\(config\) \{[\s\S]*?\n\}/)[0];
  assert.match(fn, /previewShown\.has\(config\.id\)\) return false;/);
  assert.match(fn, /if \(isUnlocked\(config\.id\) \|\| previewShown\.has\(config\.id\)\) return true;/);
});

test('it is wired end to end, as a toggle', () => {
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('widget:preview'/);
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('overlay:setPreviewAll'/);
  assert.match(read('src', 'main', 'widgetManager.js'), /function setPreview\(id, enabled\)/);
  assert.match(read('src', 'main', 'widgetManager.js'), /function setPreviewAll\(enabled\)/);
  assert.match(read('src', 'main', 'widgetManager.js'), /webContents\.send\('widget:previewMode'/);
  // previewWidget is a toggle over the same set now, no timer
  assert.match(read('src', 'main', 'widgetManager.js'), /setPreview\(id, !previewShown\.has\(id\)\)/);
  assert.doesNotMatch(read('src', 'main', 'widgetManager.js'), /PREVIEW_MS/);
  assert.match(read('src', 'preload', 'preload-main.js'), /previewWidget:/);
  assert.match(read('src', 'preload', 'preload-main.js'), /setOverlayPreviewAll:/);
  assert.match(read('src', 'preload', 'preload-overlay.js'), /onPreviewMode:/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="widget-preview-btn"/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="master-preview-all-btn"/);
  assert.match(read('src', 'renderer', 'main-window', 'main-window.js'), /previewWidget\(selectedId\)/);
  assert.match(read('src', 'renderer', 'main-window', 'main-window.js'), /setOverlayPreviewAll\(!state\.previewAll\)/);
});

module.exports = () => report('preview-aura');
if (require.main === module) report('preview-aura').then((n) => process.exit(n ? 1 : 0));
