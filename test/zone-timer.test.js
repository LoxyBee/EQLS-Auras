'use strict';
/**
 * The "Zone timer" aura (owner's weekly notes, 13 Sep) - one row, "<zone> <elapsed>", counting up
 * since the app last saw a zone change. A plain custom aura, buffSource 'zoneTimer', no settings of
 * its own - same shape as First aggro. Structural, like raid-named-wiring.test.js: the store builds
 * the right kind, IPC/preload/manager exist, the premade entry is there, overlay.js routes the
 * source. widgetManager cannot be required here (it pulls in electron - see zone-gating.test.js),
 * so its zoneEnteredAt tracking is checked by reading its source rather than executing it.
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

test('createZoneTimerAura builds a zoneTimer-source aura with no picker settings', () => {
  const w = newStore().createZoneTimerAura('Zone timer');
  assert.equal(w.buffSource, 'zoneTimer');
  assert.equal(w.sortOrder, 'default');
  assert.equal(w.landingGlowEnabled, false);
});

test('setCurrentZone tracks when the app last learned the zone, not just what it is', () => {
  const src = read('src', 'main', 'widgetManager.js');
  assert.match(src, /let zoneEnteredAt = null;/);
  assert.match(src, /zoneEnteredAt = Date\.now\(\);/);
  assert.match(src, /function getZoneEnteredAt\(\)/);
  assert.match(src, /getZoneEnteredAt,/, 'not exported from the module');
});

test('a no-op zone change (same zone reported twice) does not restart the clock', () => {
  const src = read('src', 'main', 'widgetManager.js');
  const fn = src.match(/function setCurrentZone\(zone\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'setCurrentZone has been restructured');
  // The early-return guard must come BEFORE the timestamp is touched, or a duplicate zone line
  // would look like a fresh entry and reset "time in zone" for no reason.
  const earlyReturnIdx = fn[1].indexOf('return false');
  const timestampIdx = fn[1].indexOf('zoneEnteredAt = Date.now()');
  assert.ok(earlyReturnIdx > -1 && timestampIdx > -1 && earlyReturnIdx < timestampIdx,
    'the early return for an unchanged zone must run before the clock resets');
});

test('it is wired IPC -> preload -> manager, and ticks every second', () => {
  const main = read('src', 'main', 'main.js');
  assert.match(main, /ipcMain\.handle\('widget:createZoneTimer'/);
  assert.match(main, /ipcMain\.handle\('zoneTimer:getActive'/);
  assert.match(main, /function pushZoneTimer/);
  assert.match(main, /setInterval\(pushZoneTimer, 1000\)/);
  // Every place that can change the current zone (a real log line, a restart recovery, the
  // zone-prompt popup answer) funnels through applyZoneChangeAndNotify - pushing from inside it
  // once covers all three instead of needing a call at each site.
  const fn = main.match(/function applyZoneChangeAndNotify\(zone\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'applyZoneChangeAndNotify has been restructured');
  assert.match(fn[1], /pushZoneTimer\(\);/);
  assert.match(read('src', 'main', 'widgetManager.js'), /function createZoneTimerWidget/);
  assert.match(read('src', 'preload', 'preload-main.js'), /createZoneTimerWidget:/);
  assert.match(read('src', 'preload', 'preload-overlay.js'), /getZoneTimer:/);
  assert.match(read('src', 'preload', 'preload-overlay.js'), /onZoneTimerChanged:/);
});

test('zoneTimerRow is empty until a zone is known, and formats past an hour', () => {
  const main = read('src', 'main', 'main.js');
  const fn = main.match(/function zoneTimerRow\(\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'zoneTimerRow has been restructured');
  assert.match(fn[1], /if \(!zone \|\| !enteredAt\) return \[\];/);
  const fmt = main.match(/function formatElapsed\(sec\) \{([\s\S]*?)\n\}/);
  assert.ok(fmt, 'formatElapsed has been restructured');
  assert.match(fmt[1], /h > 0 \? `\$\{h\}:\$\{mm\}:\$\{ss\}` : `\$\{mm\}:\$\{ss\}`/);
});

test('overlay.js routes the zoneTimer source and shows the row unfiltered (no picker)', () => {
  const overlay = read('src', 'renderer', 'overlay', 'overlay.js');
  assert.match(overlay, /buffSource === 'zoneTimer'\) return lastZoneTimer/);
  assert.match(overlay, /buffSource === 'zoneTimer'\) return buffs/); // visibleBuffs bypass
});

test('the premade list has a Zone timer entry under standalone', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(renderer, /id: 'zone-timer'/);
  assert.match(renderer, /createZoneTimerWidget\(name\)/);
  const start = renderer.indexOf("id: 'zone-timer'");
  const block = renderer.slice(start, start + 400);
  assert.match(block, /group: 'standalone'/);
});

test('widgetShape resolves buffSource zoneTimer to its own shape, with no alerts field', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(renderer, /buffSource === 'zoneTimer'\) return 'zone-timer'/);
  const block = renderer.match(/'zone-timer': \[([^\]]*)\]/);
  assert.ok(block, 'zone-timer has no SHAPE_FIELDS entry');
  assert.doesNotMatch(block[1], /'alerts'/, 'nothing on this aura lands or expires - alerts should not be offered');
});

module.exports = () => report('zone-timer');
if (require.main === module) report('zone-timer').then((n) => process.exit(n ? 1 : 0));
