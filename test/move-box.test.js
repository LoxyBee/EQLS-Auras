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

test('right-clicking the box reaches the settings window, hop by hop', () => {
  // Five hops, and a missing one anywhere is a right-click that does nothing with no error.
  assert.match(
    overlayJs,
    /dragOverlayEl\.addEventListener\('contextmenu', \(e\) => \{\s*\n\s*e\.preventDefault\(\);\s*\n\s*window\.eqOverlay\.openSettings\(widgetId\);/
  );
  assert.match(preloadOverlay, /openSettings: \(widgetId\) => \{\s*ipcRenderer\.send\('widget:openSettings', widgetId\);/);
  assert.match(mainSrc, /ipcMain\.on\('widget:openSettings'/);
  assert.match(preloadMain, /onOpenWidgetSettings: \(callback\) => \{/);
  assert.match(rendererSrc, /window\.eqTracker\.onOpenWidgetSettings\(\(id\) => focusWidget\(id\)\)/);
});

test('the native right-click menu is suppressed, not stacked on top of', () => {
  // Without preventDefault, right-clicking the box would open settings AND pop Chromium's own
  // context menu over the game - the second half being the actual bug this guards.
  const fn = overlayJs.match(/dragOverlayEl\.addEventListener\('contextmenu', \(e\) => \{([\s\S]*?)\n\}\);/);
  assert.ok(fn, 'the contextmenu listener has been restructured');
  assert.match(fn[1], /e\.preventDefault\(\);/);
});

test('the settings window is raised, not just messaged', () => {
  // A message to a minimised window is a message nobody sees.
  const handler = mainSrc.match(/ipcMain\.on\('widget:openSettings'[\s\S]*?\n\}\);/);
  assert.ok(handler, 'the open-settings handler has been restructured');
  assert.match(handler[0], /isMinimized\(\)/, 'a minimised window would stay minimised');
  assert.match(handler[0], /\.focus\(\)/);
  assert.match(handler[0], /isDestroyed\(\)/, 'sending to a destroyed window throws');
});

test('the listener is registered where focusWidget can be seen', () => {
  // focusWidget lives inside initWidgetsPanel's closure, so a listener registered next to the
  // other IPC wiring at the top of the file would be a ReferenceError at click time - which
  // would not surface until someone actually right-clicked the box.
  const listener = rendererSrc.indexOf('onOpenWidgetSettings');
  const panel = rendererSrc.indexOf('function focusWidget(id)');
  assert.ok(listener >= 0 && panel >= 0);
  const enclosing = rendererSrc.lastIndexOf('function initWidgetsPanel', listener);
  assert.ok(
    enclosing >= 0 && enclosing < listener && enclosing < panel,
    'the listener must sit inside the same closure as focusWidget'
  );
});

module.exports = () => report('move-box');
if (require.main === module) process.exit(report('move-box') ? 1 : 0);
