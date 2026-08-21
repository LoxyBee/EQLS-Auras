'use strict';
/**
 * Note 6 - the aura's name in its blue move box, and clicking it to open that aura's settings.
 *
 * The trap this suite exists for is a Chromium one. The whole move box carries
 * `-webkit-app-region: drag`, which is handled by the OS before the page ever sees the event, so
 * a click listener attached anywhere inside a drag region simply never fires. There is no error
 * and nothing in the console - the button is just dead. The name has to be an explicit no-drag
 * child, and it has to stay small, because every pixel of no-drag is a pixel you can no longer
 * grab the aura by.
 *
 * A second, quieter trap: matching on "drag" also matches "no-drag". These tests capture the
 * declared value and compare it exactly, and strip comments first, after an earlier version of a
 * check like this passed against prose describing the rule rather than the rule itself.
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

test('the name pill opts OUT of the drag region, or its click never fires', () => {
  assert.equal(
    appRegionOf('.drag-name'), 'no-drag',
    'a click listener inside a Chromium drag region never fires, silently'
  );
});

test('the pill does not swallow the whole box', () => {
  // Making too much of the box no-drag is exactly how you lose the ability to drag the aura you
  // are trying to move. A max-width keeps a long aura name from becoming a full-width bar.
  const rule = overlayCss.match(/\.drag-name\s*\{([^}]*)\}/);
  assert.ok(rule, '.drag-name has been renamed or removed');
  assert.match(rule[1], /max-width:/, 'without a max-width a long name eats the draggable area');
  assert.match(rule[1], /white-space:\s*nowrap/, 'a wrapping name would grow the pill downwards too');
});

test('the pill lives inside the move box, and the hint text is still draggable', () => {
  const box = overlayHtml.match(/<div id="drag-overlay"[\s\S]*?<\/div>/);
  assert.ok(box, 'the move box has been restructured');
  assert.match(box[0], /id="drag-name"/, 'the name pill is not inside the move box');
  // The hint sits in the no-drag box's flex column; it must not itself become a dead zone.
  assert.equal(appRegionOf('.drag-hint'), 'drag');
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

test('clicking the pill reaches the settings window, hop by hop', () => {
  // Five hops, and a missing one anywhere is a button that does nothing with no error.
  assert.match(overlayJs, /dragNameEl\.addEventListener\('click', \(\) => window\.eqOverlay\.openSettings\(widgetId\)\)/);
  assert.match(preloadOverlay, /openSettings: \(widgetId\) => \{\s*ipcRenderer\.send\('widget:openSettings', widgetId\);/);
  assert.match(mainSrc, /ipcMain\.on\('widget:openSettings'/);
  assert.match(preloadMain, /onOpenWidgetSettings: \(callback\) => \{/);
  assert.match(rendererSrc, /window\.eqTracker\.onOpenWidgetSettings\(\(id\) => focusWidget\(id\)\)/);
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
  // would not surface until someone actually clicked the pill.
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
