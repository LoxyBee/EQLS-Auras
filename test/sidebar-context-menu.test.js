'use strict';
/**
 * Right-click on a sidebar aura name: Rename, Duplicate, Delete. The owner's request, and a plain
 * DOM menu rather than Electron's native Menu module - the sidebar already does everything else
 * in the renderer, and these do not need a round trip through the main process to draw.
 *
 * Duplicate added live 24 Aug, requested alongside Rename and Delete - it reuses
 * duplicateWidgetBtn's exact call rather than a second, subtly different path, the same lesson
 * Rename's own window.prompt() bug already taught this file.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const html = read('src', 'renderer', 'main-window', 'index.html');
const js = read('src', 'renderer', 'main-window', 'main-window.js');
const css = read('src', 'renderer', 'main-window', 'main-window.css');

test('the menu markup exists, closed by default', () => {
  assert.match(html, /id="sidebar-context-menu" class="context-menu" style="display:none"/);
  assert.match(html, /id="sidebar-context-rename"/);
  assert.match(html, /id="sidebar-context-duplicate"/);
  assert.match(html, /id="sidebar-context-delete" class="danger"/, 'Delete is not styled as dangerous');
});

test('right-clicking a row opens it at the cursor, not the native menu', () => {
  const fn = js.match(/row\.addEventListener\('contextmenu', \(e\) => \{([\s\S]*?)\n {6}\}\);/);
  assert.ok(fn, 'the row contextmenu listener has been restructured');
  assert.match(fn[1], /e\.preventDefault\(\);/, 'the OS/Chromium context menu would also open');
  assert.match(fn[1], /openSidebarContextMenu\(widget\.id, e\.clientX, e\.clientY\)/);
});

test('the menu clamps itself on screen rather than drawing off it', () => {
  const fn = js.match(/function openSidebarContextMenu\(widgetId, x, y\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'openSidebarContextMenu has been restructured');
  assert.match(fn[1], /Math\.min\(x, maxX\)/);
  assert.match(fn[1], /Math\.min\(y, maxY\)/);
});

test('it closes on outside click, Escape, or a second right-click elsewhere', () => {
  assert.match(js, /window\.addEventListener\('click', \(e\) => \{/);
  assert.match(js, /e\.key === 'Escape'\) closeSidebarContextMenu\(\)/);
  assert.match(js, /window\.addEventListener\('contextmenu', \(e\) => \{\s*\n\s*if \(sidebarContextMenuEl\.style\.display/);
});

test('Rename is a popup that does not navigate into the aura - reported live 25 Aug as simpler', () => {
  // window.prompt() (the very first version of this) does nothing in Electron - Chromium's
  // renderer never implements it, so the dialog never appeared and this silently did nothing.
  // Reported live as "rename does nothing". Checked against the actual handler body below, not
  // the whole file, since this file's own comments mention window.prompt() by name while
  // explaining why it was replaced.
  // First fix (open the aura's own settings page and focus its Name field there) worked in
  // principle but tripped over an unrelated cross-function scope bug that made every
  // selectWidget() call throw partway through, silently skipping anything chained after it -
  // Rename's own focus()/select() included. Simplified instead: a plain popup, no navigation, no
  // dependency on the settings panel rendering correctly first.
  assert.match(html, /id="rename-widget-modal-backdrop" class="modal-backdrop" style="display:none"/);
  assert.match(html, /id="rename-widget-input"/);
  const fn = js.match(/sidebarContextRenameBtn\.addEventListener\('click', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(fn, 'the rename handler has been restructured');
  assert.match(fn[1], /openRenameModal\(id\)/);
  assert.doesNotMatch(fn[1], /focusWidget/, 'still navigating into the aura, not a plain popup');
  assert.doesNotMatch(fn[1], /window\.prompt\(/, 'window.prompt is unimplemented in Electron and does nothing');
});

test('Rename pre-fills the current name and saves through the real setWidgetName call', () => {
  const openFn = js.match(/function openRenameModal\(id\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(openFn, 'openRenameModal has been restructured');
  assert.match(openFn[1], /renameWidgetInput\.value = widget\.name;/, 'the box does not start with the current name');
  assert.match(openFn[1], /renameWidgetInput\.focus\(\)/);
  assert.match(openFn[1], /renameWidgetInput\.select\(\)/);
  const saveFn = js.match(/function saveRename\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(saveFn, 'saveRename has been restructured');
  assert.match(saveFn[1], /window\.eqTracker\.setWidgetName\(renameWidgetId, renameWidgetInput\.value\.trim\(\) \|\| 'Aura'\)/);
});

test('Duplicate reuses the exact same call the settings-page button makes', () => {
  const fn = js.match(/sidebarContextDuplicateBtn\.addEventListener\('click', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(fn, 'the duplicate handler has been restructured');
  assert.match(
    fn[1],
    /window\.eqTracker\.duplicateWidget\(id\)\.then\(\(config\) => \{/,
    'a second duplicate path with its own logic would drift from duplicateWidgetBtn\'s'
  );
  assert.match(fn[1], /if \(config\) focusWidget\(config\.id\);/, 'must open the new copy, not leave you on the original');
});

test('Delete reuses the real confirm-and-delete flow, not a second copy of it', () => {
  const fn = js.match(/sidebarContextDeleteBtn\.addEventListener\('click', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(fn, 'the delete handler has been restructured');
  assert.match(fn[1], /handleDelete\(id\)/, 'a second delete path with its own confirm text would drift from the real one');
});

test('Self Buffs cannot be deleted OR duplicated from here either', () => {
  // deleteBtn/duplicateWidgetBtn on the settings page already hide for Self Buffs - this is the
  // same rule applied to the menu, not a separate one that could disagree with it.
  const fn = js.match(/function openSidebarContextMenu\(widgetId, x, y\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'openSidebarContextMenu has been restructured');
  assert.match(fn[1], /widget\.deletable === false \? 'none' : ''/);
  assert.match(fn[1], /widget\.kind === 'self-buffs-builtin' \? 'none' : ''/);
});

// ---------------------------------------------------------------------------
// Export and Reset - reported live 25 Aug: "any button that goes into the manage
// aura card, should be added to the right click menu... this is just a shortcut
// to these buttons."
// ---------------------------------------------------------------------------

test('the menu offers every button Manage aura does, not just three of the four', () => {
  assert.match(html, /id="sidebar-context-export"/);
  assert.match(html, /id="sidebar-context-reset" class="danger"/, 'Reset is not styled as dangerous, unlike its Manage-aura twin');
});

test('Export is a popup that does not navigate into the aura, same simplification as Rename', () => {
  assert.match(html, /id="export-widget-modal-backdrop" class="modal-backdrop" style="display:none"/);
  assert.match(html, /id="export-widget-modal-output"/);
  const fn = js.match(/sidebarContextExportBtn\.addEventListener\('click', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(fn, 'the export handler has been restructured');
  assert.match(fn[1], /openExportModal\(id\)/);
  assert.doesNotMatch(fn[1], /focusWidget/, 'still navigating into the aura, not a plain popup');
});

test('openExportModal reuses the exact same exportWidget/soundWarningFor calls the settings-page button makes', () => {
  const fn = js.match(/function openExportModal\(id\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'openExportModal has been restructured');
  assert.match(
    fn[1],
    /window\.eqTracker\.exportWidget\(id\)\.then\(\(code\) => \{/,
    'a second export path with its own logic would drift from handleExport\'s'
  );
  assert.match(fn[1], /soundWarningFor\(findWidget\(id\)\)/, 'the sound-file warning is missing from the popup');
});

test('exportBtn itself was refactored to call the same handleExport, not duplicated', () => {
  assert.match(js, /function handleExport\(id\) \{([\s\S]*?)\n {2}\}/, 'handleExport is missing - the button was not actually refactored to share it');
  assert.match(js, /exportBtn\.addEventListener\('click', \(\) => handleExport\(selectedId\)\);/);
});

test('Reset reuses the real confirm-and-reset flow, not a second copy of it', () => {
  const fn = js.match(/sidebarContextResetBtn\.addEventListener\('click', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(fn, 'the reset handler has been restructured');
  assert.match(fn[1], /handleReset\(id\)/, 'a second reset path with its own confirm text would drift from the real one');
});

test('Reset only appears on an aura built from a premade, same rule the settings page uses', () => {
  const fn = js.match(/function openSidebarContextMenu\(widgetId, x, y\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'openSidebarContextMenu has been restructured');
  assert.match(fn[1], /widget && widget\.premadeOrigin \? '' : 'none'/, 'Reset is not gated by premadeOrigin here');
});

test('it looks like part of this app, not a browser default menu', () => {
  assert.match(css, /\.context-menu\s*\{/);
  assert.match(css, /\.context-menu button\.danger\s*\{[^}]*color:\s*var\(--danger\)/);
});

// ---------------------------------------------------------------------------
// focusWidget - a real bug, once the drag-reorder row also carried data-widget-id
// ---------------------------------------------------------------------------

test('focusWidget targets the actual nav button, not the row wrapping it', () => {
  // Both the row (added for drag-to-reorder, this same file's earlier work) and the button inside
  // it carry data-widget-id, and the row - the ancestor - comes first in document order. A bare
  // `[data-widget-id="..."]` therefore matched the ROW, which has no data-page attribute, so
  // activateNavButton(row) read pageId as undefined and turned every page's "active" class off -
  // nothing left visible at all. Reported as "adding a new aura takes you to a blank menu rather
  // than into the new aura directly," which is exactly what a page with no active section is.
  const fn = js.match(/function focusWidget\(id\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'focusWidget has been restructured');
  assert.match(
    fn[1],
    /submenuEl\.querySelector\(`button\.nav-sub-btn\[data-widget-id="\$\{id\}"\]`\)/,
    'the selector is not specific to the button - the row would win the match again'
  );
});

module.exports = () => report('sidebar-context-menu');
if (require.main === module) report('sidebar-context-menu').then((n) => process.exit(n ? 1 : 0));
