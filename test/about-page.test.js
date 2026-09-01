'use strict';
/**
 * The About page's identity card (added for the 1.0.0 release) and the external-link path it uses.
 * Structural checks - the live render is a launch smoke item.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const html = read('renderer', 'main-window', 'index.html');
const rendererSrc = read('renderer', 'main-window', 'main-window.js');
const mainSrc = read('main', 'main.js');
const preloadSrc = read('preload', 'preload-main.js');

test('the identity card is the first card in #page-about', () => {
  const about = html.slice(html.indexOf('id="page-about"'));
  const idIdx = about.indexOf('id="about-identity-card"');
  const changelogIdx = about.indexOf('id="changelog-card"');
  assert.ok(idIdx > -1 && changelogIdx > -1);
  assert.ok(idIdx < changelogIdx, 'identity card must come before the changelog card');
  assert.match(about.slice(idIdx, changelogIdx), /id="about-version"/);
  assert.match(about.slice(idIdx, changelogIdx), /id="about-site-link"/);
});

test('the version span is filled from getVersionInfo, not hard-coded', () => {
  assert.match(rendererSrc, /getElementById\('about-version'\)/);
  assert.match(rendererSrc, /about-version.*\.textContent = `v\$\{info\.appVersion\}`/s);
});

test('the site link opens externally and never navigates the renderer', () => {
  assert.match(rendererSrc, /getElementById\('about-site-link'\)/);
  assert.match(rendererSrc, /e\.preventDefault\(\)/);
  assert.match(rendererSrc, /window\.eqTracker\.openExternal\('https:\/\/eqlsource\.com\/tools\/'\)/);
  // the anchor's href is the inert "#", not the real URL
  assert.match(html, /<a href="#" id="about-site-link">/);
});

test('app:openExternal is https-only and bridged', () => {
  assert.match(mainSrc, /ipcMain\.handle\('app:openExternal'/);
  assert.match(mainSrc, /\/\^https:\\\/\\\/\/i\.test\(url\)/);
  assert.match(mainSrc, /shell\.openExternal\(url\)/);
  assert.match(preloadSrc, /openExternal: \(url\) => ipcRenderer\.invoke\('app:openExternal', url\)/);
});

test('the "Version & app data" status text is not dev jargon any more', () => {
  assert.doesNotMatch(rendererSrc, /App, main process, and IPC are all working/);
  assert.match(rendererSrc, /statusEl\.textContent = 'The app is running\.'/);
  // the error branch is kept
  assert.match(rendererSrc, /statusEl\.textContent = 'Something is wrong: '/);
});

module.exports = () => report('about-page');
if (require.main === module) report('about-page').then((n) => process.exit(n ? 1 : 0));
