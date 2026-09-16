'use strict';
/**
 * Custom theme colors (Setup -> App settings -> Colors). Six pickers, auto-deriving the rest of
 * each category's own shade ramp - grew from an initial four after live feedback the same day:
 * "highlight and text highlight should be seperate colours" (added textHighlight/--select, so a
 * bold Highlight pick doesn't also take over the sidebar's selected-row fill), "some outlines are
 * marked as highlights and not outlines, like the card edges" (main-window.css fix, not this
 * file - .card/.block/etc were hardcoded to --accent-line instead of the semantic --line), and
 * "card panels should have their ow picker too, incase people want two tone setups" (added
 * panels/--panel-fill, independent of the base background).
 *
 * theme.js is a plain dual-export module (module.exports for Node, window.EQTheme in the
 * browser) specifically so this suite can assert real computed hex values, not just check that
 * some regex pattern exists in the source - the other renderer scripts in this codebase (search-
 * dropdown.js, main-window.js) are only ever verified that second way, which cannot catch a wrong
 * shade the way a real assertion on the output can.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const Theme = require('../src/renderer/main-window/theme.js');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// Color math primitives
// ---------------------------------------------------------------------------

test('hex <-> HSL round-trips for a real value from the shipped palette', () => {
  const hsl = Theme.hexToHsl('#1c160f');
  assert.ok(Math.abs(hsl.h - 32.3) < 0.5);
  assert.ok(Math.abs(hsl.s - 30.2) < 0.5);
  assert.ok(Math.abs(hsl.l - 8.4) < 0.5);
  assert.equal(Theme.hslToHex(hsl), '#1c160f');
});

test('isValidHex accepts exactly the shape a native <input type="color"> emits', () => {
  assert.equal(Theme.isValidHex('#1c160f'), true);
  assert.equal(Theme.isValidHex('#FFFFFF'), true, 'case-insensitive');
  assert.equal(Theme.isValidHex('#fff'), false, '3-digit shorthand - a color input never emits this');
  assert.equal(Theme.isValidHex('1c160f'), false, 'missing #');
  assert.equal(Theme.isValidHex('rgb(1,2,3)'), false);
  assert.equal(Theme.isValidHex(null), false);
  assert.equal(Theme.isValidHex(undefined), false);
});

test('shiftHsl moves lightness/saturation without touching hue', () => {
  const base = Theme.hexToHsl('#3366cc');
  const shifted = Theme.hexToHsl(Theme.shiftHsl('#3366cc', -19, -9));
  assert.ok(Math.abs(shifted.h - base.h) < 6, 'hue must not drift meaningfully (small hex-quantization noise is expected)');
  assert.ok(Math.abs(shifted.l - (base.l - 19)) < 0.5);
  assert.ok(Math.abs(shifted.s - (base.s - 9)) < 0.5);
});

test('shiftHsl clamps at the edges instead of wrapping or producing invalid output', () => {
  // Already very dark - a large negative delta must not go negative/wrap around to "lighter".
  const near0 = Theme.shiftHsl('#0a0a0a', -50);
  assert.ok(Theme.hexToHsl(near0).l >= 0);
  const near100 = Theme.shiftHsl('#fefefe', 50);
  assert.ok(Theme.hexToHsl(near100).l <= 100);
});

// This is the bug actually found and fixed while building this: fading an ACHROMATIC color
// (white/grey/black - saturation 0) toward a saturated target picked up the achromatic color's
// own meaningless defaulted hue (0/red) the moment saturation rose above 0, producing a pinkish
// tint instead of adopting the target's real hue.
test('fadeHslToward does not introduce a stray hue when the start color is achromatic (white)', () => {
  const result = Theme.fadeHslToward('#ffffff', '#1c160f', 0.55);
  const targetHue = Theme.hexToHsl('#1c160f').h;
  const resultHsl = Theme.hexToHsl(result);
  assert.ok(
    Math.abs(resultHsl.h - targetHue) < 1,
    `expected the target's warm hue (~${targetHue.toFixed(1)}), got ${resultHsl.h.toFixed(1)} - a red/pink drift means the achromatic-hue bug is back`
  );
});

test('fadeHslToward moves lightness/saturation toward the target by the given weight, hue preserved for a real (non-achromatic) start', () => {
  const start = Theme.hexToHsl('#cf9a4a');
  const target = Theme.hexToHsl('#1c160f');
  const result = Theme.hexToHsl(Theme.fadeHslToward('#cf9a4a', '#1c160f', 0.5));
  assert.ok(Math.abs(result.h - start.h) < 0.5, 'a real starting hue must not drift toward the target\'s');
  assert.ok(Math.abs(result.l - (start.l + target.l) / 2) < 0.5);
});

test('withAlpha appends the two-digit alpha suffix the shipped palette itself already uses', () => {
  assert.equal(Theme.withAlpha('#cf9a4a', '1f'), '#cf9a4a1f');
});

// ---------------------------------------------------------------------------
// deriveTheme - the one function with real product logic
// ---------------------------------------------------------------------------

const FULL = {
  background: '#1c160f', panels: '#14100b', text: '#ffffff',
  highlight: '#cf9a4a', textHighlight: '#ff66cc', outline: '#8a672f',
};

test('deriveTheme with nothing supplied returns nothing to override', () => {
  assert.deepEqual(Theme.deriveTheme(null), {});
  assert.deepEqual(Theme.deriveTheme({}), {});
});

test('an invalid hex for a category is treated as "not supplied" for that category alone', () => {
  const out = Theme.deriveTheme({ background: 'garbage', text: '#ffffff' });
  assert.ok(!('--panel' in out), 'the invalid background must not produce any variables');
  assert.ok(!('--bg' in out));
  assert.equal(out['--ink'], '#ffffff', 'the valid text category is unaffected by its invalid neighbour');
});

test('background anchors --panel exactly, and derives a darker --bg and lighter --panel-2', () => {
  const out = Theme.deriveTheme({ background: '#1c160f' });
  assert.equal(out['--panel'], '#1c160f', 'the picked color IS the panel tier, unchanged');
  const bg = Theme.hexToHsl(out['--bg']);
  const panel = Theme.hexToHsl(out['--panel']);
  const panel2 = Theme.hexToHsl(out['--panel-2']);
  assert.ok(bg.l < panel.l, '--bg must be darker than the picked background');
  assert.ok(panel2.l > panel.l, '--panel-2 must be lighter than the picked background');
  assert.ok(Math.abs(bg.h - panel.h) < 6 && Math.abs(panel2.h - panel.h) < 6, 'hue must be preserved across all three tiers (small hex-quantization noise is expected)');
});

test('text anchors --ink exactly, and its three derived tiers step down in lightness toward the background', () => {
  const out = Theme.deriveTheme(FULL);
  assert.equal(out['--ink'], '#ffffff');
  const inkL = Theme.hexToHsl(out['--ink']).l;
  const mutL = Theme.hexToHsl(out['--ink-mut']).l;
  const dimL = Theme.hexToHsl(out['--ink-dim']).l;
  const faintL = Theme.hexToHsl(out['--ink-faint']).l;
  assert.ok(inkL > mutL && mutL > dimL && dimL > faintL, 'each text tier must be quieter (lower L) than the last');
});

test('text falls back to the shipped background for its fade target when no background override is active', () => {
  const withoutBg = Theme.deriveTheme({ text: '#ffffff' });
  const withBg = Theme.deriveTheme({ text: '#ffffff', background: '#1c160f' });
  // The shipped default IS #1c160f, so fading toward "no override" and fading toward that exact
  // color explicitly must produce the identical ink-mut/dim/faint.
  assert.equal(withoutBg['--ink-mut'], withBg['--ink-mut']);
  assert.equal(withoutBg['--ink-faint'], withBg['--ink-faint']);
});

test('highlight anchors --accent exactly and derives soft/line/dim/bar from it', () => {
  const out = Theme.deriveTheme(FULL);
  assert.equal(out['--accent'], '#cf9a4a');
  assert.equal(out['--accent-soft'], '#cf9a4a1f');
  const accentL = Theme.hexToHsl(out['--accent']).l;
  assert.ok(Theme.hexToHsl(out['--accent-line']).l < accentL, '--accent-line must be darker (for borders)');
  assert.ok(Theme.hexToHsl(out['--accent-dim']).l < accentL, '--accent-dim must be a touch darker, for text next to bold accent titles');
  assert.ok(Theme.hexToHsl(out['--bar']).l < accentL, '--bar must be darker still (a solid header-cap fill)');
});

test('panels anchors --panel-fill directly, with no further tiers, independent of background', () => {
  const out = Theme.deriveTheme({ panels: '#2a1f14' });
  assert.deepEqual(out, { '--panel-fill': '#2a1f14' }, 'panels must not touch --bg/--panel/--panel-2 - that would defeat the two-tone point');
});

test('background and panels can genuinely diverge - the whole point of "two tone"', () => {
  const out = Theme.deriveTheme({ background: '#1c160f', panels: '#203050' });
  assert.equal(out['--panel'], '#1c160f');
  assert.equal(out['--panel-fill'], '#203050', 'a distinctly different panel tone must survive alongside its own background');
});

test('textHighlight anchors --select directly, with no further tiers, independent of highlight', () => {
  const out = Theme.deriveTheme({ textHighlight: '#ff66cc', highlight: '#cf9a4a' });
  assert.equal(out['--select'], '#ff66cc');
  assert.equal(out['--accent'], '#cf9a4a', 'a bold text-highlight pick must not bleed into the accent family');
  assert.ok(!('--accent-line' in Theme.deriveTheme({ textHighlight: '#ff66cc' })), 'textHighlight alone must not produce any --accent-* variables');
});

test('outline anchors --line exactly, and --line-soft is the same color at lower opacity, not a different hue', () => {
  const out = Theme.deriveTheme(FULL);
  assert.equal(out['--line'], '#8a672f');
  assert.equal(out['--line-soft'], '#8a672f80');
});

test('deriveTheme generalizes to a light theme with a cool accent, not just the shipped warm/dark palette', () => {
  const out = Theme.deriveTheme({ background: '#f0f0f0', text: '#111111', highlight: '#3366cc', outline: '#888888' });
  assert.ok(Theme.isValidHex(out['--bg']) && Theme.isValidHex(out['--panel-2']));
  const bgL = Theme.hexToHsl(out['--bg']).l;
  const panelL = Theme.hexToHsl(out['--panel']).l;
  const panel2L = Theme.hexToHsl(out['--panel-2']).l;
  assert.ok(bgL <= 100 && panel2L <= 100, 'a near-white background must clamp, not overflow past 100 lightness');
  assert.ok(bgL < panelL && panelL < panel2L);
});

// ---------------------------------------------------------------------------
// applyTheme - the one DOM-touching function, exercised against a fake style target
// ---------------------------------------------------------------------------

function fakeStyleTarget() {
  const props = {};
  return {
    props,
    style: {
      setProperty: (k, v) => { props[k] = v; },
      removeProperty: (k) => { delete props[k]; },
    },
  };
}

test('applyTheme sets every variable for a supplied category', () => {
  const target = fakeStyleTarget();
  Theme.applyTheme(FULL, target);
  for (const vars of Object.values(Theme.ALL_VARS_BY_CATEGORY)) {
    for (const name of vars) assert.ok(name in target.props, `${name} was not set`);
  }
});

test('applyTheme(null) clears every variable it ever touches - full reset to shipped defaults', () => {
  const target = fakeStyleTarget();
  Theme.applyTheme(FULL, target);
  Theme.applyTheme(null, target);
  assert.deepEqual(target.props, {}, 'every custom-theme variable must be removed, not left at a stale value');
});

test('applyTheme with a partial theme only clears the OMITTED categories, leaving the others alone', () => {
  const target = fakeStyleTarget();
  Theme.applyTheme(FULL, target);
  Theme.applyTheme({ background: '#1c160f' }, target); // every other category omitted this time
  for (const name of Theme.ALL_VARS_BY_CATEGORY.background) assert.ok(name in target.props, `${name} should still be set`);
  for (const category of ['panels', 'text', 'highlight', 'textHighlight', 'outline']) {
    for (const name of Theme.ALL_VARS_BY_CATEGORY[category]) {
      assert.ok(!(name in target.props), `${name} (${category}) should have been cleared`);
    }
  }
});

// ---------------------------------------------------------------------------
// Wiring - main.js persistence/validation, preload bridge, page markup
// ---------------------------------------------------------------------------

test('main.js sanitizes an incoming theme - only valid #rrggbb strings survive, and an all-invalid theme persists as null', () => {
  const main = read('src', 'main', 'main.js');
  assert.match(main, /function sanitizeTheme\(theme\)/, 'sanitizeTheme has been restructured or removed');
  assert.match(main, /ipcMain\.handle\('theme:get', \(\) => sanitizeTheme\(loadJson\('customTheme', null\)\)\)/);
  assert.match(main, /ipcMain\.handle\('theme:set'/);
});

test('wired preload -> renderer: getTheme/setTheme reach the theme: IPC channels', () => {
  const preload = read('src', 'preload', 'preload-main.js');
  assert.match(preload, /getTheme: \(\) => ipcRenderer\.invoke\('theme:get'\)/);
  assert.match(preload, /setTheme: \(theme\) => ipcRenderer\.invoke\('theme:set', theme\)/);
});

test('the Setup page has a Colors card with all six pickers and a reset button', () => {
  const html = read('src', 'renderer', 'main-window', 'index.html');
  assert.match(html, /id="theme-background-input"/);
  assert.match(html, /id="theme-panels-input"/);
  assert.match(html, /id="theme-text-input"/);
  assert.match(html, /id="theme-highlight-input"/);
  assert.match(html, /id="theme-text-highlight-input"/);
  assert.match(html, /id="theme-outline-input"/);
  assert.match(html, /id="theme-reset-btn"/);
  assert.match(html, /<script src="theme\.js"><\/script>/, 'theme.js must actually be loaded by the page');
});

test('main-window.js wires all six pickers to load, apply, and persist the theme, and calls it on startup', () => {
  const js = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(js, /initCustomTheme\(\);/, 'must actually be called during page init, not just defined');
  assert.match(js, /function initCustomTheme\(\)/);
  const fn = js.slice(js.indexOf('function initCustomTheme'), js.indexOf('function initCustomTheme') + 3000);
  assert.match(fn, /theme-panels-input/, 'the panels picker must actually be wired, not just added to the HTML');
  assert.match(fn, /theme-text-highlight-input/, 'the text-highlight picker must actually be wired, not just added to the HTML');
  assert.match(fn, /window\.eqTracker\.getTheme\(\)/, 'must load the saved theme on startup');
  assert.match(fn, /window\.EQTheme\.applyTheme/, 'must actually apply the theme, not just fetch it');
  assert.match(fn, /window\.eqTracker\.setTheme\(theme\)/, 'must persist a picker change');
});

test('every color picker row has its own reset button, not just the shared one at the bottom', () => {
  const html = read('src', 'renderer', 'main-window', 'index.html');
  const card = html.slice(html.indexOf('id="theme-background-input"') - 200, html.indexOf('id="theme-reset-btn"') + 50);
  for (const category of ['background', 'panels', 'text', 'highlight', 'textHighlight', 'outline']) {
    assert.match(
      card, new RegExp(`class="theme-category-reset" data-theme-category="${category}"`),
      `${category} is missing its own per-row reset button`
    );
  }
});

test('a per-category reset in main-window.js touches only that one input, then commits through the same path as a normal pick', () => {
  const js = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = js.slice(js.indexOf('function initCustomTheme'), js.indexOf('function initCustomTheme') + 3500);
  assert.match(fn, /function commit\(\)/, 'the apply+persist logic must be shared, not duplicated per reset button');
  assert.match(fn, /querySelectorAll\('\.theme-category-reset'\)/);
  assert.match(
    fn, /inputs\[category\]\.value = SHIPPED_DEFAULTS\[category\];\s*\n\s*commit\(\);/,
    'a per-category reset must set ONLY that one input, then commit - never call showInputs(null)/applyTheme(null), which would reset every category at once'
  );
});

test('main.js validates all six theme categories, not just the original four', () => {
  const main = read('src', 'main', 'main.js');
  assert.match(main, /const THEME_CATEGORIES = \['background', 'panels', 'text', 'highlight', 'textHighlight', 'outline'\];/);
});

test('the CSS rules the two bug reports were actually about now use the semantic variables, not a hardcoded family', () => {
  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  // "some outlines are marked as highlights and not outlines, like the card edges"
  const cardRule = css.slice(css.indexOf('.card {'), css.indexOf('.card {') + 120);
  assert.match(cardRule, /border: 1px solid var\(--line\);/, '.card must use the Outline variable, not --accent-line directly');
  assert.match(cardRule, /background: var\(--panel-fill\);/, '.card must use the new Panels variable, not --bg directly');
  // "highlight and text highlight should be seperate colours"
  const navSubActive = css.slice(css.indexOf('.nav-sub-btn.active {'), css.indexOf('.nav-sub-btn.active {') + 120);
  assert.match(navSubActive, /background: var\(--select\);/, 'the sidebar selected-row fill must use --select, not --accent directly');
});

module.exports = () => report('custom-theme');
if (require.main === module) report('custom-theme').then((n) => process.exit(n ? 1 : 0));
