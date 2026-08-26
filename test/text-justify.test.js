'use strict';
/**
 * Text-aura justification - reported live 24 Aug: "text only triggers however need a text
 * justification setting, left right and middle".
 *
 * Not CSS text-align: a text tile is white-space:nowrap and its window shrink-wraps to exactly
 * the words it's showing (overlay.css's own comment explains why), so there is no fixed box for
 * text-align to justify text WITHIN - a message always fills its own tile exactly, whatever it
 * says. What actually changes is the tile's WIDTH, message to message ("DISPELLED" vs "resisted
 * your Denon's Dissension"), and the real question this setting answers is which edge of the
 * window stays anchored while that happens. Reuses the exact currentOriginX mechanism icon
 * mode's label-overflow margin already relies on (see overlay.js's own field comment on it) -
 * this is the same idea, driven by the text's own measured width instead of a fixed margin.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const mainSrc = read('src', 'main', 'main.js');
const managerSrc = read('src', 'main', 'widgetManager.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

test('a new text aura defaults to left, the original/only behavior', () => {
  const store = newStore();
  const widget = store.createTextAura('Announcer');
  assert.equal(widget.textJustify, 'left');
});

test('an unrecognised value normalises to left rather than throwing something unexpected at the overlay', () => {
  const store1 = newStore();
  const widget = store1.createTextAura('Announcer');
  widget.textJustify = 'sideways';
  store1._save();
  const data = store1.store.loadJson('widgets', null);
  const store2 = new WidgetStore({ loadJson: (n, f) => (n === 'widgets' ? data : f), saveJson: () => {} });
  assert.equal(store2.getById(widget.id).textJustify, 'left');
});

test('it round-trips through a share code', () => {
  const store = newStore();
  const widget = store.createTextAura('Announcer');
  store.update(widget.id, { textJustify: 'right' });
  const imported = store.importCode(store.exportCode(widget.id));
  assert.equal(imported.textJustify, 'right');
});

// ---------------------------------------------------------------------------
// The wiring
// ---------------------------------------------------------------------------

test('setTextJustify is wired all the way from the renderer to the store', () => {
  assert.match(preloadSrc, /setWidgetTextJustify: \(id, value\)/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:setTextJustify'/);
  assert.match(managerSrc, /function setTextJustify\(id, value\)/);
  assert.match(managerSrc, /\n  setTextJustify,/, 'not exported from widgetManager');
});

test('the radios exist, are populated, save on change, and are hidden off a text aura', () => {
  assert.match(html, /name="widget-text-justify" value="left"/);
  assert.match(html, /name="widget-text-justify" value="center"/);
  assert.match(html, /name="widget-text-justify" value="right"/);
  assert.match(
    rendererSrc,
    /textJustifyRadios\.forEach\(\(r\) => \(r\.checked = r\.value === \(widget\.textJustify \|\| 'left'\)\)\);/,
    'never populated when a widget is selected'
  );
  assert.match(
    rendererSrc,
    /if \(radio\.checked\) window\.eqTracker\.setWidgetTextJustify\(selectedId, radio\.value\);/,
    'a change never gets saved'
  );
  // Rewritten 25 Aug for the additive settings-panel model - visibility now comes from
  // SHAPE_FIELDS's 'text-fields' group rather than a live isTextAura boolean.
  assert.match(rendererSrc, /textJustifyRowEl\.style\.display = has\('text-fields'\) \? '' : 'none'/);
});

// ---------------------------------------------------------------------------
// The actual anchor math
// ---------------------------------------------------------------------------

test('the origin formula matches each justify mode, at the exact values overlay.js computes', () => {
  const m = overlaySrc.match(/const TEXT_JUSTIFY_ORIGIN = \{ left: 0, center: width \/ 2, right: width \};/);
  assert.ok(m, 'the origin map has been renamed or restructured');
  // Reproduced by hand rather than eval'd out of the source, since it's one line of arithmetic
  // and the real value the pinned line above proves the source still says.
  const width = 240;
  const originFor = { left: 0, center: width / 2, right: width };
  assert.equal(originFor.left, 0, 'left must anchor the left edge - zero shift, the original behavior');
  assert.equal(originFor.center, 120, 'center must split the growth evenly both ways');
  assert.equal(originFor.right, 240, 'right must shift by the FULL width to keep the right edge fixed');
});

test('the origin is only ever touched in text mode - icon mode\'s own label-margin origin must survive untouched', () => {
  const fn = overlaySrc.match(/function reportSizeIfChanged\(\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'reportSizeIfChanged has been restructured');
  assert.match(fn[1], /if \(currentConfig\.displayMode === 'text'\) \{/, 'the text-mode branch is missing');
  // The icon-mode height branch must still be its own separate, unconditional check - not folded
  // into (or replaced by) the new text branch.
  assert.match(fn[1], /if \(currentConfig\.displayMode === 'icons'\) \{/);
});

test('recomputed every measurement, not cached from the first message - each message is a new width', () => {
  // The assignment must sit ABOVE the early-return guard, or a message-length change after the
  // very first render would never update the anchor again.
  const fn = overlaySrc.match(/function reportSizeIfChanged\(\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'reportSizeIfChanged has been restructured');
  const assignAt = fn[1].indexOf("currentConfig.displayMode === 'text'");
  const guardAt = fn[1].indexOf('if (width === lastReportedWidth');
  assert.ok(assignAt >= 0 && guardAt >= 0);
  assert.ok(assignAt < guardAt, 'the origin is computed after the early-return guard already bailed out');
});

module.exports = () => report('text-justify');
if (require.main === module) report('text-justify').then((n) => process.exit(n ? 1 : 0));
