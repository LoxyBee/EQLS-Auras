'use strict';
/**
 * Right-click on a sidebar aura name: Rename and Delete. The owner's request, and a plain DOM
 * menu rather than Electron's native Menu module - the sidebar already does everything else in
 * the renderer, and two items do not need a round trip through the main process to draw.
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

test('Rename asks for a new name and applies it the same way the settings box does', () => {
  const fn = js.match(/sidebarContextRenameBtn\.addEventListener\('click', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(fn, 'the rename handler has been restructured');
  assert.match(fn[1], /window\.prompt\(/);
  assert.match(fn[1], /if \(name === null\) return;/, 'Cancel must not rename to an empty string');
  assert.match(fn[1], /window\.eqTracker\.setWidgetName\(id, name\.trim\(\) \|\| 'Aura'\)/);
});

test('Delete reuses the real confirm-and-delete flow, not a second copy of it', () => {
  const fn = js.match(/sidebarContextDeleteBtn\.addEventListener\('click', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(fn, 'the delete handler has been restructured');
  assert.match(fn[1], /handleDelete\(id\)/, 'a second delete path with its own confirm text would drift from the real one');
});

test('Self Buffs cannot be deleted from here either', () => {
  // deleteBtn on the settings page already hides for an undeletable widget - this is the same
  // rule applied to the menu, not a separate one that could disagree with it.
  const fn = js.match(/function openSidebarContextMenu\(widgetId, x, y\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'openSidebarContextMenu has been restructured');
  assert.match(fn[1], /widget\.deletable === false \? 'none' : ''/);
});

test('it looks like part of this app, not a browser default menu', () => {
  assert.match(css, /\.context-menu\s*\{/);
  assert.match(css, /\.context-menu button\.danger\s*\{[^}]*color:\s*var\(--danger\)/);
});

module.exports = () => report('sidebar-context-menu');
if (require.main === module) process.exit(report('sidebar-context-menu') ? 1 : 0);
