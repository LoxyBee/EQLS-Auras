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
  assert.match(html, /id="combat-visit-list"/);
  assert.match(html, /id="combat-detail-bars"/);
  assert.match(html, /id="combat-detail-fightlist"/);
  assert.match(html, /id="combat-detail-back"/);
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
  assert.match(section, /title="[^"]*Newest first/, 'the explanation moved somewhere, but not into a title=');
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
  assert.match(renderer, /window\.eqTracker\.getDamageHistoryFight\(f\.id\)/);
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
  assert.match(fn[1], /\.textContent = row\.name|span\(row\.name/, 'row.name should be set as text, not markup');
});

test('fights are grouped into visits, sorted EARLIEST first per the owner\'s own correction', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function buildVisits\(history\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'buildVisits has been restructured or removed');
  assert.match(fn[1], /fight\.visitId/, 'fights are not being grouped into visits at all');
  assert.match(fn[1], /fights\.reverse\(\)/, 'a visit\'s own fights must be earliest-first too, not just the outer list');
  assert.match(fn[1], /order\.sort\(\(a, b\) => a\.startedAt - b\.startedAt\)/, 'the list must sort earliest first, not newest first');
  const renderFn = renderer.match(/function renderList\(visits\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(renderFn, 'renderList has been restructured or removed');
});

test('clicking a visit\'s zone opens the shared detail screen with that visit\'s combined totals', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/async function openVisit\(visit\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'openVisit has been restructured or removed');
  assert.match(fn[1], /getDamageHistoryFight\(f\.id\)/, 'a visit\'s totals must come from its real fights, not a guess');
  assert.match(fn[1], /renderBars\(detailBars, rows, totalDuration\)/);
  assert.match(fn[1], /detailFightList\.appendChild\(fightAccordionRow/, 'the individual fights must still be reachable from here');
});

test('a fight expands its own chart in place instead of navigating to a new screen', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function fightAccordionRow\(fight, detail\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'fightAccordionRow has been restructured or removed');
  assert.match(fn[1], /createElement\('details'\)/, 'a fight row must be an accordion, not a link to another screen');
  assert.match(fn[1], /renderBars\(nested, detail\.rows, detail\.durationSec\)/, 'expanding it must draw its OWN chart, not reuse the visit\'s combined one');
  assert.doesNotMatch(fn[1], /showDetail\(\)|display = ''/, 'expanding a fight must not switch screens');
});

test('Back always returns to the list - there is only ever one screen of depth now', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.doesNotMatch(renderer, /function openFight\(/, 'a per-fight navigation screen would reintroduce the "Back skips a screen" bug');
  const fn = renderer.match(/function initCombatPage\(\) \{([\s\S]*?)\n}\n/);
  assert.ok(fn);
  assert.match(fn[1], /backBtn\.addEventListener\('click', showList\)/, 'Back must go straight to showList, not through an intermediate screen');
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

// Confirmed live, 13 Sep: a nested .combat-bar-row (a fight's own per-player bars, expanded inside
// a .combat-fight-list-row) came out with no colour, no bar, no damage amount - the DOM and the
// inline fill colour were both correct (checked directly), only the applied `display` was wrong.
// Cause: `.combat-fight-list-row summary { display: flex; ... }` is a DESCENDANT selector, so it
// also matched the nested bar-row's own <summary> two levels down; same specificity as
// `.combat-bar-row summary { display: grid; ... }`, and later in the file, so it won. Pinning the
// `>` (direct-child) fix so this can't silently regress the next time either block is touched.
test('the fight-row accordion styles its OWN summary only - a direct-child combinator, not a descendant one', () => {
  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  const start = css.indexOf('.combat-fight-list-row {');
  assert.ok(start !== -1, 'the fight-list-row CSS block has moved or been removed');
  const block = css.slice(start, start + 700);
  assert.doesNotMatch(
    block, /\.combat-fight-list-row summary\b/,
    'a bare descendant selector here leaks into the nested .combat-bar-row summary two levels down and silently overrides its grid layout with flex'
  );
  assert.match(block, /\.combat-fight-list-row > summary \{/, 'the direct-child fix is missing');
});

// Owner, 13 Sep: crit % and each skill's share of a player's OWN total, added to the skill
// breakdown. Confirmed live (via a real render against mock data) that a single fight's own chart
// showed real crit rates while a VISIT's combined chart showed 0% crit on every skill, every time
// - openVisit's cross-fight aggregation built a fresh { skill, damage } object per skill with no
// hits/crits fields at all, so summing several fights' worth of the same skill silently discarded
// both. This pins that the merge actually carries them, not just damage.
test('a visit\'s combined skill totals carry hits and crits through the merge, not just damage', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/async function openVisit\(visit\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'openVisit has been restructured or removed');
  assert.match(
    fn[1], /\{ skill: s\.skill, damage: 0, hits: 0, crits: 0 \}/,
    'the per-skill accumulator must seed hits/crits, not just damage - the exact bug: crit % showed 0% for every skill on a multi-fight visit'
  );
  assert.match(fn[1], /srow\.hits \+= s\.hits \|\| 0/);
  assert.match(fn[1], /srow\.crits \+= s\.crits \|\| 0/);
});

test('the skill breakdown shows each skill\'s share of the player\'s OWN total, and its crit rate', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function renderBars\(container, rows, durationSec\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderBars has been restructured or removed');
  assert.match(
    fn[1], /row\.damage > 0 \? Math\.round\(\(s\.damage \/ row\.damage\) \* 100\)/,
    'share must be against the PLAYER\'s own total, not the fight\'s (that\'s already the point of the bar above it)'
  );
  assert.match(fn[1], /s\.hits > 0 \? Math\.round\(\(s\.crits \/ s\.hits\) \* 100\)/);
});

module.exports = () => report('combat-tab');
if (require.main === module) report('combat-tab').then((n) => process.exit(n ? 1 : 0));
