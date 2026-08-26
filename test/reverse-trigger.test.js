'use strict';
/**
 * Reverse detection (widget.reverseDetection) - backlog's "negative/reverse triggers": show a
 * tile while the trigger has NOT happened, hide it for durationSec once it has.
 *
 * WHOLE-AURA, not per-trigger - Shara's own correction: "reverse should not be in each individual
 * trigger, it should be a global functionality of an aura, so that you can set 2 AND triggers
 * without having to mess with both triggers separately." The checkbox lives next to "+ Add
 * trigger", not inside any one trigger's own edit modal, and it rides on whatever
 * triggerCombineMode already decides "fires" for the widget - independent (each trigger its own
 * default-visible tile), AND (one combo tile, stays on until every trigger in the set has been
 * seen), OR (one combo tile, goes off the moment any one trigger fires).
 *
 * See customTimerEngine.js's own header comment above the class for the full design: the
 * default-visible state is never written to activeTimers, only synthesized live by getActive() for
 * any reverse-mode key not currently "hiding" - the same live-computation reasoning as
 * overlay.js's alwaysOnEntry() and BuffEngine's live icon lookups. activeTimers only ever holds a
 * reverse-mode key while phase:'hidden', which behaves and expires exactly like an ordinary
 * phase:'duration' entry.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const TS = '[Wed Aug 19 19:23:03 2026] ';

function setup() {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const widget = store.create('Test', { buffSource: 'customTimer' });
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer); // no wall clock - these tests drive time themselves
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  return { store, widget, engine, log };
}

test('reverseDetection off (the default) leaves an ordinary trigger untouched', () => {
  const { store, widget, engine } = setup();
  store.addCustomTimer(widget.id, { name: 'Ordinary', durationSec: 20, triggerText: 'go' });
  assert.equal(engine.getActive().length, 0, 'an ordinary timer must not be synthesized as visible by default');
  engine.handleLine(`${TS}go`);
  assert.equal(engine.getActive().length, 1);
  assert.equal(engine.getActive()[0].phase, 'duration');
});

test('independent mode: an aura-wide reverseDetection flips each trigger\'s own default state', () => {
  const { store, widget, engine } = setup();
  store.setReverseDetection(widget.id, true);
  store.addCustomTimer(widget.id, { name: 'Not Buffed', durationSec: 20, triggerText: 'go' });
  const active = engine.getActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].name, 'Not Buffed');
  assert.equal(active[0].phase, 'shown');
  assert.equal(active[0].infinite, true);
  assert.equal(active[0].remainingSec, null);
});

test('independent mode: the trigger firing hides the tile instead of showing it', () => {
  const { store, widget, engine, log } = setup();
  store.setReverseDetection(widget.id, true);
  store.addCustomTimer(widget.id, { name: 'Not Buffed', durationSec: 20, triggerText: 'go' });
  engine.handleLine(`${TS}go`);
  assert.equal(engine.getActive().length, 0, 'the tile should be hidden the instant the trigger fires');
  assert.ok(log.some((l) => l.includes('FIRED') && l.includes('reverse trigger') && l.includes('hiding for 20s')));
});

test('independent mode: the tile reappears on its own once the hide window elapses', () => {
  const { store, widget, engine, log } = setup();
  store.setReverseDetection(widget.id, true);
  store.addCustomTimer(widget.id, { name: 'Not Buffed', durationSec: 20, triggerText: 'go' });
  engine.handleLine(`${TS}go`);
  assert.equal(engine.getActive().length, 0);

  const [entry] = [...engine.activeTimers.values()];
  entry.expiresAt = Date.now() - 1000;
  log.length = 0;
  engine._tick();

  assert.ok(log.some((l) => l.includes('ENDED') && l.includes('visible again')));
  const active = engine.getActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].phase, 'shown');
});

test('independent mode with two triggers: each has its own default-visible tile and its own hide', () => {
  const { store, widget, engine } = setup();
  store.setReverseDetection(widget.id, true);
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 20, triggerText: 'go' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 20, triggerText: 'stop' });
  assert.equal(engine.getActive().length, 2, 'both should be visible with nothing triggered yet');

  engine.handleLine(`${TS}go`);
  const active = engine.getActive();
  assert.equal(active.length, 1, 'only the one that fired should hide');
  assert.equal(active[0].name, 'B');
});

test('AND mode: this is the motivating case - stays on until BOTH triggers have fired, then hides as one tile', () => {
  const { store, widget, engine, log } = setup();
  store.setReverseDetection(widget.id, true);
  store.setTriggerCombineMode(widget.id, 'and');
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 20, triggerText: 'go' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 20, triggerText: 'stop' });

  // Visible from the start - neither trigger has fired yet.
  let active = engine.getActive();
  assert.equal(active.length, 1, 'AND mode should show exactly one combo tile, not one per trigger');
  assert.equal(active[0].phase, 'shown');

  // One of the two triggers alone must not hide it.
  engine.handleLine(`${TS}go`);
  assert.equal(engine.getActive().length, 1, 'seeing only one of the two triggers should not hide the combo tile');
  assert.equal(engine.getActive()[0].phase, 'shown');

  // The second trigger completes the set - now it hides.
  engine.handleLine(`${TS}stop`);
  assert.equal(engine.getActive().length, 0, 'both triggers have now fired - the combo tile should hide');
  assert.ok(log.some((l) => l.includes('FIRED') && l.includes('reverse trigger')));
});

test('OR mode: goes off the moment either trigger fires, as one shared tile', () => {
  const { store, widget, engine } = setup();
  store.setReverseDetection(widget.id, true);
  store.setTriggerCombineMode(widget.id, 'or');
  store.addCustomTimer(widget.id, { name: 'A', durationSec: 20, triggerText: 'go' });
  store.addCustomTimer(widget.id, { name: 'B', durationSec: 20, triggerText: 'stop' });

  assert.equal(engine.getActive().length, 1);
  engine.handleLine(`${TS}go`);
  assert.equal(engine.getActive().length, 0, 'either trigger alone should hide an OR combo tile');
});

test('restoring a snapshot mid-hide keeps the tile hidden until its real expiry, same as any timer', () => {
  const { store, widget, engine } = setup();
  store.setReverseDetection(widget.id, true);
  store.addCustomTimer(widget.id, { name: 'Not Buffed', durationSec: 20, triggerText: 'go' });
  engine.handleLine(`${TS}go`);
  const snapshot = engine.getSnapshotState();

  const fresh = new CustomTimerEngine();
  fresh.setGetWidgetsFn(() => store.getAll());
  clearInterval(fresh.tickTimer);
  fresh.restoreSnapshot(snapshot);
  assert.equal(fresh.getActive().length, 0, 'a restored hide should still be hiding, not showing the default-visible tile');
});

module.exports = () => report('reverse-trigger');
if (require.main === module) report('reverse-trigger').then((n) => process.exit(n ? 1 : 0));
