'use strict';
/**
 * search-dropdown.js - themed replacement for a native <select> with a filter box for long lists.
 * The real behaviour is exercised in Chromium by tools/smoke-render.js; these checks are
 * structural (source + markup + CSS), matching how the other renderer modules are covered here.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..', 'src', 'renderer', 'main-window');
const src = fs.readFileSync(path.join(ROOT, 'search-dropdown.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(ROOT, 'main-window.css'), 'utf8');
const mainJs = fs.readFileSync(path.join(ROOT, 'main-window.js'), 'utf8');

test('loaded before main-window.js so window.SearchDropdown exists when init runs', () => {
  const sd = html.indexOf('<script src="search-dropdown.js">');
  const mw = html.indexOf('<script src="main-window.js">');
  assert.ok(sd !== -1 && mw !== -1 && sd < mw, 'search-dropdown.js must be scripted before main-window.js');
});

test('init wires enhanceAll after it resolves', () => {
  assert.match(mainJs, /window\.SearchDropdown\.enhanceAll\(document\)/);
  assert.match(mainJs, /init\(\)\.finally\(/);
});

test('the <select> stays the source of truth - pick() mirrors value and fires change', () => {
  assert.match(src, /sel\.value = value/);
  assert.match(src, /new Event\('change', \{ bubbles: true \}\)/);
});

test('pick() defers the popup close so the following click is not retargeted', () => {
  // Reported live: choosing a spell "sometimes" closed the Add Aura modal. The <li> handles
  // mousedown; hiding the popup there removes the <li> before the click fires, and the browser
  // retargets that click to whatever is underneath - the modal backdrop, which closes the modal.
  const pick = src.match(/function pick\(value\) \{([\s\S]*?)\n {4}\}/);
  assert.ok(pick, 'pick() has been renamed or restructured');
  assert.match(pick[1], /setTimeout\(close, 0\)/, 'close() runs synchronously, in the same gesture as the mousedown');
});

test('a MutationObserver rebuilds the list when the <option>s change', () => {
  assert.match(src, /new MutationObserver/);
  assert.match(src, /requestAnimationFrame\(rebuild\)/);
  assert.match(src, /childList: true/);
});

test('filter box only appears past the threshold', () => {
  assert.match(src, /FILTER_THRESHOLD = \d+/);
  assert.match(src, /filter\.hidden = !many/);
});

test('every sd- class the script uses has a themed CSS rule', () => {
  for (const cls of ['sd-wrap', 'sd-display', 'sd-caret', 'sd-text', 'sd-placeholder', 'sd-popup', 'sd-filter', 'sd-list', 'sd-item', 'sd-current', 'sd-disabled', 'sd-active', 'sd-empty']) {
    assert.ok(css.includes(`.${cls}`), `.${cls} has no CSS rule`);
  }
  assert.match(css, /select\.sd-native/);
});

test('the popup uses the app palette, not hard-coded colours', () => {
  const block = css.slice(css.indexOf('.sd-popup'), css.indexOf('.sd-empty') + 200);
  assert.ok(/var\(--panel\)/.test(block) && /var\(--accent\)/.test(block));
  assert.ok(!/#[0-9a-fA-F]{3,6}/.test(block.replace(/rgba\([^)]*\)/g, '')), 'no raw hex colours in the popup CSS');
});

module.exports = () => report('search-dropdown');
if (require.main === module) report('search-dropdown').then((n) => process.exit(n ? 1 : 0));
