'use strict';
/**
 * QOL #6/#42 - two additions to loadout switching:
 *   1. a global "/tell <word>" (default 'eqldnext') that cycles to the NEXT loadout, wrapping
 *   2. a brief on-screen banner naming the loadout you switched to, ~3s, on a real change only
 *
 * The logic lives in main.js's closure (needs electron) and profileFlashWindow.js (needs a
 * BrowserWindow), so this pins the shape by source-scan, the same way the other window features
 * (move-hud, grid-guide, nudge-pad) are tested.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const mainSrc = read('src', 'main', 'main.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');
const htmlSrc = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

test('the cycle word is sanitised and defaults to eqldnext', () => {
  const fn = mainSrc.match(/function profileCycleCommand\(\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'profileCycleCommand exists');
  assert.match(fn[1], /loadJson\('profileCycleCommand', 'eqldnext'\)/);
  assert.match(fn[1], /replace\(\/\[\^a-z0-9\]\/g, ''\)\.slice\(0, 15\)/);
  assert.match(fn[1], /\|\| 'eqldnext'/);
});

test('the /tell handler cycles to the next loadout, wrapping, needing at least two', () => {
  const h = mainSrc.slice(mainSrc.indexOf("onLogLine('profileCommand'"));
  assert.match(h, /word === profileCycleCommand\(\) && all\.length >= 2/);
  assert.match(h, /const next = all\[\(i \+ 1\) % all\.length\]/);
  assert.match(h, /next\.id !== activeId && activateProfile\(next\.id\)/);
});

test('the flash fires only on a real change and only when enabled', () => {
  const fn = mainSrc.match(/function activateProfile\(id\) \{([\s\S]*?)\n\}/);
  assert.ok(fn);
  assert.match(fn[1], /const before = profileStore\.getActiveId\(\);/);
  assert.match(fn[1], /if \(result !== before && loadJson\('profileFlashEnabled', true\)\)/);
  assert.match(fn[1], /profileFlashWindow\.show\(p\.name\)/);
});

test('the flash window is torn down on quit', () => {
  assert.match(mainSrc, /profileFlashWindow\.destroy\(\);/);
  assert.match(mainSrc, /require\('\.\/profileFlashWindow'\)/);
});

test('the flash window: borderless, transparent, click-through, always-on-top, self-hiding', () => {
  const w = read('src', 'main', 'profileFlashWindow.js');
  assert.match(w, /frame: false/);
  assert.match(w, /transparent: true/);
  assert.match(w, /win\.setIgnoreMouseEvents\(true\)/);
  assert.match(w, /win\.setAlwaysOnTop\(true, 'screen-saver'\)/);
  assert.match(w, /channel === 'profileFlash:done'/, 'hides when the renderer finishes its fade');
  assert.match(w, /setTimeout\(hide, 5000\)/, 'plus a main-side safety timer');
  const r = read('src', 'renderer', 'profile-flash', 'profile-flash.js');
  assert.match(r, /window\.eqProfileFlash\.done\(\)/);
});

test('wired: IPC + preload + the two modal controls', () => {
  assert.match(mainSrc, /ipcMain\.handle\('profiles:getCycleCommand'/);
  assert.match(mainSrc, /ipcMain\.handle\('profiles:setCycleCommand'/);
  assert.match(mainSrc, /ipcMain\.handle\('profiles:setFlashEnabled'/);
  assert.match(preloadSrc, /getProfileCycleCommand: \(\) => ipcRenderer\.invoke\('profiles:getCycleCommand'\)/);
  assert.match(preloadSrc, /setProfileFlashEnabled: \(on\) => ipcRenderer\.invoke\('profiles:setFlashEnabled', on\)/);
  assert.match(htmlSrc, /id="profile-cycle-command"/);
  assert.match(htmlSrc, /id="profile-flash-checkbox"/);
  assert.match(rendererSrc, /setProfileCycleCommand\(cycleCmdInput\.value\)/);
  assert.match(rendererSrc, /setProfileFlashEnabled\(flashCheckbox\.checked\)/);
});

module.exports = () => report('profile-cycle-and-flash');
if (require.main === module) report('profile-cycle-and-flash').then((n) => process.exit(n ? 1 : 0));
