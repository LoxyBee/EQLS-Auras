'use strict';
/**
 * Zone change as a custom-timer trigger type ('zoneEnter'/'zoneLeave') - distinct from the
 * existing "Only in" zone-gating (widgetStore.js's visibleInZones), which is persistent whole-aura
 * visibility. This is a momentary, one-shot event with its own duration: the instant the player
 * enters or leaves a picked zone, a timer starts for the aura's own triggerDurationSec, same as
 * any other custom trigger.
 *
 * customTimerEngine keeps its own currentZone (mirrors widgetManager's separate copy, kept apart
 * for the same DI reasoning as everywhere else in this engine - no Electron pulled in for a plain
 * Node test). Never backfilled from history, so the very first zone change ever seen can only fire
 * an "entering" trigger - there is nothing to have genuinely left yet.
 *
 * Driven through the real CustomTimerEngine with a fake store and synthetic log lines. No Electron.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

function setup() {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const widget = store.create('Test', { buffSource: 'customTimer' });
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer);
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  return { store, widget, engine, log };
}

const enterLine = (zone) => `[Wed Aug 19 19:23:03 2026] You have entered ${zone}.`;

test('entering the picked zone fires the timer', () => {
  const { store, widget, engine } = setup();
  store.addCustomTimer(widget.id, { name: 'In Karana', durationSec: 20, triggerText: 'West Karana', triggerMatch: 'zoneEnter' });
  engine.handleLine(enterLine('West Karana'));
  const active = engine.getActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].name, 'In Karana');
});

test('entering a DIFFERENT zone does not fire it', () => {
  const { store, widget, engine } = setup();
  store.addCustomTimer(widget.id, { name: 'In Karana', durationSec: 20, triggerText: 'West Karana', triggerMatch: 'zoneEnter' });
  engine.handleLine(enterLine('East Karana'));
  assert.equal(engine.getActive().length, 0);
});

test('leaving the picked zone fires the timer, using the zone left behind not the zone arrived in', () => {
  const { store, widget, engine } = setup();
  store.addCustomTimer(widget.id, { name: 'Left Karana', durationSec: 20, triggerText: 'West Karana', triggerMatch: 'zoneLeave' });
  engine.handleLine(enterLine('West Karana')); // establishes currentZone - nothing to leave yet
  assert.equal(engine.getActive().length, 0, 'entering does not fire a leave-mode trigger');
  engine.handleLine(enterLine('East Karana')); // now actually leaving West Karana
  assert.equal(engine.getActive().length, 1);
});

test('the very first zone change ever seen cannot fire a leave-mode trigger', () => {
  const { store, widget, engine } = setup();
  store.addCustomTimer(widget.id, { name: 'Left Karana', durationSec: 20, triggerText: 'West Karana', triggerMatch: 'zoneLeave' });
  // The player was already in West Karana when the app launched - the app never replays history,
  // so it has no way to know that, and must not guess.
  engine.handleLine(enterLine('East Karana'));
  assert.equal(engine.getActive().length, 0, 'nothing was ever tracked as being left');
});

test('a line naming a zone that never changes anything (same zone twice) does not re-fire', () => {
  const { store, widget, engine } = setup();
  store.addCustomTimer(widget.id, { name: 'In Karana', durationSec: 20, triggerText: 'West Karana', triggerMatch: 'zoneEnter' });
  engine.handleLine(enterLine('West Karana'));
  const [entry] = [...engine.activeTimers.values()];
  const firstExpiry = entry.expiresAt;
  // A duplicate "You have entered West Karana." with the same current zone already set - not a
  // real transition, so nothing should re-arm.
  engine.handleLine(enterLine('West Karana'));
  const [again] = [...engine.activeTimers.values()];
  assert.equal(again.expiresAt, firstExpiry, 'a non-transition line should not have restarted the timer');
});

test('an ordinary chat line naming a zone is not mistaken for a zone change', () => {
  const { store, widget, engine } = setup();
  store.addCustomTimer(widget.id, { name: 'In Karana', durationSec: 20, triggerText: 'West Karana', triggerMatch: 'zoneEnter' });
  engine.handleLine('[Wed Aug 19 19:23:03 2026] Someone tells the guild, \'meet me in West Karana\'');
  assert.equal(engine.getActive().length, 0);
});

test('works alongside an ordinary trigger on the same line without interference', () => {
  const { store, widget, engine } = setup();
  store.addCustomTimer(widget.id, { name: 'In Karana', durationSec: 20, triggerText: 'West Karana', triggerMatch: 'zoneEnter' });
  store.addCustomTimer(widget.id, { name: 'Unrelated', durationSec: 20, triggerText: 'go' });
  engine.handleLine(enterLine('West Karana'));
  assert.equal(engine.getActive().length, 1);
  engine.handleLine('[Wed Aug 19 19:23:04 2026] go');
  assert.equal(engine.getActive().length, 2);
});

module.exports = () => report('zone-trigger');
if (require.main === module) process.exit(report('zone-trigger') ? 1 : 0);
