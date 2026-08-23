'use strict';
/**
 * A custom timer that runs its duration and then rolls into a cooldown - note 10.
 *
 * The note's own summary was right: "much easier than it sounds on the engine side... the cost is
 * the form and the display: if the tile doesn't visibly say which phase it is in, the number on
 * screen is actively misleading." That is the real content of this feature. A cooldown counts down
 * to when you CAN use something; a duration counts down to when you can no longer rely on it.
 * Identical digits, opposite meanings.
 *
 * And the note named its own trap, which was real: handleLine overwrites an active entry whenever
 * the trigger text is seen again. During a COOLDOWN that is wrong twice - the ability is not
 * available, so the line cannot mean it was used, and restarting would hide a cooldown the player
 * is waiting on behind a fresh duration.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const engineSrc = read('src', 'main', 'customTimerEngine.js');
const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const overlayCss = read('src', 'renderer', 'overlay', 'overlay.css');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const mainSrc = read('src', 'main', 'main.js');

const TS = '[Wed Aug 19 19:17:52 2026] ';

function setup(timers) {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const widget = store.create('Test');
  for (const t of timers) store.addCustomTimer(widget.id, t);
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer); // these tests drive time themselves
  return { store, widget, engine };
}

const feed = (e, line) => e.handleLine(TS + line);
const shown = (e) => e.getActive().map((t) => `${t.name}:${t.phase}`);
// Reach past whatever is running rather than waiting real seconds.
const expireNow = (e) => {
  for (const t of e.activeTimers.values()) t.expiresAt = Date.now() - 1;
  e._tick();
};

// ---------------------------------------------------------------------------
// The two phases
// ---------------------------------------------------------------------------

test('a timer with a cooldown rolls from one into the other', () => {
  const { engine } = setup([{ name: 'Harvest', durationSec: 3, triggerText: 'you harvest', cooldownSec: 5 }]);
  feed(engine, 'you harvest');
  assert.deepEqual(shown(engine), ['Harvest:duration']);
  expireNow(engine);
  assert.deepEqual(shown(engine), ['Harvest:cooldown'], 'it ended instead of cooling down');
  expireNow(engine);
  assert.deepEqual(shown(engine), [], 'the cooldown never ends');
});

test('the cooldown counts its own length, not the duration again', () => {
  const { engine } = setup([{ name: 'Harvest', durationSec: 3, triggerText: 'go', cooldownSec: 60 }]);
  feed(engine, 'go');
  assert.equal(engine.getActive()[0].remainingSec, 3);
  expireNow(engine);
  assert.equal(engine.getActive()[0].remainingSec, 60);
});

test('a timer with no cooldown still just ends', () => {
  // Every timer that existed before this feature is one of these.
  const { engine } = setup([{ name: 'Plain', durationSec: 3, triggerText: 'go' }]);
  feed(engine, 'go');
  assert.deepEqual(shown(engine), ['Plain:duration']);
  expireNow(engine);
  assert.deepEqual(shown(engine), []);
});

test('a cooldown cannot roll into another cooldown', () => {
  // The transition is from 'duration' only. Without that a timer with a cooldown would never end.
  const fn = engineSrc.match(/_tick\(\) \{([\s\S]*?)\n {2}\}/);
  assert.ok(fn, '_tick has been restructured');
  assert.match(fn[1], /timer\.phase === 'duration' && timer\.cooldownSec > 0/);
});

// ---------------------------------------------------------------------------
// The trap the note named
// ---------------------------------------------------------------------------

test('the trigger line during a cooldown does NOT restart it', () => {
  // The note's Risk. Seeing the line again cannot mean the ability was used - it is on cooldown.
  // Restarting would replace a countdown the player is waiting on with a fresh duration.
  const { engine } = setup([{ name: 'Harvest', durationSec: 3, triggerText: 'you harvest', cooldownSec: 60 }]);
  feed(engine, 'you harvest');
  expireNow(engine);
  const before = engine.getActive()[0].remainingSec;
  feed(engine, 'you harvest');
  assert.deepEqual(shown(engine), ['Harvest:cooldown'], 'the cooldown was replaced by a new duration');
  assert.ok(engine.getActive()[0].remainingSec <= before, 'the cooldown was restarted');
});

test('the trigger line during the DURATION still restarts it, as before', () => {
  // Only the cooldown phase is protected. A plain re-trigger is the existing behaviour and a lot
  // of timers rely on it.
  const { engine } = setup([{ name: 'Harvest', durationSec: 30, triggerText: 'go', cooldownSec: 60 }]);
  feed(engine, 'go');
  for (const t of engine.activeTimers.values()) t.expiresAt = Date.now() + 5000;
  assert.equal(engine.getActive()[0].remainingSec, 5);
  feed(engine, 'go');
  assert.equal(engine.getActive()[0].remainingSec, 30, 'a re-trigger no longer restarts the duration');
});

// ---------------------------------------------------------------------------
// Saying which phase it is in
// ---------------------------------------------------------------------------

test('the phase reaches the overlay', () => {
  const { engine } = setup([{ name: 'Harvest', durationSec: 3, triggerText: 'go', cooldownSec: 5 }]);
  feed(engine, 'go');
  assert.equal(engine.getActive()[0].phase, 'duration');
  expireNow(engine);
  assert.equal(engine.getActive()[0].phase, 'cooldown');
});

test('the tile looks different while cooling down, and says so in words', () => {
  // The note: "if the tile doesn't visibly say which phase it is in, the number on screen is
  // actively misleading".
  assert.match(overlaySrc, /const cooling = buff\.phase === 'cooldown';/);
  assert.match(overlaySrc, /classList\.toggle\('cooldown-phase', cooling\)/);
  assert.match(overlaySrc, /cooling down, ready in/, 'nothing says in words which phase it is');
  assert.match(overlayCss, /\.cooldown-phase \{/, 'the class is set but never styled');
});

test('the cooldown styling does not collide with the two meanings colour already has', () => {
  // Colour on a tile already means spell category (note 37) and time running out (.low). A third
  // colour meaning would make all three unreadable, so this one is opacity and an outline.
  const block = overlayCss.match(/\.cooldown-phase \{([\s\S]*?)\}/)[1];
  assert.match(block, /opacity/);
  assert.doesNotMatch(block, /(^|[^-])color:/, 'the cooldown phase uses colour, which already means two other things');
  assert.doesNotMatch(block, /background/);
});

// ---------------------------------------------------------------------------
// Setting one up
// ---------------------------------------------------------------------------

test('the field exists and round-trips through the store', () => {
  const { store, widget } = setup([{ name: 'A', durationSec: 10, triggerText: 'go', cooldownSec: 30 }]);
  const t = () => store.getById(widget.id).customTimers[0];
  assert.equal(t().cooldownSec, 30);

  store.updateCustomTimer(widget.id, t().id, { name: 'A', durationSec: 10, triggerText: 'go', cooldownSec: 45 });
  assert.equal(t().cooldownSec, 45, 'editing the cooldown does not stick');

  // Emptying the box sends 0, which removes it rather than leaving the old value behind.
  store.updateCustomTimer(widget.id, t().id, { name: 'A', durationSec: 10, triggerText: 'go', cooldownSec: 0 });
  assert.equal(t().cooldownSec, undefined, 'clearing the box left the old cooldown in place');
});

test('a caller that has never heard of cooldowns does not wipe one', () => {
  // The first version rewrote this field unconditionally, so any code path not yet updated for it
  // silently erased it - the same shape as the castOf bug below. Saying nothing means no change;
  // only an explicit 0 clears.
  const { store, widget } = setup([{ name: 'A', durationSec: 10, triggerText: 'go', cooldownSec: 30 }]);
  const t = () => store.getById(widget.id).customTimers[0];
  store.updateCustomTimer(widget.id, t().id, { name: 'A', durationSec: 10, triggerText: 'go' });
  assert.equal(t().cooldownSec, 30, 'a caller omitting the field wiped it');
});

test('every trigger mode the engine understands survives being stored', () => {
  // A real bug, found by reading rather than by failing: addCustomTimer whitelisted only
  // 'contains', so a castOf timer routed through it was silently downgraded to exact whole-line
  // matching and would never have fired. The cooldown premade escaped only because it writes the
  // timer object directly. A mode missing from that whitelist is a mode that stops working.
  const { store, widget } = setup([]);
  for (const mode of ['contains', 'castOf']) {
    const w = store.addCustomTimer(widget.id, { name: mode, durationSec: 5, triggerText: 't', triggerMatch: mode });
    assert.equal(w.customTimers.at(-1).triggerMatch, mode, `${mode} was dropped on the way in`);
  }
  // And anything unrecognised still becomes plain exact matching rather than a mode that does not
  // exist.
  const w = store.addCustomTimer(widget.id, { name: 'bad', durationSec: 5, triggerText: 't', triggerMatch: 'sideways' });
  assert.equal(w.customTimers.at(-1).triggerMatch, undefined);

  // The whitelist must name every mode the engine branches on.
  const modes = [...engineSrc.matchAll(/timer\.triggerMatch === '([a-zA-Z]+)'/g)].map((m) => m[1]);
  assert.ok(modes.length >= 2, `only found ${modes.length} modes in the engine`);
  const storeSrc = read('src', 'main', 'widgetStore.js');
  const list = storeSrc.match(/const TRIGGER_MATCH_MODES = \[([^\]]*)\]/);
  assert.ok(list, 'TRIGGER_MATCH_MODES has been renamed');
  for (const m of modes) {
    assert.ok(list[1].includes(`'${m}'`), `the engine understands '${m}' but the store discards it`);
  }
});

test('a timer without one stays byte-identical to a pre-feature timer', () => {
  // undefined, not 0 - so nothing already saved changes shape just because the field now exists.
  const { store, widget } = setup([{ name: 'Plain', durationSec: 10, triggerText: 'go' }]);
  const t = store.getById(widget.id).customTimers[0];
  assert.equal(t.cooldownSec, undefined);
  assert.ok(!Object.values(t).includes(0), 'a zero crept in where undefined was meant');
});

test('it is wired from the form all the way to the store', () => {
  // The gap this actually had: the field was in the form, the store and the engine and still did
  // nothing, because the IPC handler destructures named fields and did not list it.
  assert.match(html, /id="widget-new-timer-cooldown"/, 'no field in the form');
  assert.match(rendererSrc, /cooldownSec: Number\(newTimerCooldownInput\.value\) \|\| 0/, 'the form never reads it');
  assert.match(rendererSrc, /newTimerCooldownInput\.value = timer\.cooldownSec \? String\(timer\.cooldownSec\) : ''/,
    'editing a timer does not show its cooldown');
  assert.match(rendererSrc, /newTimerCooldownInput\.value = '';/, 'the form is not cleared between timers');
  const add = mainSrc.match(/'widget:addCustomTimer',([\s\S]*?)\n\);/);
  assert.ok(add && /cooldownSec/.test(add[1]), 'the add handler drops cooldownSec');
  const upd = mainSrc.match(/'widget:updateCustomTimer',([\s\S]*?)\n\);/);
  assert.ok(upd && /cooldownSec/.test(upd[1]), 'the update handler drops cooldownSec');
});

test('a restart does not resurrect a cooldown as a running buff', () => {
  // The note's second Risk. The snapshot is the raw entry, so the phase rides along with it - but
  // only because getSnapshotState returns the entries themselves rather than a rebuilt view.
  const { engine } = setup([{ name: 'Harvest', durationSec: 3, triggerText: 'go', cooldownSec: 60 }]);
  feed(engine, 'go');
  expireNow(engine);
  const snap = engine.getSnapshotState();
  assert.equal(snap.length, 1);
  assert.equal(snap[0].phase, 'cooldown', 'the phase is lost across a restart');
  assert.equal(snap[0].cooldownSec, 60, 'the cooldown length is lost across a restart');
});

module.exports = () => report('cooldown-phase');
if (require.main === module) process.exit(report('cooldown-phase') ? 1 : 0);
