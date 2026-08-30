'use strict';
/**
 * Backlog #33 "Raid named" board - the wiring around RaidNamedTracker (the engine itself is
 * covered in raid-named-tracker.test.js). Structural: the store builds the right kind, the IPC /
 * preload / manager path exists, the premade entry is there, and overlay.js routes the
 * 'raidNamed' source.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

test('createRaidNamed builds a raid-named-builtin / raidNamed-source list aura', () => {
  const w = newStore().createRaidNamed('Raid named');
  assert.equal(w.kind, 'raid-named-builtin');
  assert.equal(w.buffSource, 'raidNamed');
  assert.equal(w.displayMode, 'list');
  assert.equal(w.premadeOrigin.kind, 'raidNamed');
});

test('normalizeWidget forces the source back to raidNamed even if the stored value drifted', () => {
  const data = { widgets: { version: 4, widgets: [
    { id: 'r', kind: 'raid-named-builtin', buffSource: 'self', displayMode: 'list' },
  ] } };
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: () => {},
  });
  assert.equal(store.getById('r').buffSource, 'raidNamed');
});

test('it is wired IPC -> preload -> manager', () => {
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('widget:createRaidNamed'/);
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('raidNamed:getActive'/);
  assert.match(read('src', 'main', 'main.js'), /raidNamedTracker\.handleLine\(line\)/);
  assert.match(read('src', 'main', 'main.js'), /raidNamedTracker\.stop\(\)/);
  assert.match(read('src', 'main', 'widgetManager.js'), /function createRaidNamedWidget/);
  assert.match(read('src', 'preload', 'preload-main.js'), /createRaidNamedWidget:/);
  assert.match(read('src', 'preload', 'preload-overlay.js'), /getActiveRaidNamed:/);
  assert.match(read('src', 'preload', 'preload-overlay.js'), /onRaidNamedChanged:/);
});

test('overlay.js routes the raidNamed source and shows every row (no picker filter)', () => {
  const overlay = read('src', 'renderer', 'overlay', 'overlay.js');
  assert.match(overlay, /buffSource === 'raidNamed'\) return lastRaidNamed/);
  assert.match(overlay, /buffSource === 'raidNamed'\) return buffs/); // visibleBuffs bypass
  assert.match(overlay, /classList\.toggle\('raid-killed'/);
});

test('the premade list has a Raid named entry under standalone', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(renderer, /id: 'raid-named'/);
  assert.match(renderer, /createRaidNamedWidget\(name\)/);
  const block = renderer.slice(renderer.indexOf("id: 'raid-named'"), renderer.indexOf("id: 'raid-named'") + 500);
  assert.match(block, /group: 'standalone'/);
});

test('widgetShape resolves raid-named-builtin to the raid-named shape', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(renderer, /kind === 'raid-named-builtin'\) return 'raid-named'/);
  assert.match(renderer, /'raid-named': \[/);
});

module.exports = () => report('raid-named-wiring');
if (require.main === module) report('raid-named-wiring').then((n) => process.exit(n ? 1 : 0));
