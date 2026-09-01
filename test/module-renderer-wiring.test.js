'use strict';
/**
 * feat/module-system - the renderer side.
 *
 * A module's `page` controls render in ONE of two places, chosen by its `settingsUI`:
 *   'aura'    (default, recommended) - on the module aura's own settings panel, no sidebar entry
 *   'sidebar' - a dedicated nav button + page, for a module with a lot of GLOBAL options
 *
 * Structural checks (source + markup + preload). Live rendering is exercised by
 * tools/smoke-render.js and, ultimately, a real module dropped into the modules folder.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const html = read('renderer', 'main-window', 'index.html');
const rendererSrc = read('renderer', 'main-window', 'main-window.js');
const preloadMain = read('preload', 'preload-main.js');
const preloadOverlay = read('preload', 'preload-overlay.js');
const mainSrc = read('main', 'main.js');
const moduleHostSrc = read('main', 'moduleHost.js');

test('the sidebar and page-container keep injection slots for sidebar-mode modules, no "Modules" heading', () => {
  assert.match(html, /id="module-nav-slot"/);
  assert.match(html, /id="module-page-slot"/);
  assert.ok(!/>\s*Modules\s*</.test(html), 'there must be no "Modules" heading in the nav');
});

test('the per-aura settings panel has a module-settings card', () => {
  assert.match(html, /id="widget-module-settings"/);
  assert.match(html, /id="widget-module-settings-controls"/);
});

test('one shared, hot-reloaded module registry feeds both the sidebar and the aura panel', () => {
  assert.match(rendererSrc, /function refreshModuleRegistry\(\)/);
  assert.match(rendererSrc, /function onModuleRegistryChange\(fn\)/);
  assert.match(rendererSrc, /window\.eqTracker\.onModulesChanged\(refreshModuleRegistry\)/);
  assert.match(rendererSrc, /\binitModules\(\);/);
});

test('initModules builds a sidebar page ONLY for settingsUI === "sidebar" modules', () => {
  assert.match(rendererSrc, /function initModules\(\)/);
  assert.match(rendererSrc, /if \(!mod\.enabled \|\| mod\.settingsUI !== 'sidebar'\) continue;/, 'a sidebar page should only build for an ENABLED sidebar-mode module');
  assert.match(rendererSrc, /page-module-\$\{mod\.id\}/, 'module page id still namespaced');
  assert.match(rendererSrc, /onModuleRegistryChange\(render\);/);
});

test('every page control type is handled by the shared control builder', () => {
  const fn = rendererSrc.match(/function moduleControlRow\(moduleId, field, value\) \{[\s\S]*?\n\}/);
  assert.ok(fn, 'moduleControlRow not found');
  for (const t of ['checkbox', 'select', 'slider']) assert.ok(fn[0].includes(`field.type === '${t}'`), t);
  assert.match(fn[0], /setModuleSetting\(moduleId, field\.key/);
});

test('a module aura panel renders that module\'s controls, gated on it being aura-mode', () => {
  assert.match(rendererSrc, /function moduleAuraHasPanelSettings\(widget\)/);
  assert.match(rendererSrc, /m\.settingsUI !== 'sidebar'/);
  assert.match(rendererSrc, /renderModulePageControls\(moduleSettingsControlsEl, moduleById\(widget\.moduleId\)\)/);
  // the shape carries the slot
  assert.match(rendererSrc, /'module': \[[^\]]*'module-settings'[^\]]*\]/);
});

test('the module IPC is bridged in both preloads', () => {
  for (const m of ['listModules', 'getModuleSettings', 'setModuleSetting', 'onModulesChanged', 'onModuleSettingsChanged', 'setModuleEnabled', 'onModuleError']) {
    assert.ok(preloadMain.includes(m), `preload-main missing ${m}`);
  }
  assert.match(preloadOverlay, /getModuleEntries/);
  assert.match(preloadOverlay, /onModuleEntries/);
});

test('the Setup-page Custom-modules list + consent gate are wired', () => {
  assert.match(html, /id="modules-panel-card"/, 'no Custom-modules card on the Setup page');
  assert.match(html, /id="modules-panel-list"/);
  assert.match(rendererSrc, /function initModulesPanel\(\)/);
  assert.match(rendererSrc, /initModulesPanel\(\);/);
  // enabling a module goes through appConfirm before setModuleEnabled(id, true)
  const fn = rendererSrc.slice(rendererSrc.indexOf('function initModulesPanel()'), rendererSrc.indexOf('function initModulesPanel()') + 3500);
  assert.match(fn, /await appConfirm\(\{[\s\S]*?full access to your PC/, 'the consent dialog does not spell out the risk');
  assert.match(fn, /window\.eqTracker\.setModuleEnabled\(m\.id, cb\.checked\)/);
  assert.match(fn, /if \(!ok\) \{ cb\.checked = false; return; \}/, 'a cancelled consent should revert the checkbox');
  assert.match(mainSrc, /ipcMain\.handle\('modules:setEnabled'/);
});

test('moduleHost: a discovered module is off until enabled, bundled ones default on', () => {
  assert.match(moduleHostSrc, /const BUNDLED_MODULE_IDS = \['aggro-board'\]/);
  assert.match(moduleHostSrc, /this\._isEnabled\(rec\.module\.id\)/, 'handleLine does not gate on the enable state');
  assert.match(moduleHostSrc, /setModuleEnabled\(id, enabled\)/);
  assert.match(moduleHostSrc, /saveJson\('enabledModuleIds'/);
});

module.exports = () => report('module-renderer-wiring');
if (require.main === module) report('module-renderer-wiring').then((n) => process.exit(n ? 1 : 0));
