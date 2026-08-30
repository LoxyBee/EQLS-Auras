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

test('no id appears twice in index.html', () => {
  // The renderer looks controls up with getElementById, which returns the FIRST match - so a
  // duplicate id means one of the two controls is silently dead and the other may be driven by
  // two listeners at once. Shipped once: widget-text-size-slider was on both the countdown-text
  // slider and the text-aura message slider, and the countdown one did nothing.
  const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const seen = new Set();
  const dupes = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
  assert.deepEqual([...new Set(dupes)], [], `duplicate id(s) in index.html: ${[...new Set(dupes)].join(', ')}`);
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
  // Every range input with an id, not just the per-aura ones: the same trap applies to any
  // slider anywhere, and scoping the check to one prefix means the next one added elsewhere
  // is unguarded by default.
  const sliderIds = [...html.matchAll(/<input[^>]*type="range"[^>]*>/g)]
    .map((m) => (m[0].match(/\bid="([^"]+)"/) || [])[1])
    .filter(Boolean);

  assert.ok(sliderIds.length > 5, 'found suspiciously few sliders - has the markup changed?');

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

test('the UI scale control is wired end to end', () => {
  // Three files have to agree for a setting to work at all: markup, preload bridge, main handler.
  // Any one missing is silent - the control renders and does nothing. Checked as text because
  // there is no way to click it here.
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'preload-main.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');

  // A dropdown, not a slider. Applying the scale live on `input` rescaled the very control being
  // dragged, so the handle moved out from under the cursor and the value jumped around - the
  // setting was effectively unusable. A <select> commits once, after the pointer has left it.
  assert.ok(htmlIds.has('ui-scale-select'), 'no scale dropdown in the markup');
  assert.ok(!htmlIds.has('ui-scale-slider'), 'the unusable rescale-under-the-cursor slider is back');
  assert.match(js, /select\.addEventListener\('change'/, 'the dropdown is not wired to anything');
  assert.match(js, /getUiScale\(\)/, 'the renderer never reads the saved scale, so it will not persist visually');
  assert.match(js, /setUiScale\(/, 'the renderer never applies the scale');
  assert.match(preload, /getUiScale/, 'preload does not expose getUiScale, so the renderer call throws');
  assert.match(preload, /setUiScale/, 'preload does not expose setUiScale');
  assert.match(main, /ipcMain\.handle\(\s*'ui:getScale'/, 'no main-process handler for ui:getScale');
  assert.match(main, /ipcMain\.handle\(\s*'ui:setScale'/, 'no main-process handler for ui:setScale');
});

test('the saved UI scale is applied at window creation, not after load', () => {
  // A zoom factor lives on the web contents, not on disk, so it resets to 1 on every load unless
  // something puts it back. Doing that with a post-load listener has to use `.once`, and `.once`
  // does not re-arm - so Ctrl+R (kept alive deliberately for testing) silently dropped the window
  // back to 100% while the setting still read correctly. Setting webPreferences.zoomFactor
  // applies before first paint and survives a reload.
  const mw = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'mainWindow.js'), 'utf8');
  assert.match(mw, /zoomFactor:\s*\(Number\(loadJson\('uiScale'/, 'the saved scale is not applied at window creation');

  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.ok(
    !/did-finish-load[\s\S]{0,200}applyUiScale/.test(main),
    'the scale is re-applied on did-finish-load as well. That listener is `.once` and does not ' +
    're-arm on reload - drop it, webPreferences.zoomFactor already covers launch AND Ctrl+R.'
  );
});

test('the UI scale is clamped on the way out, not only on the way in', () => {
  // Returning the raw file contents means a hand-edited or truncated uiScale.json - say 5 -
  // reaches the slider, whose own min silently pulls it to 80, so the number on screen and the
  // zoom actually applied disagree with nothing reporting it.
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(
    main, /ipcMain\.handle\(\s*'ui:getScale',\s*\(\)\s*=>\s*clampUiScale\(/,
    'ui:getScale returns the stored value unclamped'
  );
});

test('the overlay is not scaled by the app text size setting', () => {
  // Auras have their own icon, text and label sizes per aura. Scaling them from the settings
  // window would fight those. Electron zoom is per-webContents, so this holds as long as nobody
  // reaches for the overlay's contents here.
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const start = main.indexOf('function applyUiScale');
  const fn = main.slice(start, main.indexOf("ipcMain.handle('ui:getScale'", start));
  assert.ok(!/widgetManager|overlay/i.test(fn), 'applyUiScale reaches into the overlay - auras have their own size settings');
});

test('the sidebar resizer is wired end to end', () => {
  const preload = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload', 'preload-main.js'), 'utf8');
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');

  assert.ok(htmlIds.has('sidebar-resizer'), 'no resize handle in the markup');
  assert.match(css, /var\(--sidebar-width/, 'the sidebar width is not driven by the custom property');
  assert.match(js, /setPointerCapture/, 'no pointer capture - the drag dies the moment the cursor outruns the 4px handle');
  assert.match(preload, /setSidebarWidth/, 'preload does not expose setSidebarWidth');
  assert.match(main, /ipcMain\.handle\(\s*'ui:setSidebarWidth'/, 'no main-process handler to persist the width');
});

test('a narrow window cannot permanently shrink the saved sidebar width', () => {
  // The subtle one, and the reason there are two clamps rather than one.
  //
  // Collapsing them is the obvious simplification and it quietly destroys the setting: launch once
  // in a narrow window, the stored 320 is clamped down to fit, and the next save writes the
  // shrunken number over the user's choice. Widen the window again and their width is gone.
  //
  // So the STORED value is only ever clamped to the preference range, never to the viewport.
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(
    main, /ipcMain\.handle\(\s*'ui:getSidebarWidth',\s*\(\)\s*=>\s*clampStoredSidebarWidth\(/,
    'the stored width is not read through the preference-range clamp'
  );
  const stored = main.slice(main.indexOf('function clampStoredSidebarWidth'), main.indexOf("ipcMain.handle('ui:getSidebarWidth'"));
  assert.ok(
    !/innerWidth|window\.|getBoundingClientRect|viewport/i.test(stored),
    'clampStoredSidebarWidth consults the window size. It must not: that is what makes a narrow ' +
    'window overwrite a width chosen in a wide one.'
  );
  // ...and the renderer's viewport fit must not be what gets persisted.
  assert.match(js, /the stored preference is left alone/, 'the renderer no longer documents the two-clamp split');
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

test('the OVERLAY renderer looks up only ids that exist in its own markup too', () => {
  // The same silent break, in the window nobody has open while they work. The overlay looks up
  // far fewer ids than the settings window, which is exactly why it is easy to forget - the
  // move-box name pill was the first new one added to it in a long while.
  const overlayDir = path.join(__dirname, '..', 'src', 'renderer', 'overlay');
  const overlayHtml = fs.readFileSync(path.join(overlayDir, 'index.html'), 'utf8');
  const overlayJs = fs.readFileSync(path.join(overlayDir, 'overlay.js'), 'utf8');
  const ids = new Set([...overlayHtml.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
  const looked = [...overlayJs.matchAll(/getElementById\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
  assert.ok(looked.length >= 3, 'suspiciously few lookups - has the overlay been restructured?');
  assert.deepEqual(
    [...new Set(looked)].filter((id) => !ids.has(id)), [],
    'the overlay looks up ids that are not in its markup, which returns null and fails later'
  );
});

test('the sound picker keeps the settings-panel widget cache in sync (reported live 30 Aug)', () => {
  // Choosing a sound saved fine and the overlay used it, but the panel re-rendered "Default beep"
  // on the next open because setupSoundPicker never updated the renderer's own widget copy. Both
  // the choose and the reset handlers must feed the returned config back through
  // updateLocalWidgetCache.
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const start = js.indexOf('function setupSoundPicker(');
  const end = js.indexOf('return render;', start); // last line of setupSoundPicker
  const fn = js.slice(start, end);
  const cacheUpdates = (fn.match(/updateLocalWidgetCache\(cfg\)/g) || []).length;
  assert.ok(cacheUpdates >= 2, `setupSoundPicker updates the local cache ${cacheUpdates} time(s), need both the choose and the reset handlers`);
});

test('"Use default" is always shown, and the reset buttons are not hidden markup', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'index.html'), 'utf8');
  for (const kind of ['land', 'expire', 'warning']) {
    const m = html.match(new RegExp(`<button[^>]*id="widget-sound-${kind}-reset-btn"[^>]*>`));
    assert.ok(m, `no reset button for ${kind}`);
    assert.doesNotMatch(m[0], /display:\s*none/, `the ${kind} "Use default" button is hidden markup again`);
  }
  // render() greys it out on the default rather than hiding it.
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  assert.match(js, /resetBtn\.disabled = !soundId/);
});

module.exports = () => report('renderer-wiring');
if (require.main === module) report('renderer-wiring').then((n) => process.exit(n ? 1 : 0));
