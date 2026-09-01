'use strict';
/**
 * The app icon (the eqlsource mark - gold hex + "=") is wired into the build and the main window.
 *
 * Two separate places have to agree, and a regression in either is silent (you only notice the
 * default Electron diamond is back when you look at the taskbar):
 *   - package.json build.win.icon -> electron-builder bakes it into the packaged .exe resource
 *   - mainWindow.js BrowserWindow({ icon }) -> the dev run + Linux builds
 * The .ico itself must stay a real multi-size Windows icon.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const ICO = path.join(ROOT, 'build', 'icon.ico');

test('build/icon.ico exists and is a real multi-size Windows icon', () => {
  assert.ok(fs.existsSync(ICO), 'build/icon.ico is missing - the release build would ship the default Electron icon');
  const b = fs.readFileSync(ICO);
  assert.equal(b.readUInt16LE(0), 0, 'ICONDIR reserved field');
  assert.equal(b.readUInt16LE(2), 1, 'not an .ico (type != 1)');
  const count = b.readUInt16LE(4);
  assert.ok(count >= 4, `an app icon wants several sizes, found ${count}`);
  const sizes = [];
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16;
    sizes.push(b[o] || 256);
    // every entry must point inside the file
    const len = b.readUInt32LE(o + 8);
    const off = b.readUInt32LE(o + 12);
    assert.ok(off + len <= b.length, `image ${i} runs past the end of the file`);
  }
  assert.ok(sizes.includes(16) && sizes.includes(32) && sizes.includes(256), `missing a standard size: ${sizes.join('/')}`);
});

test('build/icon.png exists for Linux / general use', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'build', 'icon.png')));
});

test('package.json points the Windows build at build/icon.ico and bundles it', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.build.win.icon, 'build/icon.ico', 'build.win.icon is not set - the packaged .exe keeps the default icon');
  assert.ok(
    pkg.build.files.includes('build/icon.ico'),
    'build/icon.ico is not in build.files, so the BrowserWindow icon path will not resolve in a packaged run',
  );
});

test('the main window is created with the app icon', () => {
  const src = fs.readFileSync(path.join(ROOT, 'src', 'main', 'mainWindow.js'), 'utf8');
  assert.match(src, /const APP_ICON = path\.join\(__dirname, '\.\.', '\.\.', 'build', 'icon\.ico'\)/);
  assert.match(src, /new BrowserWindow\(\{[\s\S]*?icon: APP_ICON/, 'BrowserWindow is not passed icon: APP_ICON');
});

module.exports = () => report('app-icon');
if (require.main === module) report('app-icon').then((n) => process.exit(n ? 1 : 0));
