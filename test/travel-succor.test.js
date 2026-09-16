'use strict';
/**
 * Travel guide - "Use Succor spells in routes" toggle (owner, 7 Sep).
 *
 * A druid "Succor: X" group spell evacuates you to a fixed spot in a named zone from anywhere, so
 * the router was offering it as a one-hop shortcut on most routes. Now it is left out of route
 * planning unless a travel aura opts in. Default: off. The routing behaviour itself is covered in
 * zone-routing.test.js; this pins the field + the main -> preload -> renderer wiring.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const { WidgetStore } = require('../src/main/widgetStore');

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

test('a travel guide defaults Succor routing off; a junk stored value coerces to a boolean on load', () => {
  const data = {};
  const io = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const store = new WidgetStore(io);
  const w = store.createTravelGuide('T', { destination: 'Rivervale' });
  assert.equal(new WidgetStore(io).getById(w.id).travelIncludeSuccor, false, 'default is off');

  // update() deliberately does not normalize. Only a literal `true` turns it on - a junk/legacy
  // value coerces to off, which is the safe direction for an opt-in.
  store.update(w.id, { travelIncludeSuccor: 'yes' });
  assert.equal(new WidgetStore(io).getById(w.id).travelIncludeSuccor, false);
  store.update(w.id, { travelIncludeSuccor: true });
  assert.equal(new WidgetStore(io).getById(w.id).travelIncludeSuccor, true);

  const ws = read('src', 'main', 'widgetStore.js');
  assert.match(ws, /'scale',\n\s*'travelIncludeSuccor',\n\s*'visibleInRaid',\n\s*'visibleInGroup',\n\];/);
  assert.match(ws, /travelIncludeSuccor: widget\.travelIncludeSuccor === true,/);
});

test('the route builder passes the aura flag to findRoute', () => {
  assert.match(
    read('src', 'main', 'main.js'),
    /findRoute\(zone, widget\.travelDestination, \{\s*scribedSpells: scribed,\s*includeSuccor: widget\.travelIncludeSuccor === true,\s*\}\)/
  );
});

test('wired main -> preload -> renderer', () => {
  assert.match(read('src', 'main', 'main.js'), /widget:setTravelIncludeSuccor/);
  assert.match(read('src', 'main', 'main.js'), /widgetManager\.setTravelIncludeSuccor\(id, include\)/);
  assert.match(read('src', 'main', 'widgetManager.js'), /function setTravelIncludeSuccor\(id, include\)/);
  assert.match(read('src', 'preload', 'preload-main.js'), /setWidgetTravelIncludeSuccor: \(id, include\)/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="widget-travel-succor-checkbox"/);
  assert.match(read('src', 'renderer', 'main-window', 'main-window.js'), /setWidgetTravelIncludeSuccor\(selectedId, travelSuccorCb\.checked\)/);
});

// Reported live 15 Sep, alongside the customTimerEngine text-aura fix: the 1s heartbeat called
// pushTravelRoutes() unconditionally forever, so every overlay window redrew itself once a second
// whether the route had changed or not - "almost always zero" travel guides per that function's
// own header comment, but every window still paid for it regardless. Deduped the same way
// pushLockoutBoard already was, right above it in main.js.
test('pushTravelRoutes is deduped against its own last broadcast, like pushLockoutBoard beside it', () => {
  const main = read('src', 'main', 'main.js');
  const at = main.indexOf('function pushTravelRoutes()');
  assert.ok(at > -1, 'pushTravelRoutes has been restructured or removed');
  const fn = main.slice(at, main.indexOf('\n}', at) + 2);
  assert.match(fn, /const routes = travelRoutes\(\);/);
  assert.match(fn, /if \(json === lastTravelRoutesJSON\) return;/, 'must skip the broadcast when nothing changed');
  assert.match(fn, /lastTravelRoutesJSON = json;/, 'must remember what it last actually sent');
  assert.match(fn, /broadcast\('travel:routes', routes\);/);
});

module.exports = () => report('travel-succor');
if (require.main === module) report('travel-succor').then((n) => process.exit(n ? 1 : 0));
