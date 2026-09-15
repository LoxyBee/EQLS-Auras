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

// Owner, 14 Sep: "it needs to be obvious that there is a live tracking option, since currently
// there is not placeholder ui showing that it will go there" - a fresh session's empty Past
// Fights list gave no hint that it was actually watching, live, for the next fight to land in it.
test('a "Live" badge next to Past Fights, and the empty state, both say tracking is actually on', () => {
  const html = read('src', 'renderer', 'main-window', 'index.html');
  assert.match(html, /class="live-indicator"[^>]*>● Live</, 'the badge must be visible year-round, not conditional on having any history yet');
  assert.match(html, /id="combat-history-empty">No fights yet this session - still watching your log\.</);

  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  assert.match(css, /\.live-indicator\s*\{/, 'missing styling for the badge');
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
  // The id-splitting logic moved into a shared sourceForCompositeId() (also used by the class
  // estimate handler, which needs the SAME tag resolution) - check that one now.
  const lookup = main.match(/function sourceForCompositeId\(compositeId\) \{([\s\S]*?)\n}\n/);
  assert.ok(lookup, 'sourceForCompositeId has been restructured or removed');
  assert.match(lookup[1], /lastIndexOf\(':'\)/, 'a scan tag ("scan:0") itself contains a colon - splitting on the first one would break it');
  const fightFn = main.match(/function findHistoryFight\(compositeId\) \{([\s\S]*?)\n}\n/);
  assert.ok(fightFn, 'findHistoryFight has been restructured');
  assert.match(fightFn[1], /sourceForCompositeId\(compositeId\)/, 'findHistoryFight must reuse the shared resolver, not its own copy');
});

// Owner, 14 Sep: clicking into the Combat tab now jumps to the current zone's latest visit
// (jumpToCurrentZone), which itself re-fetches history first for freshness - so the original
// "re-fetched on every visit" guarantee still holds, just through a different function.
test('history is re-fetched on every visit to the tab, not loaded once', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function initCombatPage\(\) \{([\s\S]*?)\n}\n/);
  assert.ok(fn, 'initCombatPage has been restructured');
  assert.match(fn[1], /navBtnCombat\.addEventListener\('click', jumpToCurrentZone\)/);
  const jumpFn = renderer.match(/async function jumpToCurrentZone\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(jumpFn, 'jumpToCurrentZone has been restructured or removed');
  assert.match(jumpFn[1], /await loadHistory\(\)/, 'the nav-button jump must re-fetch, not reuse stale history');
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
  assert.match(fn[1], /renderMetricBars\(detailBars, details\)/);
  assert.match(fn[1], /detailFightList\.appendChild\(fightAccordionRow/, 'the individual fights must still be reachable from here');
});

test('a fight expands its own chart in place instead of navigating to a new screen', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function fightAccordionRow\(fight, detail\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'fightAccordionRow has been restructured or removed');
  assert.match(fn[1], /createElement\('details'\)/, 'a fight row must be an accordion, not a link to another screen');
  assert.match(fn[1], /renderMetricBars\(nested, \[detail\]\)/, 'expanding it must draw its OWN chart, not reuse the visit\'s combined one');
  assert.doesNotMatch(fn[1], /showDetail\(\)|display = ''/, 'expanding a fight must not switch screens');
});

// Owner, 14 Sep: "the fight breakdown for each zone should say what fight it is... if a named was
// fought it should list the named, if no named was found it should just say Trash".
test('each fight row shows what it was - a named mob\'s name, or Trash when none was found', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function fightAccordionRow\(fight, detail\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'fightAccordionRow has been restructured or removed');
  assert.match(fn[1], /fight\.label \|\| 'Trash'/, 'a fight record with no label at all must fall back to Trash, not blank');
  assert.match(fn[1], /combat-fight-label-trash/, 'Trash needs its own dimmer style so it does not read as a real named kill');
});

test('Back always returns to the list - there is only ever one screen of depth now', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.doesNotMatch(renderer, /function openFight\(/, 'a per-fight navigation screen would reintroduce the "Back skips a screen" bug');
  const fn = renderer.match(/function initCombatPage\(\) \{([\s\S]*?)\n}\n/);
  assert.ok(fn);
  assert.match(
    fn[1], /backBtn\.addEventListener\('click', \(\) => \{ liveFightOpen = false; showList\(\); \}\)/,
    'Back must go straight to showList (also clearing liveFightOpen, so a stray tick after leaving the live view can\'t redraw over the list), not through an intermediate screen'
  );
});

test('the zone filter is populated from the actual history and narrows what renders', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const page = renderer.match(/function initCombatPage\(\) \{([\s\S]*?)\n}\n/);
  assert.ok(page, 'initCombatPage has been restructured');
  const fn = page[1].match(/function render\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'render has been restructured or removed');
  assert.match(fn[1], /populateZoneFilter\(lastHistory\)/);
  assert.match(fn[1], /!filter \|\|/, 'an empty filter value must mean "all zones", not "no zones"');
});

// Owner, 14 Sep: "a filter... to exclude logs of fights under a certain total damage value...
// defaulted to anything less than 50k" - a stray one-hit trash fight was showing up as its own
// noise entry in the list. Filters individual FIGHTS (not whole visits) before grouping.
test('a minimum-damage filter hides small fights, defaulted to 50k', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const page = renderer.match(/function initCombatPage\(\) \{([\s\S]*?)\n}\n/);
  assert.ok(page, 'initCombatPage has been restructured');
  assert.match(page[1], /DEFAULT_MIN_DAMAGE = 50000/);
  const fn = page[1].match(/function render\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'render has been restructured or removed');
  assert.match(fn[1], /f\.totalDamage >= floor/, 'the filter must compare each FIGHT\'s own total, not a visit total');
  const html = read('src', 'renderer', 'main-window', 'index.html');
  assert.match(html, /id="combat-min-damage"/, 'the min-damage input must exist on the page');
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
// Owner, 14 Sep: "let's also make this have distinct columns. date, boss/trash name, time, total
// damage, top dps. top dps should be right most, the name field should be the longest one that
// fills the section." - was one combined "36s, 77.4k, top: You" string tacked onto a flex row.
test('each fight row has 5 distinct columns - date, name, time, damage, top dps - name is the flexible one, top dps is rightmost', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function fightAccordionRow\(fight, detail\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'fightAccordionRow has been restructured or removed');
  assert.match(fn[1], /span\(formatWhen\(fight\.endedAt\), 'combat-fight-date'\)/);
  assert.match(fn[1], /span\(formatDuration\(fight\.durationSec\), 'combat-fight-duration'\)/);
  assert.match(fn[1], /span\(formatDamage\(fight\.totalDamage\), 'combat-fight-damage'\)/);
  assert.match(fn[1], /span\(fight\.topAttacker \|\| '—', 'combat-fight-top'\)/);
  // top dps must be the LAST column appended, since a grid lays out children in DOM order
  const order = ['combat-fight-date', 'combat-fight-label', 'combat-fight-duration', 'combat-fight-damage', 'combat-fight-top']
    .map((cls) => fn[1].indexOf(cls));
  assert.ok(order.every((i) => i !== -1), 'one of the 5 column classes is missing');
  for (let i = 1; i < order.length; i++) {
    assert.ok(order[i] > order[i - 1], 'the 5 columns must be appended in date/name/time/damage/top-dps order, top dps last (rightmost)');
  }

  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  assert.match(
    css, /\.combat-fight-list-row > summary \{[^}]*grid-template-columns: [^;]*1fr/s,
    'the name column must be the flexible (1fr) one that fills the row, not a fixed width like every other column'
  );
  // A bare `1fr` column that also has `overflow: hidden` (needed for the ellipsis) collapses to
  // ZERO width under a tight window, because overflow:hidden makes its automatic minimum size 0 -
  // confirmed via a real browser render at a narrow width, where the name text vanished entirely
  // rather than truncating. `minmax(<floor>, 1fr)` gives it an explicit floor instead.
  assert.match(
    css, /\.combat-fight-list-row > summary \{[^}]*grid-template-columns: 150px minmax\(\d+px, 1fr\)/s,
    'the name column needs an explicit minmax() floor, or it can collapse to 0 width under overflow:hidden + a tight window'
  );
});

test('the Back/Damage/Healing/Both buttons are all on one row', () => {
  const html = read('src', 'renderer', 'main-window', 'index.html');
  const start = html.indexOf('id="combat-detail-toolbar"');
  assert.ok(start !== -1, 'the combat-detail-toolbar row is missing - the toggle got split back onto its own row');
  const end = html.indexOf('</div>', html.indexOf('combat-detail-title'));
  const section = html.slice(start, end);
  assert.match(section, /id="combat-detail-back"/);
  assert.match(section, /id="combat-view-toggle"/);
  assert.match(section, /data-view="damage"/);
  assert.match(section, /data-view="healing"/);
  assert.match(section, /data-view="both"/);
});

// Owner, 14 Sep: "there needs to be more separation between sum total graph and the sub fights" -
// the combined chart's own last row and the first individual-fight row sat right on top of each
// other with only the fight list's border to tell them apart.
test('there is a visible gap and a heavier rule between the combined chart and the individual fight list', () => {
  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  const rule = css.match(/#combat-detail-fightlist\s*\{([\s\S]*?)\}/);
  assert.ok(rule, 'missing a #combat-detail-fightlist rule');
  assert.match(rule[1], /margin-top:\s*\d/, 'needs real space above it, not just a border touching the chart');
  assert.match(rule[1], /border-top:\s*2px/, 'the separating rule should read heavier than the fight list\'s own 1px row borders, so it reads as a section break');
});

test('a visit\'s combined skill totals carry hits and crits through the merge, not just damage', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function aggregateFightRows\(details, rowsKey\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'aggregateFightRows has been restructured or removed');
  assert.match(
    fn[1], /\{ skill: s\.skill, damage: 0, hits: 0, crits: 0 \}/,
    'the per-skill accumulator must seed hits/crits, not just damage - the exact bug: crit % showed 0% for every skill on a multi-fight visit'
  );
  assert.match(fn[1], /srow\.hits \+= s\.hits \|\| 0/);
  assert.match(fn[1], /srow\.crits \+= s\.crits \|\| 0/);
});

test('the skill breakdown shows each skill\'s share of the player\'s OWN total, and its crit rate', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function renderBars\(container, rows, durationSec, metric = 'damage'\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderBars has been restructured or removed');
  assert.match(
    fn[1], /row\.damage > 0 \? Math\.round\(\(s\.damage \/ row\.damage\) \* 100\)/,
    'share must be against the PLAYER\'s own total, not the fight\'s (that\'s already the point of the bar above it)'
  );
  assert.match(fn[1], /s\.hits > 0 \? Math\.round\(\(s\.crits \/ s\.hits\) \* 100\)/);
});

// Owner, 13 Sep, second round: "needs dedicated columns... columns are unlabeled" and "still no
// colours for the dps breakdown... the rows need colours to display their %". The skill list is a
// real 4-column grid now (Skill / Damage / % of total / Crit %) with a header row using the SAME
// columns, and the Damage cell carries its own coloured bar - sized against this player's own
// biggest skill, same "biggest, not the total" reasoning the player bars already use.
test('the skill breakdown has a labelled header row and each skill row has its own coloured bar', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function renderBars\(container, rows, durationSec, metric = 'damage'\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderBars has been restructured or removed');
  assert.match(fn[1], /combat-skill-header/, 'no header row - the columns would be unlabeled again');
  for (const label of ['Skill', 'Damage', '% of total', 'Crit %']) {
    assert.ok(fn[1].includes(`'${label}'`), `header is missing the "${label}" column label`);
  }
  assert.match(fn[1], /combat-skill-track/, 'each skill needs its own bar track, not just a bare number');
  assert.match(fn[1], /combat-skill-fill/);
  assert.match(
    fn[1], /BAR_COLORS\[si % BAR_COLORS\.length\]/,
    'each skill bar must actually be coloured, not left the default track colour'
  );
  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  assert.match(
    css, /\.combat-skill-row \{[^}]*display: grid;[^}]*grid-template-columns: 1fr 2fr 64px 56px;/s,
    'the header and data rows must share one grid-template-columns or the labels will not line up with their values'
  );
});

// Owner, 13 Sep, third round: "the coloured bar should extend underneath the crit and damage %
// numbers" - the track/fill must span the whole Damage/%/Crit area (columns 2 to the end), not
// just the Damage column, with the three numbers laid on top of it rather than off to the side on
// bare background.
test('the skill bar spans the whole Damage/percent/crit area, not just the Damage column', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function renderBars\(container, rows, durationSec, metric = 'damage'\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderBars has been restructured or removed');
  assert.match(
    fn[1], /combat-skill-track-area/,
    'the track/fill must live in a wrapper spanning the whole numbers area, not just the Damage column'
  );
  assert.match(
    fn[1], /trackArea\.appendChild\(track\)[\s\S]*trackArea\.appendChild\(amount\)[\s\S]*trackArea\.appendChild\(span\(`\$\{share\}%`, 'combat-skill-share'\)\)[\s\S]*trackArea\.appendChild\(span\(critPct === null[\s\S]*?'combat-skill-crit'\)\)/,
    'the amount, share and crit numbers must all sit on top of the same wide track, not the bare row'
  );
  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  assert.match(
    css, /\.combat-skill-track-area \{[^}]*grid-column: 2 \/ -1;/s,
    'the track-area must span from the Damage column to the end of the row, covering %/Crit too'
  );
  assert.match(
    css, /\.combat-skill-track \{[^}]*position: absolute;[^}]*inset: 0;/s,
    'the track background must fill its whole wide area, not just the Damage-column slice'
  );
});

// Owner, 13 Sep, fourth round: "dps numbers should also go on top of the coloured bars... it
// should still be inset" - a short player bar (scaled against the fight's top attacker) used to
// leave the DPS figure stranded in blank space past the end of it, in its own 90px column. The
// DPS figure now lives INSIDE the track as a second overlay (right-aligned), same layering trick
// as the skill-row bars, with no separate stats column at all.
test('the DPS figure on a player bar is inset into the track, not stranded in a column past it', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function renderBars\(container, rows, durationSec, metric = 'damage'\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderBars has been restructured or removed');
  assert.match(fn[1], /combat-bar-dps/, 'the DPS element must exist');
  assert.match(
    fn[1], /track\.appendChild\(dpsEl\)/,
    'the DPS element must be appended INTO the track, not as a sibling column outside it'
  );
  assert.doesNotMatch(
    fn[1], /combat-bar-stats/,
    'the old separate stats column should be gone entirely, not left dangling alongside the inset DPS'
  );
  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  assert.match(
    css, /\.combat-bar-row summary \{[^}]*grid-template-columns: 130px 1fr;/s,
    'the summary grid must drop the old 90px stats column - the track now owns all remaining width'
  );
  assert.match(
    css, /\.combat-bar-dps \{[^}]*position: absolute;[^}]*inset: 0;[^}]*justify-content: flex-end;/s,
    'the DPS overlay must be absolutely positioned over the whole track and right-aligned within it'
  );
});

// Owner, 13 Sep, fifth round: "column text needs to be centered to line up correctly" - the
// previous round's restructure (moving share/crit off the bare row and into the track-area
// sub-grid) dropped the header's own right-alignment for those columns without replacing it, so
// "% OF TOTAL"/"CRIT %" (left-aligned by default) no longer lined up with their own right-aligned
// data values. Centre is the actual fix requested, applied to both header and data so they can
// never drift apart from each other again regardless of which side either one is anchored to.
test('the skill breakdown\'s Damage/percent/crit columns are centred, header and data alike', () => {
  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  assert.match(
    css, /\.combat-skill-header span:not\(:first-child\) \{ text-align: center; \}/,
    'every header label but Skill must be centred, or it drifts from its own centred data column'
  );
  assert.match(
    css, /\.combat-skill-share, \.combat-skill-crit \{[^}]*text-align: center;/s,
    'the % of total / crit % data values must be centred, matching their now-centred headers'
  );
  assert.match(
    css, /\.combat-skill-amount \{[^}]*justify-content: center;/s,
    'the damage amount must be centred too, matching the centred "Damage" header above it'
  );
});

// Owner, 13-14 Sep, several rounds: "add in the class estimation and put it as the first text in
// the damage coloured bar... make sure that it is it's own column" - then "buffs can be used to
// guess a class, but ONLY if they are seen being cast... damage from puma is not [an indicator]" -
// then "it is only supposed to take into account that fight" (not the whole session). The estimate
// is built from `row.castSkills` - captured per-fight (or unioned across a visit's fights) the
// same way `row.bySkill` already is, never from a damage-log skill list.
test('the class estimate is the first thing in the damage bar, in its own column ahead of the amount', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/async function renderBars\(container, rows, durationSec, metric = 'damage'\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderBars must exist and be async - it awaits a class estimate for every row');
  assert.match(
    fn[1], /window\.eqTracker\.estimateDamageClasses\(row\.castSkills \|\| \[\]\)/,
    'the estimate must come from THIS row\'s own captured cast-skill list, never a damage-log skill list'
  );
  assert.match(
    fn[1], /label\.appendChild\(classWrap\)[\s\S]*label\.appendChild\(span\(formatDamage\(row\.damage\), 'combat-bar-amount'\)\)/,
    'the class element must be appended BEFORE the amount element - it has to read first in the bar'
  );
  assert.match(
    fn[1], /classWrap\.appendChild\(span\(c\.name, `combat-bar-class-\$\{c\.confidence\}`\)\)/,
    'each class must be coloured by its OWN confidence tier, not one flat colour for the whole guess'
  );
  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  assert.match(
    css, /\.combat-bar-class \{[^}]*min-width:/s,
    'the class slot needs a fixed width so it reads as a real column, not text that shifts the amount around row to row'
  );
});

// Owner, 13 Sep: "colour the classes by green for 100% guaranteed, orange for maybe".
test('a confirmed class renders green, a maybe class renders orange - distinct colours, not the same one', () => {
  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  assert.match(css, /\.combat-bar-class-confirmed \{ color: #6fd67a; \}/);
  assert.match(css, /\.combat-bar-class-maybe \{ color: #e0a94e; \}/);
});

// A visit's combined chart must union its fights' cast evidence, not just their damage - the same
// data model precedent bySkill already established.
test('a visit\'s combined chart unions its fights\' cast-skill evidence, not just damage/bySkill', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function aggregateFightRows\(details, rowsKey\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'aggregateFightRows has been restructured or removed');
  assert.match(fn[1], /castSkills: new Set\(\)/, 'the per-attacker aggregate must have a castSkills accumulator');
  assert.match(
    fn[1], /for \(const skill of row\.castSkills \|\| \[\]\) agg\.castSkills\.add\(skill\)/,
    'every fight\'s cast skills must be folded into the visit\'s combined set'
  );
  assert.match(fn[1], /castSkills: \[\.\.\.r\.castSkills\]/, 'the final row shape must expose castSkills as a plain array for renderBars');
});

// The IPC round trip the class estimate above depends on - main.js hosts the actual lookup
// (gameSpellData needs the installed spells_us.txt, which only the main process can read).
test('the class estimate is wired IPC -> preload -> renderer', () => {
  const main = read('src', 'main', 'main.js');
  assert.match(
    main, /ipcMain\.handle\('damage:estimateClasses', \(_event, castSkills\) => \(\s*classEstimator\.estimateClasses\(castSkills, \(name\) => gameSpellData\.getClassesForSpell\(currentInstallRoot, name\)\)/,
    'the handler must exist and use the CURRENT install root, not a stale/hardcoded one'
  );
  const preload = read('src', 'preload', 'preload-main.js');
  assert.match(preload, /estimateDamageClasses: \(castSkillNames\) => ipcRenderer\.invoke\('damage:estimateClasses', castSkillNames\)/);
});

// Owner, 14 Sep: "date and location fields need their own columns to justify text correctly" -
// today's fights show a bare time while older ones show a full date too, and flex's natural
// sizing let that shorter width shift the zone name (and everything after it) row to row.
test('the visit list uses a real grid with fixed time/difficulty/raid-group columns, not flex natural-sizing', () => {
  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  assert.match(
    css, /\.combat-visit-row \{[^}]*display: grid;[^}]*grid-template-columns: 150px 36px minmax\(80px, 1fr\) 60px auto;/s,
    'the time, difficulty and raid/group columns must all be fixed widths so a short "today" time and a long dated one both start the zone name at the same x'
  );
});

// Owner, 14 Sep: "there is still no button to toggle between healing, damage, or both, i asked
// for this several turns ago" - top-level buttons, not attached to any one fight, that refresh
// every chart currently on screen when clicked.
test('the Damage/Healing/Both toggle exists as its own top-level control, not attached to a fight', () => {
  const html = read('src', 'renderer', 'main-window', 'index.html');
  const start = html.indexOf('id="combat-view-toggle"');
  assert.ok(start !== -1, 'the view-toggle control is missing from the page');
  const section = html.slice(start, start + 500);
  assert.match(section, /data-view="damage"/);
  assert.match(section, /data-view="healing"/);
  assert.match(section, /data-view="both"/);
});

test('toggling the view mode refreshes every chart currently open, not just the next one clicked', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function initCombatPage\(\) \{([\s\S]*?)\n}\n/);
  assert.ok(fn, 'initCombatPage has been restructured');
  assert.match(fn[1], /const openRenders = new Map\(\)/, 'there must be a registry of what is currently visible');
  assert.match(
    fn[1], /for \(const \[container, details\] of openRenders\)[\s\S]*?renderMetricBars\(container, details\)/,
    'clicking a view button must re-render every registered container, not just set a variable'
  );
});

test('a single fight\'s own chart is registered as open (and unregistered on collapse), so it refreshes too', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function fightAccordionRow\(fight, detail\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'fightAccordionRow has been restructured or removed');
  assert.match(fn[1], /openRenders\.set\(nested, \[detail\]\)/, 'an expanded fight must register itself as open');
  assert.match(fn[1], /openRenders\.delete\(nested\)/, 'a collapsed fight must unregister itself - it is no longer visible');
  assert.match(
    fn[1], /nested\.dataset\.renderedMode !== viewMode/,
    'a plain "already rendered" flag would leave stale content showing if the mode changed while this fight was collapsed'
  );
});

// Owner, 14 Sep, corrected same day: "the 'both' tab should not be two graphs, it should be a
// combined total graph that shows one graph of the sum of a player's damage and healer" - one bar
// per person, sized by damage+healing together, not two separate charts.
test('"Both" mode combines damage and healing into ONE total per person, not two separate charts', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const aggFn = renderer.match(/function aggregateBothRows\(details\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(aggFn, 'aggregateBothRows has been restructured or removed');
  assert.match(aggFn[1], /aggregateFightRows\(details, 'rows'\)/, 'must start from the damage side');
  assert.match(aggFn[1], /aggregateFightRows\(details, 'healRows'\)/, 'must start from the healing side');
  assert.match(aggFn[1], /agg\.damage \+= r\.damage/, 'a person\'s damage and healing totals must be SUMMED into one number');
  assert.match(aggFn[1], /agg\.bySkill = agg\.bySkill\.concat\(r\.bySkill\)/, 'both sides\' skills must fold into one breakdown list');

  const renderFn = renderer.match(/async function renderMetricBars\(container, details\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(renderFn, 'renderMetricBars has been restructured or removed');
  assert.match(renderFn[1], /viewMode === 'both'/);
  assert.match(renderFn[1], /aggregateBothRows\(details\)/);
  assert.match(
    renderFn[1], /await renderBars\(container, rows, totalDuration, 'both'\)/,
    'Both must draw ONE chart into the given container, not two side-by-side sub-charts'
  );
});

test('a Crit % column only appears where crits were actually tracked - per skill row, not per overall mode', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/async function renderBars\(container, rows, durationSec, metric = 'damage'\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderBars has been restructured or removed');
  assert.match(
    fn[1], /s\.crits === undefined \? null : /,
    'checking per-row (not the overall metric) is what lets "Both" mode show a real Crit % on a ' +
    'healer\'s own melee row and "—" on their heal rows, in the same combined skill list'
  );
});

// Owner, 14 Sep: "these permafrost caverns should be raid instances, let's make all raid entries
// include their difficulty level (d0, d4, etc etc)" - confirmed against the owner's own real log
// that "The Permafrost Caverns" alone has 5 genuinely different instance difficulties that all
// strip to the same base zone name, indistinguishable without this.
test('the zone entry point (both live and scanned) passes the RAW zone string\'s difficulty AND raid/group flag to enterZone', () => {
  const main = read('src', 'main', 'main.js');
  assert.match(
    main, /damageEngine\.enterZone\(Date\.now\(\), baseZoneName\(zone\), difficultyLabel\(zone\), isRaidInstance\(zone\)\)/,
    'the live zone-change handler must compute difficulty AND raid/group from the RAW zone string, not the stripped base name'
  );
  const scan = read('src', 'main', 'damageLogScan.js');
  assert.match(
    scan, /engine\.enterZone\(ms, baseZoneName\(zone\), difficultyLabel\(zone\), isRaidInstance\(zone\)\)/,
    'a batch log scan must tag difficulty AND raid/group the same way live play does'
  );
});

// Owner, 14 Sep: "mark them as D4 - [name]" (was "[name] (d4)"), plus "each difficulty prefix
// should be coloured as well, a different colour per difficulty, but the zone name should stay
// gold... d4 should have the most prominent colouring, d0 should be almost white but not white."
// This inline "D4 - Name" form is the detail SCREEN TITLE's own format now (a single heading
// line, not a table) - the Past Fights LIST uses its own dedicated grid column instead, see the
// next test.
test('the detail title puts a coloured "D<n> - " prefix ahead of the name, unchanged when it has no difficulty', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function appendZoneLabel\(container, zone, difficulty, raidInstance\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'appendZoneLabel has been restructured or removed');
  assert.match(fn[1], /zone-diff-d\$\{zoneDiffTier\(difficulty\)\}/, 'the prefix must carry a per-tier CSS class, not just plain text');
  assert.match(fn[1], /toUpperCase\(\)/, 'the difficulty must render as "D4", not lowercase "d4"');
  assert.match(renderer, /appendZoneLabel\(detailTitle, visit\.zone, visit\.difficulty, visit\.raidInstance\)/);

  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  for (const tier of ['d0', 'd1', 'd2', 'd3', 'd4']) {
    assert.match(css, new RegExp(`\\.zone-diff-${tier}\\s*\\{`), `missing a colour rule for ${tier}`);
  }
  // the zone name itself must never get a difficulty-coloured class - only the prefix does
  assert.match(fn[1], /container\.appendChild\(document\.createTextNode\(zone \|\| UNKNOWN_ZONE\)\)/);
});

// Owner, 14 Sep, third round on this feature: "it should be a prefix, like D1/d4. with it's own
// column" - the Past Fights LIST used to put the same inline "D4 - Name" text inside the zone
// cell; now the difficulty code lives in its own grid column (`.combat-visit-diff`, see the grid
// test above) and the zone cell holds only the bare name.
test('the visit list shows the difficulty code in its OWN column, separate from the zone name', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const badgeFn = renderer.match(/function zoneDifficultyBadge\(difficulty\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(badgeFn, 'zoneDifficultyBadge has been restructured or removed');
  assert.match(badgeFn[1], /if \(!difficulty\) return null/, 'a non-instanced zone must contribute nothing to the column, not an empty coloured box');
  assert.match(badgeFn[1], /zone-diff-d\$\{zoneDiffTier\(difficulty\)\}/);
  assert.doesNotMatch(badgeFn[1], /' - '/, 'no dash here - the grid column gap does that job now, not a baked-in separator');

  assert.match(renderer, /const diffBadge = zoneDifficultyBadge\(visit\.difficulty\)/, 'renderList must build the difficulty column from the visit\'s own difficulty');
  assert.match(
    renderer, /const zoneLink = span\(visit\.zone \|\| UNKNOWN_ZONE, 'combat-visit-zone'\)/,
    'the zone cell must hold only the bare name now - the difficulty code AND the raid/group badge both moved to their own columns'
  );
});

// Owner, 14 Sep, follow-up to the D-code column: "raid / group tags are still the same as before
// and not resolved, they do not have their own column" - the (Raid)/(Group) badge was still tacked
// onto the zone name text, the same original mistake the D-code prefix had just been fixed for.
test('the visit list shows the raid/group tag in its OWN column too, separate from the zone name', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const badgeFn = renderer.match(/function zoneInstanceBadge\(raidInstance\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(badgeFn, 'zoneInstanceBadge has been restructured or removed');
  assert.match(badgeFn[1], /typeof raidInstance !== 'boolean'\) return null/, 'a non-instanced visit must contribute nothing to the column');
  assert.match(badgeFn[1], /zone-instance-badge zone-instance-\$\{raidInstance \? 'raid' : 'group'\}/);
  assert.match(badgeFn[1], /raidInstance \? 'Raid' : 'Group'/, 'no parens here - it is its own column, not trailing text after a name');

  assert.match(renderer, /const instanceBadge = zoneInstanceBadge\(visit\.raidInstance\)/, 'renderList must build the raid/group column from the visit\'s own flag');
  assert.match(renderer, /instanceCell\.className = 'combat-visit-instance'/, 'the raid/group badge needs its own grid cell, not a spot inside the zone cell');

  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  assert.match(css, /\.combat-visit-instance\s*\{/, 'missing a CSS rule for the new column');
});

// Owner, 14 Sep (follow-up): "make sure all the hyphen's line up equally, they should be at a
// static width and not dependent on the width of the difficulty prefix" - "D0" and "D4" render at
// slightly different widths, which was shifting the dash (and the zone name after it) row to row.
test('the difficulty code sits in its own fixed-width box, so the dash lands at the same x regardless of the code', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function appendZoneLabel\(container, zone, difficulty, raidInstance\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'appendZoneLabel has been restructured or removed');
  assert.match(fn[1], /className = 'zone-diff-code'/, 'the difficulty code must be its own element, not inline text with the dash');
  assert.match(fn[1], /createTextNode\(' - '\)/, 'the dash must be appended AFTER the fixed-width code box, not baked into its text');

  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  const rule = css.match(/\.zone-diff-code\s*\{([\s\S]*?)\}/);
  assert.ok(rule, 'missing a .zone-diff-code rule');
  assert.match(rule[1], /display:\s*inline-block/, 'a fixed width only holds still on an inline-block (or block) box');
  assert.match(rule[1], /width:\s*\d/, 'the code box needs an explicit fixed width');
});

test('buildVisits carries the difficulty AND raid/group flag from whichever fight creates the visit', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function buildVisits\(history\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'buildVisits has been restructured or removed');
  assert.match(fn[1], /difficulty: fight\.difficulty \|\| null/);
  assert.match(
    fn[1], /raidInstance: typeof fight\.raidInstance === 'boolean' \? fight\.raidInstance : null/,
    'raidInstance is tri-state (true/false/null) - a bare `fight.raidInstance || null` would wrongly collapse a real `false` (group instance) to null'
  );
});

// Owner, 14 Sep follow-up: "there needs to be an identifier for (group)/raid instance" - a
// difficulty tier alone doesn't say whether THIS visit was the raid-lockout instance or a plain
// group run of the same zone.
test('the zone label shows a (Raid)/(Group) badge when the visit has one, nothing when it does not', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function appendZoneLabel\(container, zone, difficulty, raidInstance\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'appendZoneLabel has been restructured or removed');
  assert.match(fn[1], /typeof raidInstance === 'boolean'/, 'must gate on the tri-state flag, not just truthiness (false is a real, valid value)');
  assert.match(fn[1], /raidInstance \? 'Raid' : 'Group'/);
  // the badge must be a SEPARATE element/class from the difficulty code+dash, appended AFTER the
  // zone name - inserting it between the code and the dash would reopen the "hyphens don't line
  // up" bug the previous commit fixed.
  assert.match(fn[1], /zone-instance-badge zone-instance-\$\{raidInstance \? 'raid' : 'group'\}/);
  const afterZoneName = fn[1].indexOf('createTextNode(zone || UNKNOWN_ZONE)');
  const badgeIdx = fn[1].indexOf('zone-instance-badge');
  assert.ok(afterZoneName !== -1 && badgeIdx > afterZoneName, 'the raid/group badge must be appended AFTER the zone name, not before it or between the code and dash');

  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  assert.match(css, /\.zone-instance-raid\s*\{/, 'missing a colour rule for the raid badge');
  assert.match(css, /\.zone-instance-group\s*\{/, 'missing a colour rule for the group badge');

  // The visit list's own column helper must carry the identical badge class logic, not a copy
  // that drifts from this one - see the dedicated column test below for its own checks.
  const badgeFn = renderer.match(/function zoneInstanceBadge\(raidInstance\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(badgeFn, 'zoneInstanceBadge has been restructured or removed');
  assert.match(badgeFn[1], /zone-instance-badge zone-instance-\$\{raidInstance \? 'raid' : 'group'\}/);
});

// Owner, 14 Sep, second follow-up: a real reported case where one untagged trailing fight, right
// after being removed from a raid instance, silently erased the D4/Group tag off the 15 real
// tagged fights that came before it in the same visit. Fix, chosen by the owner: treat stepping
// out of (or into a different) difficulty/raid-or-group tag as a real visit boundary, the same as
// stepping into a different zone - not just a same-zone echo to ignore.
test('leaving an instance (or changing tier) opens a NEW visit, even though the base zone name is unchanged', () => {
  const engine = read('src', 'main', 'damageEngine.js');
  const fn = engine.match(/enterZone\(now = Date\.now\(\), zoneName = null, difficulty = null, raidInstance = null\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'enterZone has been restructured or removed');
  assert.match(
    fn[1], /normDifficulty !== this\.currentZoneDifficulty/,
    'a difficulty change alone (same zone name, different tier) must open a new visit'
  );
  assert.match(
    fn[1], /normRaidInstance !== this\.currentZoneRaidInstance/,
    'a raid/group change alone (same zone name and tier, different instance kind) must open a new visit'
  );
});

// ---------------------------------------------------------------------------
// "Live read the current combat... or check recent past events of the zone i'm in, fast" (owner,
// 14 Sep). Jumping straight into the current zone's latest visit, plus Older/Newer to step
// through that same zone's history without going back through the full list.
// ---------------------------------------------------------------------------

test('the current-zone jump button and Older/Newer controls exist', () => {
  const html = read('src', 'renderer', 'main-window', 'index.html');
  assert.match(html, /id="combat-jump-current-zone"/);
  assert.match(html, /id="combat-visit-older"/);
  assert.match(html, /id="combat-visit-newer"/);
});

test('the main process resolves the live current zone to its STRIPPED base name, not the raw suffixed string', () => {
  const main = read('src', 'main', 'main.js');
  assert.match(
    main, /ipcMain\.handle\('combat:getCurrentZoneBase', \(\) => baseZoneName\(widgetManager\.getCurrentZone\(\)\)\)/,
    'the renderer has no Node require() access to strip the suffix itself - this must arrive already stripped'
  );
  const preload = read('src', 'preload', 'preload-main.js');
  assert.match(preload, /getCombatCurrentZoneBase: \(\) => ipcRenderer\.invoke\('combat:getCurrentZoneBase'\)/);
});

test('jumpToCurrentZone opens the current zone\'s latest visit, or falls back to the list', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/async function jumpToCurrentZone\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'jumpToCurrentZone has been restructured or removed');
  assert.match(fn[1], /if \(!zone\) return;/, 'an unknown current zone must not crash or open something arbitrary');
  assert.match(fn[1], /zoneFilter\.value = zone/, 'the zone filter should reflect the jump, not silently diverge from what is shown');
  assert.match(fn[1], /openVisit\(visits\[visits\.length - 1\]\)/, 'must open the LATEST (most recent) visit, not the earliest');
  assert.match(fn[1], /showList\(\)/, 'a zone with no history yet must fall back to the list, not open nothing silently');
});

test('openVisit recomputes the same-zone sibling list and index every time, for Older/Newer', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/async function openVisit\(visit\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'openVisit has been restructured or removed');
  assert.match(fn[1], /currentZoneVisits = siblingVisits\(visit\.zone\)/, 'must scope navigation to the SAME zone, not the whole history');
  assert.match(
    fn[1], /v\.fights\[0\] && visit\.fights\[0\] && v\.fights\[0\]\.id === visit\.fights\[0\]\.id/,
    'buildVisits() returns fresh objects every call - matching by object identity would never find the visit just opened'
  );
  assert.match(fn[1], /updateVisitNavButtons\(\)/);

  const siblingFn = renderer.match(/function siblingVisits\(zone\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(siblingFn, 'siblingVisits has been restructured or removed');
  assert.match(siblingFn[1], /f\.totalDamage >= floor/, 'sibling visits should respect the same min-damage floor as the rest of the page');
});

test('Older/Newer disable at the ends of the same-zone visit list instead of wrapping or erroring', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function updateVisitNavButtons\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'updateVisitNavButtons has been restructured or removed');
  assert.match(fn[1], /olderBtn\.disabled = currentVisitIndex <= 0/);
  assert.match(
    fn[1], /newerBtn\.disabled = currentVisitIndex === -1 \|\| currentVisitIndex >= currentZoneVisits\.length - 1/
  );
  assert.match(renderer, /if \(currentVisitIndex > 0\) openVisit\(currentZoneVisits\[currentVisitIndex - 1\]\)/);
  assert.match(
    renderer,
    /if \(currentVisitIndex !== -1 && currentVisitIndex < currentZoneVisits\.length - 1\) \{\s*openVisit\(currentZoneVisits\[currentVisitIndex \+ 1\]\);/
  );
});

// ---------------------------------------------------------------------------
// "Live read the current combat" (owner, 14 Sep) - a "Live now" row above the list, and the
// detail screen showing the in-progress fight, both kept moving by a lightweight push from main.js
// rather than the Combat tab polling for it.
// ---------------------------------------------------------------------------

// Owner, 14 Sep, follow-up: "put a placeholder copy of the entire ui there even when no active
// fight log is happening" - the row used to be display:none until something was live, which gave
// no hint the feature even existed unless you happened to already be mid-fight when you opened the
// tab. It's always visible now, defaulting to a muted "idle" placeholder state in the markup
// itself (updateLiveRow reinforces this at runtime, but the HTML must not flash a blank/wrong
// state before the first tick arrives).
test('the "Live now" row is always visible, defaulting to a muted idle placeholder, never hidden', () => {
  const html = read('src', 'renderer', 'main-window', 'index.html');
  const start = html.indexOf('id="combat-live-row"');
  assert.ok(start !== -1, 'the live row is missing from the page');
  const section = html.slice(Math.max(0, start - 200), start + 400);
  assert.doesNotMatch(section, /style="display:\s*none"/, 'must not start (or ever become, via inline style) hidden - it is the placeholder for the feature itself');
  assert.match(section, /combat-live-row-idle/, 'must default to the muted idle state in the markup, not just via a JS call that runs a tick later');
  assert.match(html, /id="combat-live-status"/);
  assert.match(html, /id="combat-live-zone"/);
  assert.match(html, /id="combat-live-meta"/);

  const css = read('src', 'renderer', 'main-window', 'main-window.css');
  assert.match(css, /\.combat-live-row\.combat-live-row-idle\s*\{/, 'missing the muted-placeholder styling');
});

test('updateLiveRow toggles the idle placeholder class and text, rather than hiding the row', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function updateLiveRow\(fight\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'updateLiveRow has been restructured or removed');
  assert.doesNotMatch(fn[1], /style\.display/, 'must not hide/show via display any more - the idle CLASS carries the placeholder state instead');
  assert.match(fn[1], /liveRow\.classList\.toggle\('combat-live-row-idle', !fight\)/);
  assert.match(fn[1], /liveStatusEl\.textContent = '○ No fight'/);
  assert.match(fn[1], /liveStatusEl\.textContent = '● Live'/);
});

test('main.js exposes the live fight over IPC, and pings the renderer on every credited hit', () => {
  const main = read('src', 'main', 'main.js');
  assert.match(
    main, /ipcMain\.handle\('damage:getLiveFight', \(\) => damageEngine\.getLiveFight\(\)\)/,
    'must read the LIVE session\'s engine, never an imported scan - a scanned file has no "now"'
  );
  assert.match(
    main, /damageEngine\.on\('activeChanged', \(\) => \{[\s\S]*?broadcast\('damage:liveFightTick', null\)/,
    'must ping on the same event the overlay\'s own live meter already updates from'
  );
  const preload = read('src', 'preload', 'preload-main.js');
  assert.match(preload, /getLiveFight: \(\) => ipcRenderer\.invoke\('damage:getLiveFight'\)/);
  assert.match(preload, /onLiveFightTick: \(cb\) => ipcRenderer\.on\('damage:liveFightTick', \(\) => cb\(\)\)/);
});

test('a tick refreshes the Live row, and redraws the open live chart only when that is what is showing', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/async function onLiveFightTick\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'onLiveFightTick has been restructured or removed');
  assert.match(fn[1], /if \(liveRenderInFlight\) return;/, 'a fight can tick once per hit - an overlapping render must be dropped, not queued');
  assert.match(fn[1], /updateLiveRow\(fight\)/, 'the list-screen row must refresh on every tick regardless of which screen is showing');
  assert.match(fn[1], /if \(liveFightOpen\)/, 'the detail chart must only redraw when the live view is actually the one on screen');
  assert.match(fn[1], /liveFightOpen = false;\s*showList\(\);\s*loadHistory\(\);/, 'a fight ending between ticks must fall back to the list, not keep trying to render something that no longer exists');
});

// Owner, 14 Sep, follow-up: "this menu should be open always without a click into the fight when
// it's live" - waiting for the "Live now" row to be clicked wasn't good enough; the list screen
// should open the live view itself the moment a fight exists.
test('a tick auto-opens the live view when the list screen is showing, but never yanks the user out of a historical visit', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/async function onLiveFightTick\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'onLiveFightTick has been restructured or removed');
  assert.match(
    fn[1], /\} else if \(fight && listScreen\.style\.display !== 'none'\) \{\s*openLiveFight\(fight\);/,
    'auto-open must be gated on the LIST screen specifically being what is showing, not on liveFightOpen being false alone - a historical visit is also "not the live view" and must not get yanked away from'
  );
});

test('jumpToCurrentZone opens the live fight first, falling back to the latest completed visit only when nothing is live', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/async function jumpToCurrentZone\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'jumpToCurrentZone has been restructured or removed');
  const liveIdx = fn[1].indexOf('getLiveFight');
  const zoneIdx = fn[1].indexOf('getCombatCurrentZoneBase');
  assert.ok(liveIdx !== -1 && zoneIdx !== -1 && liveIdx < zoneIdx, 'must check for a live fight BEFORE falling back to the completed-visit path');
  assert.match(fn[1], /if \(live\) \{\s*openLiveFight\(live\);\s*return;/);
});

test('openLiveFight and openVisit each turn the OTHER kind of "live" state off, so a stray tick can\'t redraw the wrong screen', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const openVisitFn = renderer.match(/async function openVisit\(visit\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(openVisitFn);
  assert.match(openVisitFn[1], /liveFightOpen = false;/, 'opening a completed visit must clear liveFightOpen, or a tick could redraw the live chart over it');

  const openLiveFn = renderer.match(/function openLiveFight\(fight\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(openLiveFn, 'openLiveFight has been restructured or removed');
  assert.match(openLiveFn[1], /liveFightOpen = true;/);
  assert.match(openLiveFn[1], /currentZoneVisits = \[\];/, 'a single live fight has no siblings to step through - Older/Newer must not carry over stale state from whatever was open before');
});

// Owner, 14 Sep: a live fight showed "(zone unknown)" in the Combat tab despite genuinely being
// in a known zone the whole time - a session that had been running for a while (or restarted
// mid-fight) with no NEW "You have entered X." line since. Every other zone-aware engine already
// gets seeded from the startup log-tail recovery (readLastZoneEntry) - the damage meter never was.
test('the damage meter is seeded from the startup zone recovery, same as the raid board/travel guide/etc.', () => {
  const main = read('src', 'main', 'main.js');
  const start = main.indexOf('const found = readLastZoneEntry(logPath);');
  assert.ok(start !== -1, 'the startup zone-recovery block has moved or been removed');
  const block = main.slice(start, start + 1200);
  assert.match(
    block, /damageEngine\.enterZone\(Date\.now\(\), baseZoneName\(found\.zone\), difficultyLabel\(found\.zone\), isRaidInstance\(found\.zone\)\)/,
    'the damage meter must be seeded the same way the live zone-change handler seeds it - raw zone string in, base name + difficulty + raid/group out'
  );
});

// Owner, 14 Sep: "live damage flashes when refreshing" - confirmed with a screen recording. Frame-
// by-frame analysis showed the chart going completely blank for one frame on every single live
// tick. Root cause: renderBars() cleared the container BEFORE `await`ing a per-row IPC round trip
// (estimateDamageClasses) - fine for a one-off click, but the live view calls this on every hit.
// renderMetricBars() had the identical bug one level up, clearing again before its own `await
// renderBars(...)`. Fix: build the new content into a detached fragment, `await` everything that
// needs awaiting, and only THEN swap it in as one atomic replacement.
test('renderBars builds into a detached fragment and swaps it in atomically - never an empty gap during the class-estimate await', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/async function renderBars\(container, rows, durationSec, metric = 'damage'\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderBars has been restructured or removed');
  const clearIdx = fn[1].indexOf(`container.innerHTML = ''`);
  const awaitIdx = fn[1].indexOf('await Promise.all(');
  assert.ok(clearIdx !== -1 && awaitIdx !== -1, 'both the clear and the await must still exist');
  assert.ok(clearIdx > awaitIdx, 'the container must not be cleared until AFTER the async class-estimate work is done - clearing before it is the exact flash bug');
  assert.match(fn[1], /const fragment = document\.createDocumentFragment\(\)/);
  assert.match(fn[1], /fragment\.appendChild\(details\)/, 'rows must be built into the fragment, not appended straight into the live container');
  assert.doesNotMatch(fn[1], /container\.appendChild\(details\)/, 'a row appended directly into container would show up one at a time instead of swapping in as one piece');
});

test('renderMetricBars no longer clears its container up front - renderBars owns the one atomic swap', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/async function renderMetricBars\(container, details\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderMetricBars has been restructured or removed');
  assert.doesNotMatch(
    fn[1], /container\.innerHTML = ''/,
    'clearing here re-opens the exact empty window renderBars was fixed to close, since this runs BEFORE renderBars\' own await'
  );
});

// Owner, 14 Sep: "EVERY part of the app should have a recovery for accidental close, this is no
// exception" - Past Fights history had no session-restore registration at all until now. No
// staleness limit (unlike the live 'damage' registration above it) - a completed fight is a
// permanent fact, not an estimate that ages.
test('the Combat tab\'s fight history is registered with sessionRestore, with no staleness limit', () => {
  const main = read('src', 'main', 'main.js');
  const start = main.indexOf(`sessionRestore.register('damageHistory'`);
  assert.ok(start !== -1, 'damageHistory is not registered with sessionRestore');
  const end = main.indexOf('});', start);
  const block = main.slice(start, end);
  assert.doesNotMatch(block, /maxGapMs/, 'a completed fight record does not go stale - it must not be given a staleness limit the way the live "damage" registration has');
  assert.match(block, /capture: \(\) => damageEngine\.captureHistory\(\)/);
  assert.match(block, /restore: \(d\) => damageEngine\.restoreHistory\(d\)/);
});

module.exports = () => report('combat-tab');
if (require.main === module) report('combat-tab').then((n) => process.exit(n ? 1 : 0));
