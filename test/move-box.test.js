'use strict';
/**
 * Note 6 - the aura's name in its blue move box, and reaching that aura's settings from it.
 *
 * Reworked at the owner's instruction, 2026-08-24: the name used to be its own clickable button,
 * which meant it had to be a no-drag hole cut out of the box's drag region (the Chromium trap this
 * suite originally existed for - `-webkit-app-region: drag` is handled by the OS before the page
 * ever sees a click, so a listener inside one is silently dead). That hole was small - "the tiny
 * edge to open up an aura ... is too small" - and it competed with the drag region for the same
 * pixels, one pixel of no-drag being one less pixel you could grab the aura by.
 *
 * The name is now a plain label with no click handling of its own, riding along with the rest of
 * the box. Reaching settings is now a right-click ANYWHERE on the box - one big target instead of
 * one small one, using `contextmenu` rather than `click` so it never competes with the drag.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const overlayHtml = read('src', 'renderer', 'overlay', 'index.html');
const overlayJs = read('src', 'renderer', 'overlay', 'overlay.js');
const preloadOverlay = read('src', 'preload', 'preload-overlay.js');
const preloadMain = read('src', 'preload', 'preload-main.js');
const mainSrc = read('src', 'main', 'main.js');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

/** CSS with comments removed, so prose about a rule is never mistaken for the rule. */
const overlayCss = read('src', 'renderer', 'overlay', 'overlay.css').replace(/\/\*[\s\S]*?\*\//g, '');

/** The declared app-region value inside one CSS rule, or null. */
function appRegionOf(selector) {
  const rule = overlayCss.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\s*\\{([^}]*)\\}`));
  if (!rule) return null;
  const decl = rule[1].match(/-webkit-app-region:\s*([a-z-]+)/);
  return decl ? decl[1] : null;
}

test('the move box is still a drag region', () => {
  // If this ever stops being true, the aura cannot be moved at all and the rest of this suite is
  // testing the wrong problem.
  assert.equal(appRegionOf('.drag-overlay'), 'drag');
});

test('the name is no longer carved out of the drag region', () => {
  // It was a button once, and had to opt out of the drag region for its click to fire at all - see
  // the old version of this file. Now that nothing inside the box has its own click handler, an
  // explicit no-drag hole would only cost draggable area for no reason.
  assert.notEqual(
    appRegionOf('.drag-name'),
    'no-drag',
    'the name still opts out of the drag region, but nothing needs it to any more'
  );
});

test('the name is a label, not a button', () => {
  const box = overlayHtml.match(/<div id="drag-overlay"[\s\S]*?<\/div>/);
  assert.ok(box, 'the move box has been restructured');
  assert.match(box[0], /<span id="drag-name"/, 'the name is not a plain element inside the box');
  assert.doesNotMatch(box[0], /<button[^>]*id="drag-name"/, 'the name is still a button');
});

test('the name does not still eat the draggable area', () => {
  // A max-width still matters even for a non-interactive label - without it a long aura name would
  // grow the pill to the box's full width, and CSS has no way to tell "wide because of a long name"
  // from "wide on purpose."
  const rule = overlayCss.match(/\.drag-name\s*\{([^}]*)\}/);
  assert.ok(rule, '.drag-name has been renamed or removed');
  assert.match(rule[1], /max-width:/, 'without a max-width a long name grows past the box');
  assert.match(rule[1], /white-space:\s*nowrap/, 'a wrapping name would grow the pill downwards too');
});

test('the name comes from the config, so renaming an aura updates the box', () => {
  // Set once at boot, the box would show the old name until the next restart. A rename arrives
  // as an ordinary config change, so applyConfig is the right place and the only right place.
  const fn = overlayJs.match(/function applyConfig\(config\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'applyConfig has been renamed or restructured');
  assert.match(fn[1], /dragNameEl\.textContent = config\.name/);
});

test('an empty name does not leave an empty pill sitting there', () => {
  assert.match(overlayCss, /\.drag-name:empty\s*\{\s*display:\s*none;/);
});

// The right-click-the-box-to-open-settings path (5-hop chain, freeze-bug history) was REMOVED
// 1 Sep - the owner: "this didn't work and can be removed." Get to an aura's settings from the
// sidebar list instead.

module.exports = () => report('move-box');
if (require.main === module) report('move-box').then((n) => process.exit(n ? 1 : 0));
