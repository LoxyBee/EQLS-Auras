'use strict';
/**
 * Zone-gated auras - note 38.
 *
 * Shara, 22 August, on whether "The Plane of Fear" and "The Plane of Fear - Group" should be the
 * same zone: "make them separate". So a zone is the exact string the game printed, with no
 * collapsing at all - "Befallen" and "Befallen 1 (Awakened)" are two different zones, and gating
 * to one does not cover the other.
 *
 * TWO THINGS THIS SUITE EXISTS TO HOLD.
 *
 * First: an empty zone list means EVERYWHERE, and an unknown current zone means SHOW. That
 * polarity is the whole safety argument. The only line naming a zone is the one printed when you
 * change zone, so an app started mid-session does not know where the player is - measured across
 * these logs, the expected wait for that line from a random start is about 55 minutes of active
 * play, with a five-hour case. If unknown meant hidden, every zone-gated aura would vanish after a
 * restart and stay vanished, silently. A false positive is visible and self-corrects on the next
 * zone change; a false negative is invisible and lasts a session.
 *
 * Second: the matcher is anchored on the timestamp. Anyone can type "You have entered Everfrost."
 * into General chat, and in 1,521,971 lines exactly one person did.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { matchZoneChange } = require('../src/main/buffParser');
const { WidgetStore } = require('../src/main/widgetStore');
const KNOWN_ZONES = require('../src/shared/data/zones');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const managerSrc = read('src', 'main', 'widgetManager.js');
const mainSrc = read('src', 'main', 'main.js');
const storeSrc = read('src', 'main', 'widgetStore.js');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const preloadSrc = read('src', 'preload', 'preload-main.js');

const TS = '[Wed Aug 19 19:17:52 2026] ';

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

// THE REAL FUNCTION, not a copy of it. widgetManager cannot be required here because it pulls in
// Electron, which is exactly why this rule was moved into a module of its own: four suites in this
// project have been written against reproduced copies, and mutation testing showed every one of
// them passing while the real code was inverted.
const { isVisibleInZone: visibleIn } = require('../src/shared/zoneVisibility');

// ---------------------------------------------------------------------------
// Reading the line
// ---------------------------------------------------------------------------

test('a zone change is recognised, in every shape the logs contain', () => {
  for (const [line, want] of [
    ['You have entered Befallen.', 'Befallen'],
    ['You have entered Befallen 1 (Awakened).', 'Befallen 1 (Awakened)'],
    ['You have entered The Plane of Fear - Group 3 (Fused).', 'The Plane of Fear - Group 3 (Fused)'],
    ["You have entered Nagafen's Lair 1 (Awakened).", "Nagafen's Lair 1 (Awakened)"],
    ['You have entered Temple of Cazic-Thule.', 'Temple of Cazic-Thule'],
    ['You have entered West Commonlands.', 'West Commonlands'],
  ]) {
    assert.equal(matchZoneChange(TS + line), want, `failed on: ${line}`);
  }
});

test('a player typing the line in chat does NOT move the app', () => {
  // The real line, verbatim from 17 August. An unanchored lazy match pulls "Everfrost" out of it -
  // a genuine zone name, from a stranger's chat. One line in 1.5 million, and this is the guard.
  const chat =
    "[Mon Aug 17 02:01:16 2026] Maryona tells General:1, 'Back in 2000 playing my DE Mage, went to " +
    'explore Permafrost. Bound myself outside in a nice little alcove that "seemed safe" well I died ' +
    'in Permafrost. Loading, please wait... You have entered Everfrost. You have been slain by an ' +
    "ice giant, loading, please wait... ...'";
  assert.equal(matchZoneChange(chat), null, 'a chat message moved the app to another zone');
});

test('a line with no timestamp is not a zone change', () => {
  assert.equal(matchZoneChange('You have entered Befallen.'), null);
});

test('"an area where..." is excluded on purpose', () => {
  // Absent from these logs but a real EverQuest line, so it is excluded deliberately rather than
  // by luck. It shares the whole opening.
  assert.equal(matchZoneChange(`${TS}You have entered an area where levitation does not function.`), null);
  assert.match(managerSrc + read('src', 'main', 'buffParser.js'), /NOT_A_ZONE_PREFIX/);
});

test('the other zone-ish lines are not mistaken for it', () => {
  for (const line of [
    'LOADING, PLEASE WAIT...',
    'Returning to Zone Safe Point. Please wait...',
    'Welcome to EverQuest Legends!',
    'You have entered.',
  ]) {
    assert.equal(matchZoneChange(TS + line), null, `treated as a zone change: ${line}`);
  }
});

// ---------------------------------------------------------------------------
// Separate means separate
// ---------------------------------------------------------------------------

test('an instance is a different zone from its base', () => {
  // Her instruction. Gating to Befallen does NOT cover Befallen 1 (Awakened).
  assert.equal(visibleIn(['Befallen'], 'Befallen'), true);
  assert.equal(visibleIn(['Befallen'], 'Befallen 1 (Awakened)'), false);
  assert.equal(visibleIn(['Befallen', 'Befallen 1 (Awakened)'], 'Befallen 1 (Awakened)'), true);
});

test('the group version is a different zone too', () => {
  assert.equal(visibleIn(['The Plane of Fear'], 'The Plane of Fear - Group'), false);
  assert.equal(visibleIn(['The Plane of Fear - Group'], 'The Plane of Fear'), false);
});

test('nothing in the code collapses a zone name', () => {
  // The tempting bug: a strip regex that turns "Befallen 1 (Awakened)" into "Befallen". She asked
  // for separate, so there must be no such thing anywhere.
  for (const [name, src] of [['widgetManager', managerSrc], ['main', mainSrc], ['widgetStore', storeSrc]]) {
    assert.doesNotMatch(src, /Awakened\|Adaptive\|Fused\|Refined/, `${name} collapses instance names`);
  }
});

// ---------------------------------------------------------------------------
// The safety polarity
// ---------------------------------------------------------------------------

test('no zones set means everywhere', () => {
  assert.equal(newStore().create('Mine').visibleInZones.length, 0, 'a new aura is gated by default');
  assert.equal(visibleIn([], 'Befallen'), true);
  assert.equal(visibleIn([], null), true);
});

test('an unknown zone SHOWS a gated aura, it does not hide it', () => {
  // The one that matters most. The app cannot know the zone until the player changes zone.
  assert.equal(visibleIn(['Befallen'], null), true);
  // And widgetManager uses the shared rule rather than keeping a copy that could drift from it.
  assert.match(managerSrc, /return isVisibleInZone\(config\.visibleInZones, currentZone\);/);
});

test('the store fails open too', () => {
  // The polarity lives in normalizeWidget so a corrupted value cannot be read as "nowhere".
  assert.match(
    storeSrc,
    /visibleInZones: Array\.isArray\(widget\.visibleInZones\) \? widget\.visibleInZones : \[\]/,
    'a non-array visibleInZones no longer becomes "everywhere"'
  );
  const data = { widgets: { version: 2, widgets: [{ id: 'x', name: 'Broken', kind: 'custom', visibleInZones: 'Befallen' }] } };
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: () => {},
  });
  assert.deepEqual(store.getById('x').visibleInZones, [], 'a corrupted value did not fail open');
});

// ---------------------------------------------------------------------------
// Where it sits in the visibility rules
// ---------------------------------------------------------------------------

test('the zone clause sits beside the profile check and honours unlock', () => {
  const fn = managerSrc.match(/function shouldBeOnScreen\(config\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'shouldBeOnScreen has been restructured');
  assert.match(fn[1], /if \(!isVisibleInCurrentZone\(config\) && !forceShown\.has\(config\.id\)\) return false;/);
  // Same kind of rule as the profile one, so it belongs next to it - and above sound-only, which
  // returns true and would otherwise let a gated sound aura keep beeping in the wrong zone.
  const at = (s) => fn[1].indexOf(s);
  assert.ok(at('isVisibleForActiveProfile') < at('isVisibleInCurrentZone'), 'zone check is above the profile check');
  assert.ok(at('isVisibleInCurrentZone') < at('isSoundOnly'), 'a gated sound aura would still make noise');
});

test('changing zone re-evaluates every aura', () => {
  const fn = managerSrc.match(/function applyZoneChange\(zone\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'applyZoneChange has been renamed or restructured');
  assert.match(fn[1], /widgetStore\.getAll\(\)/, 'only some auras are re-evaluated');
  assert.match(fn[1], /applyVisibility\(config\)/);
  // No work at all when the zone did not actually change - the line fires on every zone entry,
  // including re-entering the one you are in.
  assert.match(fn[1], /if \(!setCurrentZone\(zone\)\) return/);
});

test('the log listener is separate from the two engines', () => {
  // A zone is not a buff and not a custom timer. Hooking it inside either would make an unrelated
  // engine responsible for it.
  assert.match(mainSrc, /const zone = matchZoneChange\(line\);/);
  assert.match(mainSrc, /widgetManager\.applyZoneChange\(zone\)/);
});

// ---------------------------------------------------------------------------
// Saying why an aura is hidden
// ---------------------------------------------------------------------------

test('the panel says when the zone rule is what is hiding an aura', () => {
  // A zone rule is a NEW way for an aura to be missing with no explanation, which is the failure
  // this project keeps having. When it bites, the panel names the zone you are actually in.
  const fn = rendererSrc.match(/function renderWidgetZones\(widget\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, 'renderWidgetZones has been renamed or restructured');
  assert.match(fn[1], /Hidden right now/, 'nothing tells the user the zone rule is hiding it');
  assert.match(fn[1], /currentZone/, 'the warning does not name the zone you are in');
  assert.match(fn[1], /does not know where you are yet/, 'the unknown-zone case is not explained');
  assert.match(html, /id="widget-zone-warning"/);
});

test('the picker offers the observed zones and accepts anything else', () => {
  assert.ok(KNOWN_ZONES.length >= 60, `only ${KNOWN_ZONES.length} seed zones`);
  assert.ok(KNOWN_ZONES.includes('Befallen') && KNOWN_ZONES.includes('Befallen 1 (Awakened)'));
  assert.ok(KNOWN_ZONES.includes('The Plane of Fear') && KNOWN_ZONES.includes('The Plane of Fear - Group'));
  // A datalist suggests without restricting, which is the point - the seed is 66 zones from two
  // weeks of play, not every zone in the game.
  assert.match(html, /<datalist id="known-zones">/);
  assert.match(html, /id="widget-zone-input"[\s\S]{0,200}list="known-zones"/);
  assert.match(mainSrc, /ipcMain\.handle\('zone:known'/);
});

test('a zone can be added by typing and removed by clicking', () => {
  assert.match(rendererSrc, /zoneAddBtn\.addEventListener\('click', addZoneToSelected\)/);
  assert.match(rendererSrc, /if \(e\.key === 'Enter'\)/, 'Enter does nothing, which reads as broken');
  assert.match(rendererSrc, /setWidgetVisibleInZones\(widget\.id, next\)/, 'no way to remove one');
});

test('it is wired end to end', () => {
  assert.match(preloadSrc, /getCurrentZone:/);
  assert.match(preloadSrc, /getKnownZones:/);
  assert.match(preloadSrc, /setWidgetVisibleInZones:/);
  assert.match(preloadSrc, /onZoneChanged:/);
  assert.match(mainSrc, /ipcMain\.handle\('zone:current'/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:setVisibleInZones'/);
  assert.match(managerSrc, /^ {2}setVisibleInZones,$/m);
  assert.match(managerSrc, /^ {2}applyZoneChange,$/m);
  assert.match(storeSrc, /'visibleInZones',/, 'not shareable, so a share code drops the zone list');
});

module.exports = () => report('zone-gating');
if (require.main === module) process.exit(report('zone-gating') ? 1 : 0);
