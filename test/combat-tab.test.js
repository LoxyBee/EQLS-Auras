'use strict';
/**
 * The Combat tab (owner's weekly notes, 13 Sep) - fight history + a per-player, per-skill
 * breakdown viewer, backed by damageEngine's history (damage-history.test.js covers that data
 * model directly). This file is the wiring: the page/nav exist, IPC -> preload -> renderer is
 * connected, and the renderer never uses innerHTML with log-derived text (a player/mob/spell name
 * is not this app's own text - same rule the ambiguous-cast popup already follows).
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

test('the Combat nav button and page section exist', () => {
  const html = read('src', 'renderer', 'main-window', 'index.html');
  assert.match(html, /<button class="nav-btn" data-page="page-combat" id="combat-nav-btn">Combat<\/button>/);
  assert.match(html, /<section id="page-combat" class="page">/);
  assert.match(html, /id="combat-history-groups"/);
  assert.match(html, /id="combat-detail-rows"/);
  assert.match(html, /id="combat-zone-filter"/);
  assert.match(html, /id="combat-scan-current"/);
  assert.match(html, /id="combat-scan-file"/);
});

test('the page uses a title= tooltip for its explanation, not a <p class="hint"> block (owner\'s standing rule)', () => {
  const html = read('src', 'renderer', 'main-window', 'index.html');
  const start = html.indexOf('id="page-combat"');
  const end = html.indexOf('</section>', start);
  const section = html.slice(start, end);
  assert.doesNotMatch(section, /class="hint"/, 'explanatory subtext belongs in a title= hover, not a hint paragraph');
  assert.match(section, /title="[^"]*grouped by zone/, 'the explanation moved somewhere, but not into a title=');
});

test('it is wired IPC -> preload -> renderer', () => {
  const main = read('src', 'main', 'main.js');
  assert.match(main, /ipcMain\.handle\('damage:getHistory', \(\) => mergedDamageHistory\(\)\)/);
  assert.match(main, /ipcMain\.handle\('damage:getHistoryFight', \(_event, id\) => findHistoryFight\(id\)\)/);
  const preload = read('src', 'preload', 'preload-main.js');
  assert.match(preload, /getDamageHistory: \(\) => ipcRenderer\.invoke\('damage:getHistory'\)/);
  assert.match(preload, /getDamageHistoryFight: \(id\) => ipcRenderer\.invoke\('damage:getHistoryFight', id\)/);
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(renderer, /function initCombatPage\(\)/);
  assert.match(renderer, /initCombatPage\(\);/);
  assert.match(renderer, /window\.eqTracker\.getDamageHistory\(\)/);
  assert.match(renderer, /window\.eqTracker\.getDamageHistoryFight\(id\)/);
});

test('scanning a log is wired IPC -> preload, and a scan gets its own kept-alive engine', () => {
  const main = read('src', 'main', 'main.js');
  assert.match(main, /ipcMain\.handle\('damage:getCurrentLogPath', \(\) => logService\.watcher\.getStatus\(\)\.currentFilePath \|\| null\)/);
  assert.match(main, /ipcMain\.handle\('damage:scanLogFile', async \(_event, filePath\) => \{/);
  assert.match(main, /const engine = await scanLogForFights\(filePath\)/);
  assert.match(main, /importedScans\.push\(\{ label, scannedAt: Date\.now\(\), engine \}\)/, 'a scan must keep its engine alive so getHistoryFight still works on it later');
  const preload = read('src', 'preload', 'preload-main.js');
  assert.match(preload, /getDamageCurrentLogPath: \(\) => ipcRenderer\.invoke\('damage:getCurrentLogPath'\)/);
  assert.match(preload, /scanDamageLogFile: \(filePath\) => ipcRenderer\.invoke\('damage:scanLogFile', filePath\)/);
});

test('merged history ids are namespaced by source, so a scan can never collide with the live session', () => {
  const main = read('src', 'main', 'main.js');
  const fn = main.match(/function mergedDamageHistory\(\) \{([\s\S]*?)\n}\n/);
  assert.ok(fn, 'mergedDamageHistory has been restructured');
  assert.match(fn[1], /id: `\$\{tag\}:\$\{entry\.id\}`/);
  const lookup = main.match(/function findHistoryFight\(compositeId\) \{([\s\S]*?)\n}\n/);
  assert.ok(lookup, 'findHistoryFight has been restructured');
  assert.match(lookup[1], /lastIndexOf\(':'\)/, 'a scan tag ("scan:0") itself contains a colon - splitting on the first one would break it');
});

test('history is re-fetched on every visit to the tab, not loaded once', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function initCombatPage\(\) \{([\s\S]*?)\n}\n/);
  assert.ok(fn, 'initCombatPage has been restructured');
  assert.match(fn[1], /navBtnCombat\.addEventListener\('click', loadHistory\)/);
  assert.ok(fn[1].trim().endsWith('loadHistory();'), 'no initial load - the tab would open blank the first time');
});

test('player/skill names are built as DOM text nodes, never interpolated into innerHTML', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function initCombatPage\(\) \{([\s\S]*?)\n}\n/);
  assert.ok(fn);
  // The only innerHTML assignments in this function must be clears (= ''), never a template
  // literal splicing in row.name / s.skill / fight.topAttacker.
  const assignments = fn[1].match(/\.innerHTML = [^;]+;/g) || [];
  for (const a of assignments) {
    assert.match(a, /innerHTML = '';/, `found a non-empty innerHTML assignment: ${a}`);
  }
  assert.match(fn[1], /\.textContent = row\.name|span\(row\.name\)/, 'row.name should be set as text, not markup');
});

test('fights are grouped zone -> visit before rendering, not shown as one flat list', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function groupByZoneAndVisit\(history\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'groupByZoneAndVisit has been restructured or removed');
  assert.match(fn[1], /fight\.zone \|\| UNKNOWN_ZONE/, 'a fight with no zone must still land in a group, not vanish');
  assert.match(fn[1], /fight\.visitId/, 'fights are not being split by visit within a zone');
  const renderFn = renderer.match(/function renderGroups\(history\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(renderFn, 'renderGroups has been restructured or removed');
});

test('the zone filter is populated from the actual history and narrows what renders', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const page = renderer.match(/function initCombatPage\(\) \{([\s\S]*?)\n}\n/);
  assert.ok(page, 'initCombatPage has been restructured');
  const fn = page[1].match(/function render\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'render has been restructured or removed');
  assert.match(fn[1], /populateZoneFilter\(lastHistory\)/);
  assert.match(fn[1], /filter \? lastHistory\.filter/, 'an empty filter value must mean "all zones", not "no zones"');
});

module.exports = () => report('combat-tab');
if (require.main === module) report('combat-tab').then((n) => process.exit(n ? 1 : 0));
