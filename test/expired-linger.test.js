'use strict';
/**
 * QOL #48 - hold an expired icon-mode tile on screen briefly, greyed, instead of letting it
 * vanish. trackExpiredLinger()/clearExpiredLinger() plus their two module Maps are lifted out of
 * overlay.js and run. The render() wiring, updateRef branch, CSS and store field are structural.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');

const ROOT = path.join(__dirname, '..', 'src');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const overlaySrc = read('renderer', 'overlay', 'overlay.js');
const overlayCss = read('renderer', 'overlay', 'overlay.css');
const html = read('renderer', 'main-window', 'index.html');
const rendererSrc = read('renderer', 'main-window', 'main-window.js');
const preloadSrc = read('preload', 'preload-main.js');
const mainSrc = read('main', 'main.js');
const managerSrc = read('main', 'widgetManager.js');

function loadLinger() {
  const track = overlaySrc.match(/function trackExpiredLinger\(realVisible, keyFn, lingerMs\) \{[\s\S]*?\n\}/);
  const clear = overlaySrc.match(/function clearExpiredLinger\(\) \{[\s\S]*?\n\}/);
  assert.ok(track && clear, 'trackExpiredLinger / clearExpiredLinger have been restructured');
  // eslint-disable-next-line no-new-func
  return new Function(
    `const expiredLinger = new Map();
     let prevRealByKey = new Map();
     let lingerRerenderTimer = null;
     ${track[0]}
     ${clear[0]}
     return {
       track: trackExpiredLinger,
       clear: clearExpiredLinger,
       size: () => expiredLinger.size,
       keys: () => [...expiredLinger.keys()],
     };`
  )();
}

const key = (b) => b.name.toLowerCase();
const buff = (name, durationSec, extra) => ({ name, durationSec, remainingSec: durationSec, ...extra });

test('a buff that just vanished starts lingering; it clears once its time is up', () => {
  const L = loadLinger();
  const spuma = buff('Spirit of the Puma', 60);
  L.track([spuma], key, 3000); // first render - it is present
  let r = L.track([], key, 3000); // now gone
  assert.deepEqual(L.keys(), ['spirit of the puma']);
  assert.equal(r.lingers.length, 1);
  assert.equal(r.lingers[0]._expired, true);
  assert.ok(Number.isFinite(r.soonest));

  // ...still lingering a moment later...
  r = L.track([], key, 3000);
  assert.equal(L.size(), 1);
});

test('a linger whose deadline has already passed is pruned, not shown', () => {
  const L = loadLinger();
  L.track([buff('Haste', 60)], key, 3000);
  // lingerMs 0 -> until == now -> the same call prunes it on its cleanup pass
  const r = L.track([], key, 0);
  assert.equal(r.lingers.length, 0);
  assert.equal(L.size(), 0);
  assert.equal(r.soonest, Infinity);
});

test('the linger clears the instant the buff comes back', () => {
  const L = loadLinger();
  const clar = buff('Clarity', 100);
  L.track([clar], key, 5000);
  L.track([], key, 5000);
  assert.equal(L.size(), 1);
  const r = L.track([clar], key, 5000); // recast
  assert.equal(L.size(), 0);
  assert.equal(r.lingers.length, 0);
});

test('an infinite buff, a damage row and a zero-duration entry never linger', () => {
  const L = loadLinger();
  const set = [
    buff('Yaulp', null, { infinite: true }),
    buff('Attacker', 0, { valueText: '1.2M' }),
    buff('Blip', 0),
  ];
  L.track(set, key, 3000);
  const r = L.track([], key, 3000);
  assert.equal(r.lingers.length, 0);
  assert.equal(L.size(), 0);
});

test('clearExpiredLinger wipes everything', () => {
  const L = loadLinger();
  L.track([buff('X', 10)], key, 3000);
  L.track([], key, 3000);
  assert.equal(L.size(), 1);
  L.clear();
  assert.equal(L.size(), 0);
});

test('expiredLingerSec is clamped 0..6, default 0', () => {
  const raw = [
    { id: 'a', name: 'A', kind: 'self-buffs-builtin' },
    { id: 'b', name: 'B', kind: 'self-buffs-builtin', expiredLingerSec: 3 },
    { id: 'c', name: 'C', kind: 'self-buffs-builtin', expiredLingerSec: 99 },
    { id: 'd', name: 'D', kind: 'self-buffs-builtin', expiredLingerSec: -4 },
  ];
  const store = new WidgetStore({
    loadJson: (k) => (k === 'widgets' ? { version: 99, widgets: JSON.parse(JSON.stringify(raw)) } : null),
    saveJson: () => {},
  });
  const by = Object.fromEntries(store.getAll().map((w) => [w.id, w.expiredLingerSec]));
  assert.equal(by.a, 0);
  assert.equal(by.b, 3);
  assert.equal(by.c, 6);
  assert.equal(by.d, 0);
});

test('wired end to end, for both tile and list mode', () => {
  assert.match(html, /id="widget-expired-linger-slider"/);
  assert.match(rendererSrc, /setWidgetExpiredLingerSec\(selectedId, seconds\)/);
  assert.match(preloadSrc, /setWidgetExpiredLingerSec: \(id, seconds\) =>/);
  assert.match(mainSrc, /widget:setExpiredLingerSec/);
  assert.match(managerSrc, /function setExpiredLingerSec\(id, seconds\)/);
  assert.match(overlayCss, /\.buff-tile\.expired-linger/);
  assert.match(overlayCss, /\.buff-row\.expired-linger/, 'list rows get the linger styling too');
  // render() lingers in tile AND list mode (anything that draws a countdown), never during a preview
  assert.match(overlaySrc, /const lingerSec = !isText && !showingPreviewSample \? currentConfig\.expiredLingerSec \|\| 0 : 0;/);
  // list rows: the countdown bar is emptied so no sliver sits under the greyed row
  assert.match(overlaySrc, /if \(ref\.barEl\) ref\.barEl\.style\.width = '0%';/);
  // the sound / "genuinely expired" sets still work off the real visible list, not tileBuffs
  assert.match(overlaySrc, /const visibleSet = new Set\(visible\.flatMap\(memberKeys\)\);/);
  assert.match(overlaySrc, /checkSoundWarnings\(visible\);/);
  // updateRef bails early for a linger tile and never marks it .low
  assert.match(overlaySrc, /if \(buff\._expired\) \{[\s\S]*?classList\.remove\('low'/);
});

module.exports = () => report('expired-linger');
if (require.main === module) report('expired-linger').then((n) => process.exit(n ? 1 : 0));
