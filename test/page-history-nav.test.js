'use strict';
/**
 * Mouse 4 / Mouse 5 (the side buttons) walk back / forward through the sidebar pages visited this
 * session - browser-style. Owner, 8 Sep.
 *
 * Source-scan, like the other renderer-behaviour tests: the logic lives in a closure that touches
 * `document`, so this pins the shape rather than running it.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');

test('a history stack is kept, and activateNavButton records every page it lands on', () => {
  assert.match(js, /let pageHistory = \[\];/);
  assert.match(js, /function recordPageVisit\(pageId\)/);
  // truncates any forward history on a new visit, dedups the same page
  assert.match(js, /pageHistory = pageHistory\.slice\(0, pageHistoryPos \+ 1\);/);
  assert.match(js, /if \(pageHistory\[pageHistoryPos\] === pageId\) return;/);
  // and activateNavButton calls it
  const fn = js.slice(js.indexOf('function activateNavButton('), js.indexOf('function activateNavButton(') + 500);
  assert.match(fn, /recordPageVisit\(pageId\);/);
});

test('goPageHistory walks without recording (no infinite loop), and clamps at the ends', () => {
  const fn = js.slice(js.indexOf('function goPageHistory('), js.indexOf('function goPageHistory(') + 500);
  assert.match(fn, /if \(target < 0 \|\| target >= pageHistory\.length\) return;/);
  assert.match(fn, /navigatingPageHistory = true;/);
  assert.match(js, /if \(!pageId \|\| navigatingPageHistory\) return;/);
});

test('the mouse side buttons are bound: button 3 = back, button 4 = forward', () => {
  assert.match(js, /if \(e\.button === 3\) \{ e\.preventDefault\(\); goPageHistory\(-1\); \}/);
  assert.match(js, /else if \(e\.button === 4\) \{ e\.preventDefault\(\); goPageHistory\(1\); \}/);
  // mousedown preventDefault so no stray in-page navigation fires
  assert.match(js, /if \(e\.button === 3 \|\| e\.button === 4\) e\.preventDefault\(\);/);
});

module.exports = () => report('page-history-nav');
if (require.main === module) report('page-history-nav').then((n) => process.exit(n ? 1 : 0));
