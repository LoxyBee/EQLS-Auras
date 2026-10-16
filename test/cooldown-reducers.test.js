'use strict';
/**
 * Cooldown reducers (owner, 16 Oct): "harm touch is lowered by reave, lay on hands by smite".
 * A trigger's `reducers` list - each row a log line (contains, any case) and seconds, 15 by
 * default and adjustable - takes that much off the trigger's running cooldown per matching line.
 *
 * Wording measured from the owner's logs: a melee smite/reave HIT is "You smite <target> for N
 * points of damage." (192 lines) / "You reave ..." (728); a miss is "You try to smite <target>, but
 * miss!" - which "You smite " deliberately does not match.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, sanitizeCustomTimers } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const TS = '[Thu Oct 16 10:00:00 2026] ';

function setup({ reverse = false } = {}) {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const w = store.create('HUD', { buffSource: 'customTimer' });
  store.addCustomTimer(w.id, {
    name: 'Lay on Hands', durationSec: 0, triggerText: 'lay hands', triggerMatch: 'contains', cooldownSec: 600,
    reducers: [{ text: 'You smite ', sec: 15 }],
  });
  store.setTriggerDurationSec(w.id, 0);
  if (reverse) store.setReverseDetection(w.id, true);
  const engine = new CustomTimerEngine();
  clearInterval(engine.tickTimer);
  engine.setGetWidgetsFn(() => store.getAll());
  return { store, w, engine };
}

function at(sec, fn) {
  const realNow = Date.now;
  const t0 = at.t0 || (at.t0 = realNow());
  Date.now = () => t0 + sec * 1000;
  try { return fn(); } finally { Date.now = realNow; }
}

test('each smite HIT takes 15s off the running cooldown; a miss does not', () => {
  at.t0 = Date.now();
  const { engine } = setup();
  at(0, () => engine.handleLine(`${TS}You lay hands on yourself.`));
  at(1, () => engine._tick()); // into the cooldown phase
  const left = () => at(1, () => engine.getActive()[0].remainingSec);
  assert.equal(left(), 600);
  at(1, () => engine.handleLine(`${TS}You smite a skeletal excavator for 24 points of damage.`));
  assert.equal(left(), 585);
  at(1, () => engine.handleLine(`${TS}You try to smite a skeletal excavator, but miss!`));
  assert.equal(left(), 585, 'a miss is not a smite hit');
  at(1, () => engine.handleLine(`${TS}You hit a skeletal excavator for 90 points of magic damage by Smite.`));
  assert.equal(left(), 585, 'the cleric SPELL Smite is a different line');
  at(1, () => engine.handleLine(`${TS}YOU SMITE a gnoll for 3 points of damage.`));
  assert.equal(left(), 570, 'any case');
});

test('it never goes below "ready now" - the tile then ends as usual', () => {
  at.t0 = Date.now();
  const { engine } = setup();
  at(0, () => engine.handleLine(`${TS}lay hands`));
  at(1, () => engine._tick());
  for (let i = 0; i < 50; i += 1) at(1, () => engine.handleLine(`${TS}You smite a rat for 1 points of damage.`));
  at(1, () => engine._tick());
  assert.equal(at(1, () => engine.getActive().length), 0, 'ready - the cooldown tile is gone');
});

test('nothing is taken off while the tile is still in its Duration shown', () => {
  at.t0 = Date.now();
  const { store, w, engine } = setup();
  store.setTriggerDurationSec(w.id, 30);
  at(0, () => engine.handleLine(`${TS}lay hands`));
  at(1, () => engine.handleLine(`${TS}You smite a rat for 1 points of damage.`));
  at(31, () => engine._tick());
  assert.equal(at(31, () => engine.getActive()[0].remainingSec), 600, 'the full cooldown still follows the duration');
});

test('with Reverse detection, a hit brings the ready tile back sooner', () => {
  at.t0 = Date.now();
  const { engine } = setup({ reverse: true });
  at(0, () => engine.handleLine(`${TS}lay hands`));
  assert.equal(at(0, () => engine.getActive().length), 0, 'hidden while cooling down');
  at(0, () => engine.handleLine(`${TS}You smite a rat for 1 points of damage.`));
  at(590, () => engine._tick());
  assert.equal(at(590, () => engine.getActive().length), 1, '600s - 15s: ready again by 590s');
});

test('several reducers each count; seconds default to 15 and are adjustable', () => {
  const [t] = sanitizeCustomTimers([{ id: 'x', reducers: [
    { text: 'You smite ' }, { text: 'You reave ', sec: 30 }, { text: '   ' }, { text: 'big', sec: 99999 }, 'junk',
  ] }]);
  assert.deepEqual(t.reducers, [{ text: 'You smite ', sec: 15 }, { text: 'You reave ', sec: 30 }, { text: 'big', sec: 3600 }]);
  assert.equal(sanitizeCustomTimers([{ id: 'y', reducers: [] }])[0].reducers, undefined, 'an empty list is simply none');
  const store = new WidgetStore({ loadJson: (n, f) => f, saveJson: () => {} });
  const w = store.create('X', { buffSource: 'customTimer' });
  store.addCustomTimer(w.id, { name: 'HT', durationSec: 0, triggerText: 'ht', reducers: [{ text: 'You reave ', sec: 20 }] });
  const timer = store.getById(w.id).customTimers[0];
  store.updateCustomTimer(w.id, timer.id, { ...timer, reducers: [] });
  assert.equal(store.getById(w.id).customTimers[0].reducers, undefined, 'removing every row clears them');
});

test('wiring: both save handlers carry it, the form sends it, and the bench has smite/reave lines', () => {
  const mainSrc = read('src', 'main', 'main.js');
  for (const ch of ['widget:addCustomTimer', 'widget:updateCustomTimer']) {
    const at2 = mainSrc.indexOf(`'${ch}'`);
    const handler = mainSrc.slice(at2, mainSrc.indexOf('\n);', at2));
    assert.equal((handler.match(/reducers/g) || []).length, 2, `${ch}: must both destructure and forward reducers`);
  }
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(renderer, /reducers: readReducers\(\),/);
  assert.match(renderer, /const DEFAULT_REDUCER_SEC = 15;/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="widget-new-timer-reducers"/);
  const { presets } = JSON.parse(read('src', 'shared', 'data', 'test-bench-presets.json'));
  const labels = presets.map((p) => p.label);
  for (const l of ['Smite hit', 'Smite miss', 'Reave hit']) assert.ok(labels.includes(l), l);
});

// ---------------------------------------------------------------------------
// The "Lay on Hands & Harm Touch" premade (owner, 16 Oct: one aura, both triggers)
// ---------------------------------------------------------------------------

test('the premade: two Skill-cast cooldowns with their Smite / Reave reducers and their own icons', () => {
  const store = new WidgetStore({ loadJson: (n, f) => f, saveJson: () => {} });
  const w = store.createLohHtCooldownAura();
  assert.equal(w.buffSource, 'customTimer');
  assert.equal(w.triggerCombineMode, 'independent');
  const byName = Object.fromEntries(w.customTimers.map((t) => [t.name, t]));
  assert.deepEqual(Object.keys(byName), ['Lay on Hands', 'Harm Touch']);
  assert.equal(byName['Lay on Hands'].triggerMatch, 'castOf');
  assert.equal(byName['Lay on Hands'].cooldownSec, 4200);
  assert.deepEqual(byName['Lay on Hands'].reducers, [{ text: 'You smite ', sec: 15 }]);
  assert.equal(byName['Lay on Hands'].iconId, 99);
  assert.equal(byName['Harm Touch'].cooldownSec, 1200);
  assert.deepEqual(byName['Harm Touch'].reducers, [{ text: 'You reave ', sec: 15 }]);
  assert.equal(byName['Harm Touch'].iconId, 161);
  assert.ok(w.customTimers.every((t) => t.durationSec === 0), 'straight into the cooldown');
});

test('a ranked cast of a spell NOT in the roster still matches its Skill-cast trigger', () => {
  // Lay on Hands and Harm Touch are AA abilities, never in the roster. The app's resolver returns
  // null for them; the cast name used to be kept raw ("Harm Touch X"), so the trigger never fired.
  const store = new WidgetStore({ loadJson: (n, f) => f, saveJson: () => {} });
  store.createLohHtCooldownAura();
  const engine = new CustomTimerEngine();
  clearInterval(engine.tickTimer);
  engine.setGetWidgetsFn(() => store.getAll());
  engine.setResolveSpellFn(() => null); // as in the app, for a non-roster spell
  engine.handleLine(`${TS}You begin casting Harm Touch X.`);
  engine.handleLine(`${TS}You begin casting Lay on Hands XVII.`);
  assert.deepEqual(engine.getActive().map((t) => t.name).sort(), ['Harm Touch', 'Lay on Hands']);
  assert.match(read('src', 'renderer', 'main-window', 'main-window.js'), /id: 'loh-ht-cooldowns',/);
});

module.exports = () => report('cooldown-reducers');
if (require.main === module) report('cooldown-reducers').then((n) => process.exit(n ? 1 : 0));
