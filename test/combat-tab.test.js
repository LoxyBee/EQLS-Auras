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
  // The id-splitting logic moved into a shared sourceForCompositeId() (also used by the class
  // estimate handler, which needs the SAME tag resolution) - check that one now.
  const lookup = main.match(/function sourceForCompositeId\(compositeId\) \{([\s\S]*?)\n}\n/);
  assert.ok(lookup, 'sourceForCompositeId has been restructured or removed');
  assert.match(lookup[1], /lastIndexOf\(':'\)/, 'a scan tag ("scan:0") itself contains a colon - splitting on the first one would break it');
  const fightFn = main.match(/function findHistoryFight\(compositeId\) \{([\s\S]*?)\n}\n/);
  assert.ok(fightFn, 'findHistoryFight has been restructured');
  assert.match(fightFn[1], /sourceForCompositeId\(compositeId\)/, 'findHistoryFight must reuse the shared resolver, not its own copy');
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
  assert.match(fn[1], /renderBars\(detailBars, rows, totalDuration, visit\.fights\[0\]\?\.id\)/);
  assert.match(fn[1], /detailFightList\.appendChild\(fightAccordionRow/, 'the individual fights must still be reachable from here');
});

test('a fight expands its own chart in place instead of navigating to a new screen', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/function fightAccordionRow\(fight, detail\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'fightAccordionRow has been restructured or removed');
  assert.match(fn[1], /createElement\('details'\)/, 'a fight row must be an accordion, not a link to another screen');
  assert.match(fn[1], /renderBars\(nested, detail\.rows, detail\.durationSec, fight\.id\)/, 'expanding it must draw its OWN chart, not reuse the visit\'s combined one');
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
  assert.match(fn[1], /backBtn\.addEventListener\('click', showList\)/, 'Back must go straight to showList, not through an intermediate screen');
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
  const fn = renderer.match(/function renderBars\(container, rows, durationSec, sourceFightId\) \{([\s\S]*?)\n {2}\}/);
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
  const fn = renderer.match(/function renderBars\(container, rows, durationSec, sourceFightId\) \{([\s\S]*?)\n {2}\}/);
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
  const fn = renderer.match(/function renderBars\(container, rows, durationSec, sourceFightId\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderBars has been restructured or removed');
  assert.match(
    fn[1], /combat-skill-track-area/,
    'the track/fill must live in a wrapper spanning the whole numbers area, not just the Damage column'
  );
  assert.match(
    fn[1], /trackArea\.appendChild\(track\)[\s\S]*trackArea\.appendChild\(amount\)[\s\S]*trackArea\.appendChild\(span\(`\$\{share\}%`, 'combat-skill-share'\)\)[\s\S]*trackArea\.appendChild\(span\(`\$\{critPct\}%`, 'combat-skill-crit'\)\)/,
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
  const fn = renderer.match(/function renderBars\(container, rows, durationSec, sourceFightId\) \{([\s\S]*?)\n {2}\}/);
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

// Owner, 13-14 Sep: "add in the class estimation and put it as the first text in the damage
// coloured bar... make sure that it is it's own column" - then corrected: "buffs can be used to
// guess a class, but ONLY if they are seen being cast... damage from puma is not [an indicator]".
// The estimate is built from cast-line evidence for THIS specific attacker (by name, via the
// fight's own composite id naming which engine holds it), never from this row's own damage-log
// skill list - a proc's damage can't prove who cast the buff behind it.
test('the class estimate is the first thing in the damage bar, in its own column ahead of the amount', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  const fn = renderer.match(/async function renderBars\(container, rows, durationSec, sourceFightId\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderBars must exist and be async - it awaits a class estimate for every row');
  assert.match(
    fn[1], /window\.eqTracker\.estimateDamageClasses\(sourceFightId, row\.name\)/,
    'the estimate must be looked up by THIS attacker\'s name against the right engine, never this row\'s own damage skill list'
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

// The IPC round trip the class estimate above depends on - main.js hosts the actual lookup
// (gameSpellData needs the installed spells_us.txt, which only the main process can read) and
// resolves WHICH engine's cast history to read via the fight id's own source tag (live session vs
// one specific log scan) - a scanned log's casts must never blend with the live session's.
test('the class estimate is wired IPC -> preload -> renderer, resolved against the right engine', () => {
  const main = read('src', 'main', 'main.js');
  const handler = main.match(/ipcMain\.handle\('damage:estimateClasses', \(_event, \{ fightId, attackerName \} = \{\}\) => \{([\s\S]*?)\n\}\);/);
  assert.ok(handler, 'the damage:estimateClasses handler has been restructured or removed');
  assert.match(handler[1], /sourceForCompositeId\(fightId\)/, 'must resolve the SOURCE engine, not always the live session');
  assert.match(handler[1], /resolved\.src\.engine\.getCastSkills\(attackerName\)/, 'must read cast history, never a damage-log skill list');
  assert.match(handler[1], /gameSpellData\.getClassesForSpell\(currentInstallRoot, name\)/);
  const preload = read('src', 'preload', 'preload-main.js');
  assert.match(
    preload, /estimateDamageClasses: \(fightId, attackerName\) => ipcRenderer\.invoke\('damage:estimateClasses', \{ fightId, attackerName \}\)/
  );
});

module.exports = () => report('combat-tab');
if (require.main === module) report('combat-tab').then((n) => process.exit(n ? 1 : 0));
