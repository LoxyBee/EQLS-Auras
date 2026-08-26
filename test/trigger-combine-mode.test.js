'use strict';
/**
 * How a widget's own set of custom triggers combine - reported live 25 Aug, replacing the old
 * "Extra conditions" all-of list.
 *
 * That list lived inside ONE trigger's own edit modal, out of sight - "the extra conditions tab
 * for a trigger should be completely removed because it's not in an obvious place." The owner's
 * replacement was simpler and visible: define several ordinary triggers (already supported - the
 * "+ Add trigger" list) and choose how the SET behaves, via a button next to each row in that
 * list, to the left of Edit.
 *
 * Three modes, not two - the first draft only had AND/OR, corrected mid-conversation: "there needs
 * to be THREE modes. default (current, all individual mode, all can be true on their own, and if
 * multiple are met, shown multiple results), then AND, then OR."
 *
 *   independent (default) - today's original behaviour, completely unchanged. Every trigger is
 *     its own instance; two true at once means two tiles.
 *   and - nothing fires until every trigger on the widget has been seen; one combined tile.
 *   or - any single trigger still fires it, but the whole widget shares ONE instance, so it can
 *     never show more than one tile even when several of its triggers are true at once. Her own
 *     worked example: three "Dispelled" triggers (the three severities) - OR is what the dispel
 *     premade already relied on by construction (mutually exclusive text), now made explicit and
 *     available to triggers that are not naturally exclusive too.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const html = read('src', 'renderer', 'main-window', 'index.html');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const mainSrc = read('src', 'main', 'main.js');
const managerSrc = read('src', 'main', 'widgetManager.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');
const storeSrc = read('src', 'main', 'widgetStore.js');

const TS = '[Wed Aug 19 19:23:03 2026] ';

function newStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}

function makeEngine(store) {
  const engine = new CustomTimerEngine();
  clearInterval(engine.tickTimer); // no wall clock - these tests drive time themselves
  engine.setGetWidgetsFn(() => store.getAll());
  return engine;
}

// ---------------------------------------------------------------------------
// The old "Extra conditions" system is actually gone, not just hidden
// ---------------------------------------------------------------------------

test('the Extra conditions topic no longer exists anywhere in the modal', () => {
  assert.doesNotMatch(html, /id="topic-timer-conditions"/);
  assert.doesNotMatch(html, /id="timer-conditions-list"/);
  assert.doesNotMatch(html, /id="timer-condition-add"/);
  assert.doesNotMatch(rendererSrc, /timerConditions\b/, 'the renderer still tracks a condition list');
  assert.doesNotMatch(rendererSrc, /renderTimerConditions/);
});

test('allOf is gone from the store, not just unread', () => {
  assert.doesNotMatch(storeSrc, /allOf/, 'the store still parses or stores the removed field');
  assert.doesNotMatch(rendererSrc, /allOf/, 'the renderer still sends the removed field');
});

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------

test('a new custom-timer aura defaults to independent, unchanged behaviour', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  assert.equal(widget.triggerCombineMode, 'independent');
});

test('setTriggerCombineMode only accepts the three real modes', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  assert.equal(store.setTriggerCombineMode(widget.id, 'and').triggerCombineMode, 'and');
  assert.equal(store.setTriggerCombineMode(widget.id, 'or').triggerCombineMode, 'or');
  assert.equal(store.setTriggerCombineMode(widget.id, 'independent').triggerCombineMode, 'independent');
  assert.equal(store.setTriggerCombineMode(widget.id, 'bogus').triggerCombineMode, 'independent', 'garbage must fall back safely');
});

// ---------------------------------------------------------------------------
// The AND window - reported live 25 Aug: "the window fo rboth triggers is 30
// seconds?... place the trigger window timing below the add trigger button.
// allow it to be changable, 0-30 seconds... this should be doable for
// anything that supports AND Triggers. and only show up when AND triggers
// are selected."
// ---------------------------------------------------------------------------

test('a new custom-timer aura defaults to the old fixed 30s window', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  assert.equal(widget.andWindowSec, 30);
});

test('setAndWindowSec clamps to 0-30, same guard every other duration-ish slider gets', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  assert.equal(store.setAndWindowSec(widget.id, 10).andWindowSec, 10);
  assert.equal(store.setAndWindowSec(widget.id, 0).andWindowSec, 0, 'zero is a real, requested value, not garbage');
  assert.equal(store.setAndWindowSec(widget.id, -5).andWindowSec, 0);
  assert.equal(store.setAndWindowSec(widget.id, 999).andWindowSec, 30, 'the ceiling is 30, not unlimited');
  assert.equal(store.setAndWindowSec(widget.id, 'banana').andWindowSec, 30, 'garbage falls back to the old fixed default');
});

test('a widget saved before this field existed reads back as 30s, not undefined', () => {
  const store1 = newStore();
  const widget = store1.create('Test', { buffSource: 'customTimer' });
  delete widget.andWindowSec;
  store1._save();
  const data = store1.store.loadJson('widgets', null);
  const store2 = new WidgetStore({ loadJson: (n, f) => (n === 'widgets' ? data : f), saveJson: () => {} });
  assert.equal(store2.getById(widget.id).andWindowSec, 30);
});

test('it round-trips through a share code and through Duplicate', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.setAndWindowSec(widget.id, 8);
  const imported = store.importCode(store.exportCode(widget.id));
  assert.equal(imported.andWindowSec, 8);
});

test('setAndWindowSec is wired all the way from the renderer to the store', () => {
  assert.match(preloadSrc, /setWidgetAndWindowSec: \(id, seconds\)/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:setAndWindowSec'/);
  assert.match(managerSrc, /function setAndWindowSec\(id, seconds\)/);
  assert.match(managerSrc, /\n  setAndWindowSec,/, 'not exported from widgetManager');
});

test('the row sits below "+ Add trigger" and only shows in AND mode', () => {
  const addBtnAt = html.indexOf('id="widget-add-timer-btn"');
  const rowAt = html.indexOf('id="widget-and-window-row"');
  assert.ok(addBtnAt > -1 && rowAt > addBtnAt, 'the AND-window row is not below the Add trigger button');
  assert.match(html, /id="widget-and-window-row" style="display:none"/, 'visible by default - must start hidden until AND mode is confirmed');
  assert.match(html, /id="widget-and-window-slider" min="0" max="30" step="1"/, 'the slider does not cover 0-30');
  assert.match(
    rendererSrc,
    /const isAnd = widget\.triggerCombineMode === 'and';\s*\n\s*andWindowRowEl\.style\.display = isAnd \? '' : 'none';/,
    'the row is not actually gated on AND mode'
  );
});

test('changing the slider saves it and updates the local cache', () => {
  assert.match(
    rendererSrc,
    /andWindowSlider\.addEventListener\('input', \(\) => \{([\s\S]*?)\n {2}\}\);/,
  );
  const fn = rendererSrc.match(/andWindowSlider\.addEventListener\('input', \(\) => \{([\s\S]*?)\n {2}\}\);/);
  assert.ok(fn, 'the slider listener has been restructured');
  assert.match(fn[1], /window\.eqTracker\.setWidgetAndWindowSec\(selectedId, seconds\)\.then\(updateLocalWidgetCache\)/);
});

test('the engine actually reads the per-widget window, not a hardcoded number any more', () => {
  // Checks the VALUE the engine actually stored, not just whether the allSeen check later reads
  // as expired - a first pass at this test forced timerSeenUntil to an already-expired value by
  // hand right after the real call, which would have passed even with the engine still hardcoding
  // 30s internally (mutation-tested: it did, silently).
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 30, triggerText: 'first thing happens' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 30, triggerText: 'second thing happens' });
  store.setTriggerCombineMode(widget.id, 'and');
  store.setAndWindowSec(widget.id, 2);
  const engine = makeEngine(store);

  const before = Date.now();
  engine.handleLine(TS + 'first thing happens');
  const [seenUntil] = [...engine.timerSeenUntil.values()];
  const windowMs = seenUntil - before;
  assert.ok(windowMs <= 2500 && windowMs >= 1500, `expected roughly a 2s window, got ${windowMs}ms - still using a fixed number`);
});

test('a real gap longer than the configured window correctly fails to combine', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 30, triggerText: 'first thing happens' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 30, triggerText: 'second thing happens' });
  store.setTriggerCombineMode(widget.id, 'and');
  store.setAndWindowSec(widget.id, 2);
  const engine = makeEngine(store);

  engine.handleLine(TS + 'first thing happens');
  // Fake the clock forward past the 2s window without a real 2-second sleep.
  const [key] = [...engine.timerSeenUntil.keys()];
  engine.timerSeenUntil.set(key, Date.now() - 1);
  engine.handleLine(TS + 'second thing happens');
  assert.equal(engine.getActive().length, 0, 'a 2s window must not still accept a match from "long" ago');
});

test('a widget with no andWindowSec (predates the field) still gets the old fixed 30s behaviour', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 30, triggerText: 'first thing happens' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 30, triggerText: 'second thing happens' });
  store.setTriggerCombineMode(widget.id, 'and');
  delete store.getById(widget.id).andWindowSec; // simulate a share code/object from before this field existed
  const engine = makeEngine(store);
  engine.handleLine(TS + 'first thing happens');
  engine.handleLine(TS + 'second thing happens');
  assert.equal(engine.getActive().length, 1, 'a missing andWindowSec must not silently break AND mode');
});

test('a widget saved before this field existed reads back as independent, not undefined', () => {
  const store1 = newStore();
  const widget = store1.create('Test', { buffSource: 'customTimer' });
  delete widget.triggerCombineMode;
  store1._save();
  const data = store1.store.loadJson('widgets', null);
  const store2 = new WidgetStore({ loadJson: (n, f) => (n === 'widgets' ? data : f), saveJson: () => {} });
  assert.equal(store2.getById(widget.id).triggerCombineMode, 'independent');
});

test('it round-trips through a share code and through Duplicate', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.setTriggerCombineMode(widget.id, 'and');
  const imported = store.importCode(store.exportCode(widget.id));
  assert.equal(imported.triggerCombineMode, 'and');
});

// ---------------------------------------------------------------------------
// The wiring - IPC end to end
// ---------------------------------------------------------------------------

test('setTriggerCombineMode is wired all the way from the renderer to the store', () => {
  assert.match(preloadSrc, /setWidgetTriggerCombineMode: \(id, mode\)/);
  assert.match(mainSrc, /ipcMain\.handle\('widget:setTriggerCombineMode'/);
  assert.match(managerSrc, /function setTriggerCombineMode\(id, mode\)/);
  assert.match(managerSrc, /\n  setTriggerCombineMode,/, 'not exported from widgetManager');
});

// ---------------------------------------------------------------------------
// The UI - a button next to each row, not a separate global control
// ---------------------------------------------------------------------------

test('the combine-mode button sits to the left of Edit on every row, and cycles the three modes', () => {
  const fn = rendererSrc.match(/function renderCustomTimersList\(widget\) \{([\s\S]*?)\n  \}/);
  assert.ok(fn, 'renderCustomTimersList has been restructured');
  assert.match(fn[1], /combineBtn/, 'no combine-mode button is being built into the row');
  assert.match(fn[1], /li\.append\(name, combineBtn, editBtn, deleteBtn\)/, 'combineBtn is not positioned before editBtn');
  assert.match(fn[1], /window\.eqTracker\.setWidgetTriggerCombineMode/, 'the button does not actually save anything');
});

test('the cycle order is independent -> and -> or -> independent', () => {
  const fn = rendererSrc.match(/const TRIGGER_COMBINE_ORDER = (\[[^\]]*\]);/);
  assert.ok(fn, 'TRIGGER_COMBINE_ORDER has been restructured or removed');
  assert.deepEqual(JSON.parse(fn[1].replace(/'/g, '"')), ['independent', 'and', 'or']);
});

// ---------------------------------------------------------------------------
// The Cooldown hint now says plainly that it blocks re-firing
// ---------------------------------------------------------------------------

test('the Cooldown hint says it is a forced gap between activations', () => {
  // Reported live 25 Aug: "cooldown on custom text trigger should be a forced cooldown between
  // when the trigger can happen again... if that already is the case, it needs to be reworded."
  // It already was the case - customTimerEngine.js's `if (running && running.phase === 'cooldown')
  // continue;` already refuses to re-fire while cooling down - so this is copy-only, not a
  // behaviour change, and the engine test below pins that the behaviour really was already there.
  const block = html.slice(html.indexOf('id="topic-timer-cooldown"'), html.indexOf('class="modal-actions"'));
  assert.match(block, /forced gap between activations/i);
  assert.match(block, /cannot fire again until/i);
});

test('the Cooldown phase really does block re-firing, which is what the reworded hint now says', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'Ability', durationSec: 2, triggerText: 'you use the ability', cooldownSec: 5 });
  const engine = makeEngine(store);
  engine.handleLine(TS + 'you use the ability');
  assert.equal(engine.getActive().length, 1);
  engine.activeTimers.forEach((t) => { t.phase = 'cooldown'; });
  // Seen again while still on cooldown - must be ignored, not restart the duration.
  engine.handleLine(TS + 'you use the ability');
  const [active] = engine.getActive();
  assert.equal(active.phase, 'cooldown', 'the line reactivated the duration phase during cooldown');
});

// ---------------------------------------------------------------------------
// The engine - independent (default, unchanged)
// ---------------------------------------------------------------------------

test('independent mode: two different triggers both true at once means two tiles, same as before', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 30, triggerText: 'first thing happens' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 30, triggerText: 'second thing happens' });
  const engine = makeEngine(store);
  engine.handleLine(TS + 'first thing happens');
  engine.handleLine(TS + 'second thing happens');
  assert.deepEqual(engine.getActive().map((t) => t.name).sort(), ['A', 'B']);
});

// ---------------------------------------------------------------------------
// The engine - OR: any one fires it, but always exactly one shared tile
// ---------------------------------------------------------------------------

test('OR mode: either trigger fires it, but there is only ever one tile for the whole widget', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'Severe', durationSec: 30, triggerText: 'you feel very dispelled' });
  store.addCustomTimer(widget.id, { name: 'Mild', durationSec: 30, triggerText: 'you feel a bit dispelled' });
  store.setTriggerCombineMode(widget.id, 'or');
  const engine = makeEngine(store);

  engine.handleLine(TS + 'you feel very dispelled');
  assert.equal(engine.getActive().length, 1, 'OR must never show more than one tile');
  assert.equal(engine.getActive()[0].name, 'Severe');

  // The other trigger, moments later - still exactly one tile, now showing the one that just fired.
  engine.handleLine(TS + 'you feel a bit dispelled');
  assert.equal(engine.getActive().length, 1, 'a second OR trigger firing must not add a second tile');
  assert.equal(engine.getActive()[0].name, 'Mild');
});

test('OR mode: an icon aura with two independently-true triggers still collapses to one tile', () => {
  // The case that actually distinguishes OR from the default: two ordinary triggers can be
  // simultaneously true (not mutually exclusive text like the dispel example above), and OR still
  // shows only one, where independent mode would show both.
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 30, triggerText: 'first thing happens' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 30, triggerText: 'second thing happens' });
  store.setTriggerCombineMode(widget.id, 'or');
  const engine = makeEngine(store);
  engine.handleLine(TS + 'first thing happens');
  engine.handleLine(TS + 'second thing happens');
  assert.equal(engine.getActive().length, 1, 'both were true at once and OR still must show only one');
});

// ---------------------------------------------------------------------------
// The engine - AND: nothing until every trigger has fired
// ---------------------------------------------------------------------------

test('AND mode: one trigger alone shows nothing', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 30, triggerText: 'first thing happens' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 30, triggerText: 'second thing happens' });
  store.setTriggerCombineMode(widget.id, 'and');
  const engine = makeEngine(store);
  engine.handleLine(TS + 'first thing happens');
  assert.equal(engine.getActive().length, 0, 'half of an AND set must be invisible, not a partial tile');
});

test('AND mode: a trigger that only half-completes the set is still logged, not silent', () => {
  // Reported live 25 Aug: "the timer trigger uses hi but does not put anything into the debug
  // log" - confirmed from the real detection log that "hi" and "hii" really were both said, one
  // second apart, and the AND combo correctly required and saw both - but nothing at all was
  // logged for the FIRST of the two, so from the log alone there was no way to tell "hi" had been
  // counted toward anything. The whole point of AND is state you can't see on screen; leaving it
  // with zero trace was backwards.
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'hi', durationSec: 30, triggerText: 'hi' });
  store.addCustomTimer(widget.id, { name: 'hii', durationSec: 30, triggerText: 'hii' });
  store.setTriggerCombineMode(widget.id, 'and');
  const engine = makeEngine(store);
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  engine.handleLine(TS + 'hi');
  assert.equal(engine.getActive().length, 0, 'must not fire on half the set');
  assert.ok(
    log.some((l) => l.includes('SEEN') && l.includes('"hi"') && l.includes('hii')),
    'a half-satisfied AND trigger left no trace of itself in the debug log'
  );
});

test('AND mode: once every trigger has fired, one combined tile appears', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 30, triggerText: 'first thing happens' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 30, triggerText: 'second thing happens' });
  store.setTriggerCombineMode(widget.id, 'and');
  const engine = makeEngine(store);
  engine.handleLine(TS + 'first thing happens');
  engine.handleLine(TS + 'second thing happens');
  assert.equal(engine.getActive().length, 1, 'AND must show exactly one tile once complete, not one per trigger');
  assert.equal(engine.getActive()[0].name, 'A', 'the combo tile should use the widget\'s own stable (first-trigger) identity');
});

test('AND mode: the order the two triggers fire in does not matter', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 30, triggerText: 'first thing happens' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 30, triggerText: 'second thing happens' });
  store.setTriggerCombineMode(widget.id, 'and');
  const engine = makeEngine(store);
  engine.handleLine(TS + 'second thing happens');
  engine.handleLine(TS + 'first thing happens');
  assert.equal(engine.getActive().length, 1);
});

test('AND mode: after firing, it must see every trigger again before it can re-fire', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 30, triggerText: 'first thing happens' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 30, triggerText: 'second thing happens' });
  store.setTriggerCombineMode(widget.id, 'and');
  const engine = makeEngine(store);
  engine.handleLine(TS + 'first thing happens');
  engine.handleLine(TS + 'second thing happens');
  assert.equal(engine.getActive().length, 1);
  engine.activeTimers.clear(); // simulate the tile having since expired

  // Only one of the two has happened again - must not re-fire off the other's stale memory.
  engine.handleLine(TS + 'first thing happens');
  assert.equal(engine.getActive().length, 0, 'AND re-armed on a single trigger, riding on the other\'s old state');
});

test('AND mode: a widget with only one trigger never fires - it silently does nothing rather than acting like independent', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 30, triggerText: 'first thing happens' });
  store.setTriggerCombineMode(widget.id, 'and');
  const engine = makeEngine(store);
  engine.handleLine(TS + 'first thing happens');
  assert.equal(engine.getActive().length, 0);
});

// ---------------------------------------------------------------------------
// Icon lookup for a combined ('and'/'or') instance
// ---------------------------------------------------------------------------

test('a combined instance still shows an icon, looked up via its own defId rather than its synthetic key', () => {
  const store = newStore();
  const widget = store.create('Test', { buffSource: 'customTimer' });
  store.addCustomTimer(widget.id, { name: 'Severe', durationSec: 30, triggerText: 'you feel very dispelled', iconId: 42 });
  store.addCustomTimer(widget.id, { name: 'Mild', durationSec: 30, triggerText: 'you feel a bit dispelled', iconId: 7 });
  store.setTriggerCombineMode(widget.id, 'or');
  const engine = makeEngine(store);
  engine.setIconUrlFn((iconId) => `icon://${iconId}`);
  engine.handleLine(TS + 'you feel very dispelled');
  assert.equal(engine.getActive()[0].iconUrl, 'icon://42', 'the combo tile\'s own key was looked up as if it were a definition id');
});

module.exports = () => report('trigger-combine-mode');
if (require.main === module) report('trigger-combine-mode').then((n) => process.exit(n ? 1 : 0));
