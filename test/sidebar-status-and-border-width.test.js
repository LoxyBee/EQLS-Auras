'use strict';
/**
 * Two unrelated features landed together, both reported live in the same session:
 *
 *   - The sidebar's per-widget dot: "i really like the coloured dot... however, i want the
 *     opposite, show a green dot when it's active, grey dot when it is not." The old dot only
 *     ever appeared for a widget scoped to fewer profiles than exist, in one fixed colour
 *     regardless of whether that scoping actually included the CURRENT profile - so a widget
 *     disabled everywhere (activeProfileIds: []) looked identical to one merely restricted to two
 *     profiles out of three. The dot is now shown on every widget, coloured by whether it is
 *     actually on for the current profile right now.
 *
 *   - A width control for note 37's coloured tile edge, hidden until the edge itself is switched
 *     on, and rescoped to icon-mode tiles only per the owner's own framing ("for icon styles").
 *
 * Both are checked structurally (source regexes), same as every other settings-panel test in this
 * suite - main-window.js/overlay.js need a DOM to actually execute.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const css = read('src', 'renderer', 'main-window', 'main-window.css');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const overlayCss = read('src', 'renderer', 'overlay', 'overlay.css');
const managerSrc = read('src', 'main', 'widgetManager.js');
const storeSrc = read('src', 'main', 'widgetStore.js');
const mainSrc = read('src', 'main', 'main.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');

// ---------------------------------------------------------------------------
// The sidebar dot
// ---------------------------------------------------------------------------

test('the dot is unconditional now - no longer only shown for a widget scoped to fewer than every profile', () => {
  const fn = rendererSrc.match(/function buildAuraRow\(widget\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'buildAuraRow has been restructured');
  assert.doesNotMatch(
    fn[1],
    /if \(latestProfiles\.length > 0 && activeProfileIds\.length < latestProfiles\.length\)/,
    'the old gate is still here - the dot is still hidden for a widget active on every profile'
  );
  assert.match(fn[1], /dotWrap\.append\(dot, tooltip\);/, 'the dot is never actually appended');
  assert.match(fn[1], /btn\.appendChild\(dotWrap\);/, 'the dot wrap is never attached to the row');
});

test('the dot colour reflects whether the widget is active for the CURRENT profile, not just scoped to some profile', () => {
  const fn = rendererSrc.match(/function buildAuraRow\(widget\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn);
  assert.match(
    fn[1],
    /const isActiveNow = !!widget\.showOnAllProfiles \|\| activeProfileIds\.includes\(currentActiveProfileId\);/,
    'the active-now computation is missing or no longer checks showOnAllProfiles/activeProfileIds against the CURRENT profile'
  );
  assert.match(
    fn[1],
    /dot\.className = 'profile-dot' \+ \(isActiveNow \? ' profile-dot-on' : ' profile-dot-off'\);/,
    'the dot no longer switches class based on isActiveNow'
  );
});

test('the current active profile is tracked independently and re-renders the sidebar on switch', () => {
  assert.match(
    rendererSrc,
    /let currentActiveProfileId = null;/,
    'currentActiveProfileId is missing - the dot has no CURRENT profile to compare against'
  );
  assert.match(
    rendererSrc,
    /function refreshActiveProfileCache\(\) \{\s*\n\s*return window\.eqTracker\.getActiveProfileId\(\)\.then\(\(id\) => \{\s*\n\s*currentActiveProfileId = id;/,
    'refreshActiveProfileCache no longer fetches and stores the active profile id'
  );
  assert.match(
    rendererSrc,
    /window\.eqTracker\.onActiveProfileChanged\(\(id\) => \{\s*\n\s*currentActiveProfileId = id;\s*\n\s*renderWidgetSubmenu\(\);/,
    'switching profiles no longer re-renders the sidebar - every dot would show stale colours until something else happened to redraw it'
  );
});

test('on and off use two distinct, real colours - green for on, the muted ink tone for off', () => {
  const onRule = css.match(/\.profile-dot-on\s*\{([\s\S]*?)\}/);
  const offRule = css.match(/\.profile-dot-off\s*\{([\s\S]*?)\}/);
  assert.ok(onRule, '.profile-dot-on is missing');
  assert.ok(offRule, '.profile-dot-off is missing');
  assert.match(onRule[1], /var\(--ok\)/, 'the on-state no longer uses the app\'s green "ok" token');
  assert.match(offRule[1], /var\(--ink-faint\)/, 'the off-state no longer uses a muted/grey token');
  assert.notEqual(onRule[1].trim(), offRule[1].trim(), 'on and off resolved to the identical rule');
});

// ---------------------------------------------------------------------------
// Border (edge) width
// ---------------------------------------------------------------------------

test('categoryBorderWidthPx exists, defaults to 1, and is clamped to a reasonable range', () => {
  const store = new WidgetStore({ loadJson: (n, f) => f, saveJson: () => {} });
  const w = store.create('Test');
  assert.equal(w.categoryBorderWidthPx, 1, 'a brand new widget has no default width, or the wrong one');
  assert.match(
    storeSrc,
    /categoryBorderWidthPx:\s*\n\s*typeof widget\.categoryBorderWidthPx === 'number'\s*\n\s*\? Math\.max\(1, Math\.min\(6, Math\.round\(widget\.categoryBorderWidthPx\)\)\)\s*\n\s*: 1,/,
    'normalizeWidget no longer clamps an existing/legacy value into 1-6'
  );
  assert.match(storeSrc, /'categoryBorderWidthPx',/, 'the field is missing from SHAREABLE_FIELDS - it will not survive a share code');
});

test('setCategoryBorderWidth clamps at the point of write, not just at load - update() bypasses normalizeWidget', () => {
  const fn = managerSrc.match(/function setCategoryBorderWidth\(id, px\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'setCategoryBorderWidth has been restructured');
  assert.match(
    fn[1],
    /Math\.max\(1, Math\.min\(6, Math\.round\(n\)\)\)/,
    'the setter no longer clamps - a stray IPC call or corrupted share code could write anything until the next restart'
  );
});

test('every hop of the width control exists: IPC, preload, and the main-window wiring', () => {
  assert.match(mainSrc, /ipcMain\.handle\('widget:setCategoryBorderWidth', \(_event, \{ id, px \}\) =>/, 'the IPC handler is missing');
  assert.match(
    preloadSrc,
    /setWidgetCategoryBorderWidth: \(id, px\) => ipcRenderer\.invoke\('widget:setCategoryBorderWidth', \{ id, px \}\),/,
    'the preload bridge is missing'
  );
  assert.match(html, /id="widget-border-width-slider"/, 'the slider is missing from the settings panel');
  assert.match(rendererSrc, /window\.eqTracker\.setWidgetCategoryBorderWidth\(selectedId, px\)/, 'the slider never actually calls the bridge');
});

test('the width control is hidden until BOTH icon mode and the colour-edge toggle are on', () => {
  const shapeFn = rendererSrc.match(/const showsIconOnly = has\('display-choice'\)[\s\S]*?\n {4}borderWidthRowEl\.style\.display = ([^;]+);/);
  assert.ok(shapeFn, 'the shape-driven visibility line is missing or has moved');
  assert.match(shapeFn[1], /showsIconOnly && widget\.categoryBordersEnabled !== false/, 'the row shows regardless of icon-mode or the colour-edge toggle');

  const liveFn = rendererSrc.match(/categoryBordersCheckbox\.addEventListener\('change', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(liveFn, 'the checkbox\'s change handler is missing or restructured');
  assert.match(liveFn[1], /borderWidthRowEl\.style\.display = showsIconOnly && categoryBordersCheckbox\.checked/, 'flipping the checkbox does not immediately show/hide the width row');
});

test('the width slider is capped at 1-6 in the HTML too, and scales a box-shadow, not border-width, to avoid reflow', () => {
  assert.match(html, /id="widget-border-width-slider" min="1" max="6" step="1"/, 'the slider\'s own bounds have changed');
  assert.match(
    overlayCss,
    /box-shadow: inset 0 0 0 var\(--cat-border-width, 1px\) var\(--cat-color\);/,
    'the coloured edge no longer scales via the box-shadow variable - a real border-width would reflow every tile as it grew'
  );
  assert.match(
    overlaySrc,
    /document\.documentElement\.style\.setProperty\('--cat-border-width', `\$\{config\.categoryBorderWidthPx \|\| 1\}px`\);/,
    'the CSS variable is no longer set from the widget\'s own width'
  );
});

module.exports = () => report('sidebar-status-and-border-width');
if (require.main === module) report('sidebar-status-and-border-width').then((n) => process.exit(n ? 1 : 0));
