'use strict';
/**
 * The two mid-fight popups (ambiguousPopup.js "which spell did I cast", zonePromptPopup.js the
 * travel picker) must not strand the player away from EQ (P3-4):
 *   - the ambiguous popup is button-only, so it's `focusable: false` - never takes focus at all;
 *   - the zone popup has a search box the user types into, so it CAN'T be focusable:false -
 *     instead every close path hands focus back to EQ via returnFocusAfterZonePrompt().
 * Neither may be click-through. Structural check on the source - real window behaviour is a
 * docs/TESTING.md live item.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..', 'src');
const src = fs.readFileSync(path.join(ROOT, 'main', 'ambiguousPopup.js'), 'utf8');
const rendererJs = fs.readFileSync(path.join(ROOT, 'renderer', 'ambiguous-popup', 'ambiguous-popup.js'), 'utf8');
const zoneSrc = fs.readFileSync(path.join(ROOT, 'main', 'zonePromptPopup.js'), 'utf8');
const mainSrc = fs.readFileSync(path.join(ROOT, 'main', 'main.js'), 'utf8');

test('the popup window is focusable:false so a click never pulls foreground off EQ (P3-4)', () => {
  const opts = src.match(/new BrowserWindow\(\{[\s\S]*?\}\);/);
  assert.ok(opts, 'BrowserWindow options block not found');
  assert.match(opts[0], /focusable:\s*false/, 'the popup can steal focus from the game on click');
});

test('the popup appears without activating (showInactive, not show/focus)', () => {
  assert.match(src, /\.showInactive\(\)/);
  assert.ok(!/\bwin\.show\(\)|\bwin\.focus\(\)/.test(src), 'the popup activates itself instead of showInactive');
});

test('it is never made click-through - setIgnoreMouseEvents must not appear', () => {
  assert.ok(!/setIgnoreMouseEvents/.test(src), 'a click-through ambiguous popup cannot be answered');
});

test('the renderer resolves via buttons only - no keyboard/text input a focusable:false window would break', () => {
  assert.match(rendererJs, /createElement\('button'\)/);
  assert.ok(!/createElement\('input'\)|createElement\('textarea'\)|\.focus\(\)|addEventListener\('key/.test(rendererJs),
    'the popup renderer relies on keyboard/text input, which focusable:false disables');
});

test('the zone-prompt popup is NOT focusable:false (it has a search box) but returns focus to EQ on close', () => {
  const opts = zoneSrc.match(/new BrowserWindow\(\{[\s\S]*?\}\);/);
  assert.ok(opts, 'zonePromptPopup BrowserWindow block not found');
  assert.ok(!/focusable:\s*false/.test(opts[0]),
    'the zone popup is focusable:false - the user cannot type into its search box');
  assert.match(zoneSrc, /\.showInactive\(\)/, 'it should still not grab focus on appear');
});

test('every zone-prompt close path hands focus back to EQ (returnFocusAfterZonePrompt)', () => {
  assert.match(mainSrc, /function returnFocusAfterZonePrompt\(\)\s*\{\s*\n\s*if \(!pendingZonePrompt\) focusGameWindow\(\);/,
    'returnFocusAfterZonePrompt missing or not guarded on a chained follow-up prompt');
  // it is called from resolve, dismiss, stopTracking, and the /tell-toggle-close path
  const calls = (mainSrc.match(/returnFocusAfterZonePrompt\(\)/g) || []).length;
  assert.ok(calls >= 5, `expected the helper defined + called from all 4 close paths, saw ${calls} mentions`);
});

module.exports = () => report('ambiguous-popup');
if (require.main === module) report('ambiguous-popup').then((n) => process.exit(n ? 1 : 0));
