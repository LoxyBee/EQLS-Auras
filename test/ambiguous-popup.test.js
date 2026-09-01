'use strict';
/**
 * The ambiguous-cast popup (ambiguousPopup.js) resolves "which of these spells did I cast" mid-fight.
 * Two properties matter and are easy to regress:
 *   - it must never take focus from EQ (appears via showInactive, window is focusable:false), and
 *   - it must stay a real interactive window, never click-through.
 * Structural check on the source - the real window behaviour is a docs/TESTING.md live item.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..', 'src');
const src = fs.readFileSync(path.join(ROOT, 'main', 'ambiguousPopup.js'), 'utf8');
const rendererJs = fs.readFileSync(path.join(ROOT, 'renderer', 'ambiguous-popup', 'ambiguous-popup.js'), 'utf8');

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

module.exports = () => report('ambiguous-popup');
if (require.main === module) report('ambiguous-popup').then((n) => process.exit(n ? 1 : 0));
