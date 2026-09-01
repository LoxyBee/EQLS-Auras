'use strict';
/**
 * Sidebar folders under Overlay Auras (owner, 1 Sep). Folders group the sidebar list ONLY - they
 * change nothing about what is on screen (loadout profiles own visibility, and that stays the one
 * place to look). Auras are filed by dragging onto a folder header / dragging into its region, or
 * the right-click "Move to..." items. Deleting a folder never deletes its auras.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

function store() {
  let saved;
  return {
    loadJson: (k, f) => (k === 'widgets' ? saved || f : f),
    saveJson: (k, v) => { if (k === 'widgets') saved = JSON.parse(JSON.stringify(v)); },
  };
}

test('a fresh store has an empty folders list; every widget has folderId ""', () => {
  const ws = new WidgetStore(store());
  assert.deepEqual(ws.getFolders(), []);
  assert.equal(ws.create('A').folderId, '');
});

test('create / rename / reorder / collapse folders', () => {
  const s = store();
  const ws = new WidgetStore(s);
  const f1 = ws.createFolder('Combat');
  const f2 = ws.createFolder('Utility');
  assert.equal(f1.name, 'Combat');
  assert.equal(typeof f1.id, 'string');
  assert.deepEqual(ws.getFolders().map((f) => f.name), ['Combat', 'Utility']);

  ws.renameFolder(f1.id, '  Fights  ');
  assert.equal(ws.getFolders()[0].name, 'Fights');

  ws.reorderFolders([f2.id, f1.id]);
  assert.deepEqual(ws.getFolders().map((f) => f.name), ['Utility', 'Fights']);

  ws.setFolderCollapsed(f1.id, true);
  assert.equal(ws.getFolders().find((f) => f.id === f1.id).collapsed, true);

  // persisted + reloaded
  const ws2 = new WidgetStore(s);
  assert.deepEqual(ws2.getFolders().map((f) => f.name), ['Utility', 'Fights']);
  assert.equal(ws2.getFolders().find((f) => f.id === f1.id).collapsed, true);
});

test('setWidgetFolder files an aura; an unknown/blank id means ungrouped', () => {
  const ws = new WidgetStore(store());
  const w = ws.create('Aura');
  const f = ws.createFolder('Box');
  assert.equal(ws.setWidgetFolder(w.id, f.id).folderId, f.id);
  assert.equal(ws.setWidgetFolder(w.id, 'nope').folderId, '', 'unknown folder -> ungrouped');
  assert.equal(ws.setWidgetFolder(w.id, f.id).folderId, f.id);
  assert.equal(ws.setWidgetFolder(w.id, '').folderId, '');
});

test('deleting a folder keeps its auras, just ungroups them', () => {
  const ws = new WidgetStore(store());
  const a = ws.create('A');
  const b = ws.create('B');
  const f = ws.createFolder('Gone');
  ws.setWidgetFolder(a.id, f.id);
  ws.setWidgetFolder(b.id, f.id);
  assert.equal(ws.deleteFolder(f.id), true);
  assert.equal(ws.getFolders().length, 0);
  assert.equal(ws.getById(a.id).folderId, '');
  assert.equal(ws.getById(b.id).folderId, '');
  assert.ok(ws.getById(a.id) && ws.getById(b.id), 'the auras themselves are untouched');
});

test('wired renderer -> preload -> main, and folders are organise-only', () => {
  const main = read('src', 'main', 'main.js');
  const preload = read('src', 'preload', 'preload-main.js');
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  for (const ch of ['auraFolders:list', 'auraFolders:create', 'auraFolders:rename', 'auraFolders:delete', 'auraFolders:setCollapsed', 'auraFolders:reorder', 'widget:setFolder']) {
    assert.match(main, new RegExp(`ipcMain\\.handle\\('${ch.replace(/[:]/g, '\\$&')}'`), `${ch} IPC missing`);
  }
  assert.match(preload, /listAuraFolders:|createAuraFolder:|setWidgetFolder:/);
  assert.match(renderer, /function buildFolderHeader\(folder\)/);
  assert.match(renderer, /window\.eqTracker\.setAuraFolderCollapsed/);
  assert.match(renderer, /window\.eqTracker\.setWidgetFolder/);
  // folder headers are draggable to reorder folders
  assert.match(renderer, /header\.draggable = true/);
  assert.match(renderer, /window\.eqTracker\.reorderAuraFolders\(orderedIds\)/);
  assert.match(preload, /reorderAuraFolders:/);
  // none of the folder handlers touch an overlay window
  assert.doesNotMatch(main, /auraFolders:[a-zA-Z]+', \(_event[^)]*\) => \{[\s\S]{0,120}(applyVisibility|pushConfigChanged|overlay)/);
});

module.exports = () => report('aura-folders');
if (require.main === module) report('aura-folders').then((n) => process.exit(n ? 1 : 0));
