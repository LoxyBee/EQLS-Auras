'use strict';
/**
 * The once-a-second `_tick()` broadcast (customTimerEngine.js) used to be unconditional - it fired
 * `activeChanged` every second, forever, for every registered timer, so that a genuine countdown's
 * on-screen number visibly ticks down. Reported live 15 Sep: a text aura (Charm Broke, Loss of
 * control, You Have Been Dispelled, Loadout label - `displayMode: 'text'`, a flash/message with no
 * ticking number) got swept into the exact same unconditional broadcast, so EVERY aura window
 * redrew itself once a second forever, including with the game closed and nothing active at all -
 * measured contributing to real system-wide disk/CPU lag (a runaway debug log riding along on the
 * same broadcast made it far worse, but the broadcast itself was already the underlying waste).
 *
 * The fix: only broadcast when something REAL changed this tick (an ended timer, a duration ->
 * cooldown transition - never swallowed, whatever aura it belongs to) OR when at least one
 * CURRENTLY ACTIVE timer belongs to a non-text widget, i.e. has a live-ticking number that
 * genuinely needs refreshing. A tick where nothing changed and nothing needs a number on screen is
 * skipped entirely.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const TS = '[Wed Aug 19 19:17:52 2026] ';

function setup(timers, displayMode) {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const widget = store.create('Test');
  if (displayMode) store.update(widget.id, { displayMode });
  for (const t of timers) store.addCustomTimer(widget.id, t);
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer); // these tests drive time themselves
  return { store, widget, engine };
}

const feed = (e, line) => e.handleLine(TS + line);

function countBroadcasts(engine, fn) {
  let n = 0;
  engine.on('activeChanged', () => { n += 1; });
  fn();
  return n;
}

test('a text-mode aura with an active timer does not broadcast on an ordinary tick where nothing changed', () => {
  const { engine } = setup(
    [{ name: 'Charm Broke', durationSec: 5, triggerText: 'spell has worn off of', triggerMatch: 'contains' }],
    'text'
  );
  feed(engine, 'Your Charm spell has worn off of a spite golem.');
  const n = countBroadcasts(engine, () => engine._tick());
  assert.equal(n, 0, 'nothing expired and there is no number to refresh - this tick should be silent');
});

test('an icon/list-mode aura with an active timer DOES broadcast every tick - it has a real number to refresh', () => {
  const { engine } = setup(
    [{ name: 'Harvest', durationSec: 30, triggerText: 'you harvest' }],
    'icons'
  );
  feed(engine, 'you harvest');
  const n = countBroadcasts(engine, () => engine._tick());
  assert.equal(n, 1, 'a genuine countdown must still tick every second, unconditionally');
});

test('a text aura ending is never swallowed, even though text auras are otherwise silent on tick', () => {
  const { engine } = setup(
    [{ name: 'Resist flash', durationSec: 3, triggerText: 'resisted your', triggerMatch: 'contains' }],
    'text'
  );
  feed(engine, 'A shiverback resisted your Envenomed Bolt.');
  for (const t of engine.activeTimers.values()) t.expiresAt = Date.now() - 1; // force real expiry
  const n = countBroadcasts(engine, () => engine._tick());
  assert.equal(n, 1, 'a real ended-timer change must always broadcast, regardless of display mode');
  assert.deepEqual(engine.getActive(), [], 'and the timer is actually gone');
});

test('a duration-to-cooldown phase transition on a text aura still broadcasts (a real change, not a bare tick)', () => {
  const { engine } = setup(
    [{ name: 'Loadout label', durationSec: 3, triggerText: 'you harvest', cooldownSec: 10 }],
    'text'
  );
  feed(engine, 'you harvest');
  for (const t of engine.activeTimers.values()) t.expiresAt = Date.now() - 1;
  const n = countBroadcasts(engine, () => engine._tick());
  assert.equal(n, 1, 'the duration->cooldown transition is a real change and must not be swallowed');
  assert.equal([...engine.activeTimers.values()][0].phase, 'cooldown');
});

test('one real countdown running keeps the tick alive even while a text aura sits alongside it, with no change either way', () => {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const textWidget = store.create('Text');
  store.update(textWidget.id, { displayMode: 'text' });
  store.addCustomTimer(textWidget.id, { name: 'Charm Broke', durationSec: 30, triggerText: 'spell has worn off of', triggerMatch: 'contains' });
  const iconWidget = store.create('Icons');
  store.update(iconWidget.id, { displayMode: 'icons' });
  store.addCustomTimer(iconWidget.id, { name: 'Harvest', durationSec: 30, triggerText: 'you harvest' });

  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer);
  feed(engine, 'Your Charm spell has worn off of a spite golem.');
  feed(engine, 'you harvest');

  const n = countBroadcasts(engine, () => engine._tick());
  assert.equal(n, 1, 'the icon aura still needs its per-second refresh, so the shared tick still fires');
  const names = engine.getActive().map((t) => t.name).sort();
  assert.deepEqual(names, ['Charm Broke', 'Harvest'], 'both auras are still in the one shared broadcast when it does fire');
});

test('with nothing active at all, the tick is silent', () => {
  const { engine } = setup([{ name: 'Harvest', durationSec: 30, triggerText: 'you harvest' }], 'icons');
  const n = countBroadcasts(engine, () => engine._tick());
  assert.equal(n, 0, 'nothing is running and nothing changed - there is nothing to broadcast');
});

module.exports = () => report('custom-timer-tick-broadcast');
if (require.main === module) report('custom-timer-tick-broadcast').then((n) => process.exit(n ? 1 : 0));
