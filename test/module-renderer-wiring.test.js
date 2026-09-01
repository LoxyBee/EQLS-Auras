'use strict';
/**
 * feat/module-system - the renderer side. initModules() builds a sidebar nav button + a
 * spec-rendered settings page for each custom module that declares a `page`. Structural checks
 * (source + markup + preload) - the live rendering is exercised by tools/smoke-render.js and,
 * ultimately, a real module dropped into userData/modules/.
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

test('the sidebar and page-container have injection slots, no "Modules" heading', () => {
  assert.match(html, /id="module-nav-slot"/);
  assert.match(html, /id="module-page-slot"/);
  assert.ok(!/>\s*Modules\s*</.test(html), 'there must be no "Modules" heading in the nav');
});

test('initModules is called from init and renders only modules that declare a page', () => {
  assert.match(rendererSrc, /\binitModules\(\);/);
  assert.match(rendererSrc, /function initModules\(\)/);
  assert.match(rendererSrc, /only modules with settings get a page/);
  assert.match(rendererSrc, /window\.eqTracker\.onModulesChanged\(render\)/);
});

test('every page control type is handled', () => {
  const fn = rendererSrc.match(/function controlRow\(moduleId, field, value\) \{[\s\S]*?\n  \}/);
  assert.ok(fn, 'controlRow not found');
  for (const t of ['checkbox', 'select', 'slider']) assert.ok(fn[0].includes(`field.type === '${t}'`), t);
  assert.match(fn[0], /setModuleSetting\(moduleId, field\.key/);
});

test('the module IPC is bridged in both preloads', () => {
  for (const m of ['listModules', 'getModuleSettings', 'setModuleSetting', 'onModulesChanged']) {
    assert.ok(preloadMain.includes(m), `preload-main missing ${m}`);
  }
  assert.match(preloadOverlay, /getModuleEntries/);
  assert.match(preloadOverlay, /onModuleEntries/);
});

test('a module page id is namespaced so it cannot collide with a built-in page', () => {
  assert.match(rendererSrc, /page-module-\$\{mod\.id\}/);
});

module.exports = () => report('module-renderer-wiring');
if (require.main === module) report('module-renderer-wiring').then((n) => process.exit(n ? 1 : 0));
