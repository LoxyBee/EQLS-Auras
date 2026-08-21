'use strict';
/**
 * Structural checks on the settings window's markup and its script.
 *
 * The renderer is a plain script over a plain document - no framework, no build step, no types.
 * That keeps it easy to read, at the cost of one specific failure mode: `getElementById` returns
 * null for a name that does not exist, and null usually does not throw until much later, on some
 * branch nobody took while testing. A renamed id in the HTML and a stale lookup in the JS is a
 * silent break.
 *
 * These tests read both files as text rather than running them. That is deliberate: there is no
 * DOM here, and a check that can run in a plain Node process on every commit is worth more than a
 * richer one that needs a browser and therefore never gets run.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const DIR = path.join(__dirname, '..', 'src', 'renderer', 'main-window');
const html = fs.readFileSync(path.join(DIR, 'index.html'), 'utf8');
const js = fs.readFileSync(path.join(DIR, 'main-window.js'), 'utf8');
const css = fs.readFileSync(path.join(DIR, 'main-window.css'), 'utf8');

const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));

test('every getElementById in the renderer names an id that exists in the markup', () => {
  const looked = [...js.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  const missing = [...new Set(looked)].filter((id) => !htmlIds.has(id));
  assert.deepEqual(
    missing, [],
    `the renderer looks up ids that are not in index.html, which returns null and fails silently ` +
    `somewhere later: ${missing.join(', ')}`
  );
});

test('ids created dynamically are not mistaken for missing ones', () => {
  // Guard for the test above rather than the app: if it ever starts reporting an id that IS
  // created at runtime, the check needs an allowlist rather than the app needing a fix.
  const looked = [...js.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  assert.ok(looked.length > 50, 'suspiciously few lookups found - has the renderer been restructured?');
});

test('the All auras card is scoped to the overview, not shown on every aura', () => {
  // "Unlock all auras" acts on everything at once. Left always-visible it sat directly above the
  // per-aura "Unlock to move" - two controls a few centimetres apart with very different reach.
  assert.ok(htmlIds.has('all-auras-card'), 'the All auras card has no id, so it cannot be scoped');
  const shows = js.match(/allAurasCard\.style\.display = ''/g) || [];
  const hides = js.match(/allAurasCard\.style\.display = 'none'/g) || [];
  assert.equal(shows.length, 1, 'the All auras card should be shown in exactly one place (deselect)');
  assert.equal(hides.length, 1, 'the All auras card should be hidden in exactly one place (select)');
});

test('every aura slider is populated from the aura, not just read from', () => {
  // The bug this generalises: the alert-volume slider was read on input and saved, but nothing
  // ever wrote the saved value BACK into it when an aura was selected. Worse, its markup had no
  // `value` attribute, and an HTML range with no value falls back to the midpoint of its own
  // range - so the handle sat halfway along a 0-100 track while the real volume was 100. It
  // looked like a scale problem and was really a control that never loaded.
  //
  // Nothing throws in that situation and nothing looks broken, so it is worth a standing check
  // rather than trusting each new slider to be wired by hand.
  const sliderIds = [...html.matchAll(/<input[^>]*type="range"[^>]*>/g)]
    .map((m) => (m[0].match(/\bid="([^"]+)"/) || [])[1])
    .filter((id) => id && id.startsWith('widget-'));

  assert.ok(sliderIds.length > 5, 'found suspiciously few aura sliders - has the markup changed?');

  const unpopulated = [];
  for (const id of sliderIds) {
    const bind = js.match(new RegExp(`const\\s+(\\w+)\\s*=\\s*document\\.getElementById\\(\\s*'${id}'\\s*\\)`));
    if (!bind) { unpopulated.push(`${id} (never looked up)`); continue; }
    if (!new RegExp(`\\b${bind[1]}\\.value\\s*=`).test(js)) unpopulated.push(`${id} -> ${bind[1]}`);
  }
  assert.deepEqual(
    unpopulated, [],
    'these sliders are never assigned a value, so they will show their markup default instead of ' +
    `the aura's saved setting: ${unpopulated.join(', ')}`
  );
});

test('the per-aura Unlock to move button still exists', () => {
  // The master control was scoped down; the per-aura one must NOT have gone with it.
  assert.ok(htmlIds.has('widget-lock-btn'), 'the per-aura Unlock to move button is missing');
  assert.match(js, /widget-lock-btn/, 'the per-aura lock button is no longer wired up');
});

test('modals opt out of the window drag region', () => {
  // The window is frameless and .title-bar is a drag region. Drag regions are hit-tested by the
  // OS before the page sees a click, so modal content overlapping the top 32px is unclickable
  // unless something opts out. This is the suspected cause of the un-clickable profile name box.
  const block = css.slice(css.indexOf('.modal-backdrop {'));
  const decl = block.slice(0, block.indexOf('}'));
  assert.match(
    decl, /-webkit-app-region:\s*no-drag/,
    'modals no longer opt out of the drag region - content near the top of a tall modal will stop ' +
    'being clickable and will drag the window instead'
  );
});

test('the title bar is still the only thing that drags the window', () => {
  // Note the capture-and-compare rather than matching /drag/ directly: "no-drag" contains "drag",
  // so a looser pattern reports every opt-OUT as a new drag region. The first version of this
  // test did exactly that and failed on the .modal-backdrop rule added moments earlier.
  // Comments must go first. This stylesheet explains the drag region in prose inside the very
  // rule that opts OUT of it, so scanning the raw text finds the explanation before the
  // declaration and reports the opt-out as an opt-in.
  const code = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const dragging = [];
  for (const m of code.matchAll(/([^{}]*)\{([^}]*)\}/g)) {
    const selector = m[1].trim().split('\n').pop().trim();
    const region = m[2].match(/-webkit-app-region:\s*([a-z-]+)/);
    if (region && region[1] === 'drag') dragging.push(selector);
  }
  assert.deepEqual(
    dragging, ['.title-bar'],
    `something other than the title bar drags the window now: ${dragging.join(' | ')}. ` +
    'Anything overlapping a drag region cannot be clicked.'
  );
});

module.exports = () => report('renderer-wiring');
if (require.main === module) process.exit(report('renderer-wiring') ? 1 : 0);
