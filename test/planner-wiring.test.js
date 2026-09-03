'use strict';
/**
 * The buff optimiser's plumbing: per-profile input on profileStore, and the IPC/preload bridge
 * that carries it. The planning maths itself is in buff-planner.test.js.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { ProfileStore, DEFAULT_PROFILE_ID } = require('../src/main/profileStore');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const mainSrc = read('src', 'main', 'main.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');

function newStore() {
  const data = {};
  return new ProfileStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

test('a fresh profile has no planner input - the planner reads that as "no plan yet"', () => {
  const store = newStore();
  const p = store.getProfile(DEFAULT_PROFILE_ID);
  assert.ok(p);
  assert.equal(p.plannerClasses, undefined);
  assert.equal(p.plannerLevel, undefined);
  assert.equal(p.buffPlanOrder, undefined);
});

test('planner input persists onto the named profile only, and is codes + one shared level', () => {
  const store = newStore();
  const other = store.create('Melee');
  store.setPlannerClasses(DEFAULT_PROFILE_ID, ['ENC', 'SHM', 'CLR']);
  store.setPlannerLevel(DEFAULT_PROFILE_ID, 42);
  store.setBuffPlanOrder(DEFAULT_PROFILE_ID, ['Haste', 'Strength']);

  assert.deepEqual(store.getProfile(DEFAULT_PROFILE_ID).plannerClasses, ['ENC', 'SHM', 'CLR']);
  assert.equal(store.getProfile(DEFAULT_PROFILE_ID).plannerLevel, 42);
  assert.deepEqual(store.getProfile(DEFAULT_PROFILE_ID).buffPlanOrder, ['Haste', 'Strength']);
  assert.equal(store.getProfile(other.id).plannerClasses, undefined, 'the other profile is untouched');
});

test('setPlannerClasses caps at three and drops non-strings; level is clamped to 1..50', () => {
  const store = newStore();
  store.setPlannerClasses(DEFAULT_PROFILE_ID, ['ENC', 'SHM', 'CLR', 'DRU', 7]);
  assert.deepEqual(store.getProfile(DEFAULT_PROFILE_ID).plannerClasses, ['ENC', 'SHM', 'CLR']);
  store.setPlannerLevel(DEFAULT_PROFILE_ID, 999);
  assert.equal(store.getProfile(DEFAULT_PROFILE_ID).plannerLevel, 50);
  store.setPlannerLevel(DEFAULT_PROFILE_ID, 0);
  assert.equal(store.getProfile(DEFAULT_PROFILE_ID).plannerLevel, 1);
});

test('the input survives a reload', () => {
  const data = {};
  const io = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const s = new ProfileStore(io);
  s.setPlannerClasses(DEFAULT_PROFILE_ID, ['CLR']);
  s.setPlannerLevel(DEFAULT_PROFILE_ID, 33);
  const reloaded = new ProfileStore(io);
  assert.deepEqual(reloaded.getProfile(DEFAULT_PROFILE_ID).plannerClasses, ['CLR']);
  assert.equal(reloaded.getProfile(DEFAULT_PROFILE_ID).plannerLevel, 33);
});

test('setBuffPlanOrder rejects a non-array and strips non-strings', () => {
  const store = newStore();
  store.setBuffPlanOrder(DEFAULT_PROFILE_ID, ['Haste', 42, null, 'Strength']);
  assert.deepEqual(store.getProfile(DEFAULT_PROFILE_ID).buffPlanOrder, ['Haste', 'Strength']);
  store.setBuffPlanOrder(DEFAULT_PROFILE_ID, 'nope');
  assert.deepEqual(store.getProfile(DEFAULT_PROFILE_ID).buffPlanOrder, []);
});

test('a planner setter on an unknown profile id is a no-op, not a throw', () => {
  const store = newStore();
  assert.equal(store.setPlannerClasses('does-not-exist', []), null);
  assert.equal(store.setPlannerLevel('does-not-exist', 10), null);
});

// ---------------------------------------------------------------------------
// the bridge
// ---------------------------------------------------------------------------

test('every planner IPC channel is handled in main and exposed in preload', () => {
  for (const ch of ['planner:getInput', 'planner:setClasses', 'planner:setLevel', 'planner:setOrder', 'planner:setExcludedStats', 'planner:compute']) {
    assert.ok(mainSrc.includes(`ipcMain.handle('${ch}'`), `${ch} not handled`);
  }
  assert.match(preloadSrc, /getPlannerInput: \(profileId\) =>/);
  assert.match(preloadSrc, /setPlannerClasses: \(profileId, classes\) =>/);
  assert.match(preloadSrc, /setPlannerLevel: \(profileId, level\) =>/);
  assert.match(preloadSrc, /setPlannerOrder: \(profileId, order\) =>/);
  assert.match(preloadSrc, /setPlannerExcludedStats: \(profileId, stats\) =>/);
  assert.match(preloadSrc, /computePlan: \(profileId\) =>/);
});

test('the "ignore stats" toggles are wired: markup, stat list from main, and it feeds computePlan', () => {
  const page = read('src', 'renderer', 'main-window', 'index.html').match(/<section id="page-planner"[\s\S]*?<\/section>/)[0];
  assert.match(page, /id="planner-exclude-chips"/, 'the ignore-stats chip container is missing');
  assert.match(mainSrc, /allStats: spellEffects\.STAT_NAMES/, 'getInput must hand the renderer the stat list');
  const fn = mainSrc.match(/ipcMain\.handle\('planner:compute'[\s\S]*?\n\}\);/)[0];
  assert.match(fn, /excludedStats/, 'planner:compute must read and pass the ignored stats');
  assert.match(rendererSrc, /setPlannerExcludedStats\(null, excludedStats\)/, 'a chip click must persist and recompute');
});

test('planner:compute recomputes from the live roster and never persists a plan', () => {
  const fn = mainSrc.match(/ipcMain\.handle\('planner:compute'[\s\S]*?\n\}\);/)[0];
  assert.match(fn, /const roster = buffStore\.getAll\(\);/);
  assert.match(fn, /buffPlanner\.computePlan\(\{ roster,/);
  assert.doesNotMatch(fn, /saveJson|profileStore\.set/, 'compute must be read-only');
});

test('the planner and the detection engine both use the heading model (buffLines)', () => {
  assert.match(mainSrc, /const buffLines = require\('\.\.\/shared\/buffLines'\)/);
  assert.match(mainSrc, /computePlan\(\{ roster,[\s\S]*?lines: buffLines/);
  assert.match(mainSrc, /buffEngine\.setLineStackFn\(\(incomingName, activeName\) => buffLines\.stackDecision/);
});

test('planner:compute only reads the real stat numbers when the EQ folder is set', () => {
  const fn = mainSrc.match(/ipcMain\.handle\('planner:compute'[\s\S]*?\n\}\);/)[0];
  assert.match(fn, /currentInstallRoot\s*\?\s*\{[\s\S]*?spellEffects\.spellStats/);
  assert.match(fn, /spellData/);
});

test('nothing in the planner pipeline exposes the game\'s internal effect numbers ("SPA")', () => {
  for (const f of ['spellEffects.js', 'buffPlanner.js']) {
    const src = read('src', 'main', f);
    assert.doesNotMatch(src, /\bSPA\b/, `"SPA" appears in ${f}`);
  }
});

test('planner:compute uses the full stacking engine, not gated on the EQ folder or any toggle', () => {
  const fn = mainSrc.match(/ipcMain\.handle\('planner:compute'[\s\S]*?\n\}\);/)[0];
  assert.doesNotMatch(mainSrc, /useStackingModel/, 'the useStackingModel toggle is gone');
  assert.doesNotMatch(mainSrc, /spellStacking\.(checkOverwrite|stackVerdict)/, 'the old narrow engine is gone');
  // stackingService.planConflict, with the real character level.
  assert.match(fn, /const checkStack = \(activeId, incomingId\) => stackingService\.planConflict\(activeId, incomingId, level\)/);
});

// ---------------------------------------------------------------------------
// the page
// ---------------------------------------------------------------------------

test('the Buff Planner is UNLOCKED - the nav button is live (Fix 4, 2 Sep)', () => {
  assert.match(html, /class="nav-btn" data-page="page-planner" id="planner-nav-btn"/, 'the Buff Planner nav button must be present');
  assert.match(html, /<section id="page-planner" class="page">/);
  // Framing (Fix 4): a "loadout sheet", never "optimiser" / "best setup".
  const page = html.slice(html.indexOf('id="page-planner"'), html.indexOf('id="page-about"'));
  assert.doesNotMatch(page, /optimis|Best setup|best setup/, 'the planner must not claim to be an optimiser');
  assert.match(page, /Your loadout/);
  assert.match(page, /name="planner-playstyle"/, 'the playstyle preset control is missing');
});

test('initBuffPlanner still gates on the nav button (so a future re-lock is a one-liner)', () => {
  const fn = rendererSrc.match(/function initBuffPlanner\(\) \{[\s\S]*?\n\}\n/)[0];
  assert.match(fn, /if \(!document\.querySelector\('\.nav-btn\[data-page="page-planner"\]'\)\) return;/);
});

test('every element initBuffPlanner queries is present in the markup', () => {
  const ids = [
    'planner-class-rows', 'planner-level-input', 'planner-slot-list', 'planner-slot-count',
    'planner-song-card', 'planner-song-list', 'planner-song-count',
    'planner-permanent-card', 'planner-permanent-list', 'planner-permanent-count',
    'planner-priority-list', 'planner-overflow-card', 'planner-overflow-list', 'planner-overflow-count',
    'planner-empty-note', 'planner-stacking-state', 'planner-active-profile',
    'planner-priority-reset',
  ];
  for (const id of ids) assert.ok(html.includes(`id="${id}"`), `#${id} missing from index.html`);
});

test('the song section is only shown when Bard is picked; permanent only when non-empty', () => {
  const fn = rendererSrc.match(/function initBuffPlanner\(\) \{[\s\S]*?\n\}\n/)[0];
  assert.match(fn, /songCardEl\.style\.display = plan\.hasBard \? '' : 'none'/);
  assert.match(fn, /permCardEl\.style\.display = perm\.length \? '' : 'none'/);
});

test('the level picker sits above the class row and is capped at 50', () => {
  assert.match(html, /id="planner-level-input"[^>]*max="50"/);
  const lvlAt = html.indexOf('planner-level-input');
  const classAt = html.indexOf('planner-class-rows');
  assert.ok(lvlAt > -1 && classAt > -1 && lvlAt < classAt, 'level input should come before the class row');
});

test('initBuffPlanner is defined and called at startup', () => {
  assert.match(rendererSrc, /\n  initBuffPlanner\(\);/, 'not called from the init sequence');
  assert.match(rendererSrc, /function initBuffPlanner\(\) \{/);
});

test('the page persists every input and recomputes after each change', () => {
  const fn = rendererSrc.match(/function initBuffPlanner\(\) \{[\s\S]*?\n\}\n/)[0];
  assert.match(fn, /setPlannerClasses\(null, classes\)\.then\(recompute\)/);
  assert.match(fn, /setPlannerLevel\(null, n\)\.then\(recompute\)/);
  assert.match(fn, /setPlannerOrder\(null, order\)\.then\(recompute\)/);
  assert.match(fn, /onActiveProfileChanged\(\(\) => loadInput\(\)\)/, 'a loadout switch must reload the plan');
});

test('"Reset to recommended" clears the saved priority order and is only shown when one exists', () => {
  const fn = rendererSrc.match(/function initBuffPlanner\(\) \{[\s\S]*?\n\}\n/)[0];
  assert.match(fn, /priorityResetEl\.addEventListener\('click'[\s\S]*?setPlannerOrder\(null, \[\]\)\.then\(recompute\)/);
  assert.match(fn, /priorityResetEl\.style\.display = hasManualOrder \? '' : 'none'/);
  assert.match(fn, /hasManualOrder = order\.length > 0/);
});

module.exports = () => report('planner-wiring');
if (require.main === module) report('planner-wiring').then((n) => process.exit(n ? 1 : 0));
