'use strict';
/**
 * feat/module-system - the overlay-aura half. A `hasAura` module can be created as an aura
 * (`kind: 'module-aura'`, `buffSource: 'module'`, bound by `moduleId`); the overlay reads that
 * aura's tiles from one shared per-module-id channel; the Add-Aura list and the settings-panel
 * shape need no per-module code.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, MODULE_KIND } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const managerSrc = read('src', 'main', 'widgetManager.js');
const mainSrc = read('src', 'main', 'main.js');
const preloadMain = read('src', 'preload', 'preload-main.js');
const preloadOverlay = read('src', 'preload', 'preload-overlay.js');

function store() {
  let saved;
  return {
    loadJson: (k, f) => (k === 'widgets' ? saved || f : f),
    saveJson: (k, v) => { if (k === 'widgets') saved = JSON.parse(JSON.stringify(v)); },
  };
}

test('createModuleAura makes a module-kind aura bound to the module id, and it survives a reload', () => {
  const s = store();
  const w = new WidgetStore(s).createModuleAura('Pull Timer', { moduleId: 'pull-timer' });
  assert.equal(w.kind, MODULE_KIND);
  assert.equal(w.buffSource, 'module');
  assert.equal(w.moduleId, 'pull-timer');
  assert.deepEqual(w.premadeOrigin, { kind: 'module', moduleId: 'pull-timer' });

  const reloaded = new WidgetStore(s).getById(w.id);
  assert.equal(reloaded.buffSource, 'module', 'normalize keeps buffSource:module for a module-aura kind');
  assert.equal(reloaded.moduleId, 'pull-timer', 'moduleId is carried through normalize');
});

test('a module aura with no stored moduleId normalises to null, not undefined', () => {
  const s = store();
  const ws = new WidgetStore(s);
  const w = ws.createModuleAura('X', {});
  assert.equal(new WidgetStore(s).getById(w.id).moduleId, null);
});

test('the overlay routes a module aura to its own slice of the shared channel', () => {
  assert.match(overlaySrc, /let lastModuleEntries = \{\}/);
  assert.match(overlaySrc, /currentConfig\.buffSource === 'module'\) return lastModuleEntries\[currentConfig\.moduleId\] \|\| \[\]/);
  // and it bypasses the spell-based filters, like travel/raidNamed
  assert.match(overlaySrc, /currentConfig\.buffSource === 'module'\) return buffs;/);
  assert.match(overlaySrc, /onModuleEntries\(\(all\) => \{/);
});

test('the create path is bridged end to end', () => {
  assert.match(managerSrc, /function createModuleAuraWidget\(name, moduleId\)/);
  assert.match(mainSrc, /widget:createModuleAura/);
  assert.match(preloadMain, /createModuleAuraWidget: \(name, moduleId\) =>/);
  assert.match(preloadOverlay, /getModuleEntries/);
});

test('hasAura modules are folded into the Add-Aura Standalone group with no per-module code', () => {
  assert.match(rendererSrc, /onModuleRegistryChange\(\(modules\) =>/);
  assert.match(rendererSrc, /\.filter\(\(m\) => m\.hasAura && m\.enabled\)/, 'Add-Aura should only offer ENABLED hasAura modules');
  assert.match(rendererSrc, /createModuleAuraWidget\(n, m\.id\)/);
  assert.match(rendererSrc, /group\.id === 'standalone' \? moduleAuraChoices : \[\]/);
});

test('the module settings-panel shape has no picker or source, just look + place + alerts', () => {
  const m = rendererSrc.match(/'module':\s*\[([^\]]*)\]/);
  assert.ok(m, 'SHAPE_FIELDS.module not found');
  const fields = m[1];
  for (const f of ['buff-picker', 'buff-source', 'self-buffs-filter', 'debuff-cast-by']) {
    assert.ok(!fields.includes(f), `module shape must not have "${f}"`);
  }
  for (const f of ['display-choice', 'timer-text', 'opacity', 'position', 'alerts']) {
    assert.ok(fields.includes(f), `module shape should have "${f}"`);
  }
});

module.exports = () => report('module-aura');
if (require.main === module) report('module-aura').then((n) => process.exit(n ? 1 : 0));
