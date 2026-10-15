'use strict';
/**
 * The "Stance & invocation" premade (owner, 15 Oct) and the trigger option it is built on,
 * "Stay until ended" (a custom trigger's untilEnded flag).
 *
 * Built from ORDINARY custom triggers - one per stance / invocation - so every name, line and icon
 * stays player-editable, with sensible default icons. Each ends on the game's own swap line
 * ("You begin to change your stance." / "...your invocation."), so in plain Independent mode one
 * aura shows at most one stance tile and one invocation tile - the owner's "two icons, each an OR".
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore, sanitizeCustomTimers } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const TS = '[Wed Oct 15 10:00:00 2026] ';

function setup() {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const widget = store.createStanceAura();
  const engine = new CustomTimerEngine();
  clearInterval(engine.tickTimer);
  engine.setGetWidgetsFn(() => store.getAll());
  const names = () => engine.getActive().map((t) => t.name).sort();
  const say = (...lines) => lines.forEach((l) => engine.handleLine(TS + l));
  return { store, widget, engine, names, say };
}

test('the premade is plain editable triggers: every roster stance and invocation, each with an icon', () => {
  const { widget } = setup();
  const roster = JSON.parse(read('src', 'shared', 'data', 'buffs.json')).filter((b) => /^(Stance|Invocation)$/.test(b.category));
  assert.equal(widget.buffSource, 'customTimer');
  assert.equal(widget.triggerCombineMode, 'independent');
  assert.equal(widget.customTimers.length, roster.length);
  for (const r of roster) {
    const t = widget.customTimers.find((x) => x.name === r.name);
    assert.ok(t, `${r.name} is missing`);
    assert.equal(t.triggerText, r.landingText, `${r.name}: must fire on the roster's own landing line`);
    assert.equal(t.untilEnded, true);
    assert.equal(typeof t.iconId, 'number', `${r.name}: needs a default icon`);
    assert.equal(t.endedText, r.category === 'Stance' ? 'You assume a' : 'You begin reciting the');
    assert.ok(r.landingText.includes(t.endedText), `${r.name}: its own group's end line must match every pick in that group`);
  }
});

test('one stance tile and one invocation tile at most - a swap replaces only its own group', () => {
  const { names, say } = setup();
  say('You begin to change your stance.', 'You assume an evasive stance.');
  say('You begin to change your invocation.', 'You begin reciting the divine invocation.');
  assert.deepEqual(names(), ['Divine Invocation', 'Evasive Stance']);
  say('You begin to change your stance.', 'You assume a defensive stance.');
  assert.deepEqual(names(), ['Defensive Stance', 'Divine Invocation']);
  say('You begin to change your invocation.', 'You begin reciting the recovery invocation.');
  assert.deepEqual(names(), ['Defensive Stance', 'Recovery Invocation']);
});

test('"stay until ended" never runs out - after its cooldown it has no countdown at all', () => {
  const { engine, names, say } = setup();
  say('You assume an evasive stance.');
  const realNow = Date.now;
  const later = realNow() + 24 * 3600 * 1000;
  try {
    Date.now = () => later;
    engine._tick();
    assert.deepEqual(names(), ['Evasive Stance'], 'still there a day later');
    const [tile] = engine.getActive();
    assert.equal(tile.remainingSec, null);
    assert.equal(tile.infinite, true);
    assert.equal(tile.untilEnded, true);
  } finally { Date.now = realNow; }
});

test('a stance survives dying (it is a state, not a buff); an ordinary timer still clears', () => {
  const { store, widget, names, say } = setup();
  store.addCustomTimer(widget.id, { name: 'Plain', durationSec: 60, triggerText: 'plain thing' });
  say('You assume an evasive stance.', 'plain thing');
  say('You have been slain by a test dummy!');
  assert.deepEqual(names(), ['Evasive Stance']);
});

test('the flag is stored only when on, cleared by an edit, and sanitised on import', () => {
  const store = new WidgetStore({ loadJson: (n, f) => f, saveJson: () => {} });
  const w = store.create('X', { buffSource: 'customTimer' });
  store.addCustomTimer(w.id, { name: 'A', durationSec: 5, triggerText: 'a', untilEnded: false });
  const t = store.getById(w.id).customTimers[0];
  assert.equal(t.untilEnded, undefined, 'off is not written at all');
  store.updateCustomTimer(w.id, t.id, { ...t, untilEnded: true });
  assert.equal(store.getById(w.id).customTimers[0].untilEnded, true);
  store.updateCustomTimer(w.id, t.id, { ...store.getById(w.id).customTimers[0], untilEnded: false });
  assert.equal(store.getById(w.id).customTimers[0].untilEnded, undefined);
  const [a, b] = sanitizeCustomTimers([{ id: 'a', untilEnded: 'yes' }, { id: 'b', untilEnded: true }]);
  assert.equal(a.untilEnded, undefined, 'only a real true counts');
  assert.equal(b.untilEnded, true);
});

test('wiring: both IPC handlers carry it, the form sends it, and the premade is offered', () => {
  const mainSrc = read('src', 'main', 'main.js');
  for (const ch of ['widget:addCustomTimer', 'widget:updateCustomTimer']) {
    const at = mainSrc.indexOf(`'${ch}'`);
    const handler = mainSrc.slice(at, mainSrc.indexOf('\n);', at));
    assert.equal((handler.match(/untilEnded/g) || []).length, 2, `${ch}: must both destructure and forward untilEnded`);
  }
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(renderer, /untilEnded: newTimerUntilEndedCheckbox\.checked,/);
  assert.match(renderer, /id: 'stance',\s*name: 'Stance & invocation',/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="widget-new-timer-until-ended"/);
  assert.match(read('src', 'renderer', 'overlay', 'overlay.js'), /buff\.phase === 'shown' \|\| \(buff\.untilEnded && buff\.remainingSec == null\)/, 'no infinity symbol once settled');
});

test('the test bench has stance and invocation presets that the premade actually reacts to', () => {
  const { presets } = JSON.parse(read('src', 'shared', 'data', 'test-bench-presets.json'));
  const group = presets.filter((p) => p.group === 'Stances & invocations');
  assert.ok(group.length >= 4);
  for (const p of group) {
    const { names, say } = setup();
    say(...p.lines.map((l) => l.text));
    assert.deepEqual(names(), [p.label], `preset "${p.label}" should light exactly its own tile`);
  }
});

// ---------------------------------------------------------------------------
// The shared 6s swap cooldown (owner, 15 Oct): a new stance (or invocation) tile counts 6s down
// first - sweep by default, number optional, a draining bar in list mode - then just stays.
// ---------------------------------------------------------------------------

test('a fresh pick counts its group\'s 6s cooldown down, then settles with no countdown', () => {
  const { engine, say } = setup();
  const realNow = Date.now;
  const t0 = realNow();
  try {
    Date.now = () => t0;
    say('You assume an evasive stance.');
    let [tile] = engine.getActive();
    assert.equal(tile.phase, 'cooldown');
    assert.equal(tile.durationSec, 6);
    assert.equal(tile.remainingSec, 6);
    assert.equal(tile.infinite, undefined, 'a real countdown - the sweep and the list bar both need that');
    Date.now = () => t0 + 2500;
    [tile] = engine.getActive();
    assert.equal(tile.remainingSec, 4);
    Date.now = () => t0 + 6100;
    engine._tick();
    [tile] = engine.getActive();
    assert.equal(tile.remainingSec, null);
    assert.equal(tile.infinite, true);
    assert.notEqual(tile.phase, 'cooldown');
  } finally { Date.now = realNow; }
});

test('stance and invocation cooldowns are separate; a swap starts a fresh one', () => {
  const { engine, say } = setup();
  const realNow = Date.now;
  const t0 = realNow();
  const cd = () => Object.fromEntries(engine.getActive().map((t) => [t.name, t.remainingSec]));
  try {
    Date.now = () => t0;
    say('You assume an evasive stance.');
    Date.now = () => t0 + 4000;
    say('You begin reciting the divine invocation.');
    assert.deepEqual(cd(), { 'Evasive Stance': 2, 'Divine Invocation': 6 });
    Date.now = () => t0 + 10000;
    engine._tick();
    say('You begin to change your stance.', 'You assume a defensive stance.');
    assert.deepEqual(cd(), { 'Divine Invocation': null, 'Defensive Stance': 6 });
  } finally { Date.now = realNow; }
});

test('a settled stance tile does not make every aura redraw once a second', () => {
  const { engine, say } = setup();
  const realNow = Date.now;
  const t0 = realNow();
  let emits = 0;
  engine.on('activeChanged', () => { emits += 1; });
  try {
    Date.now = () => t0;
    say('You assume an evasive stance.');
    Date.now = () => t0 + 7000;
    engine._tick(); // the cooldown just ended - one redraw to drop the cooldown look
    const afterEnd = emits;
    Date.now = () => t0 + 8000;
    engine._tick();
    Date.now = () => t0 + 9000;
    engine._tick();
    assert.equal(emits, afterEnd, 'nothing is ticking, so nothing should be broadcast');
  } finally { Date.now = realNow; }
});

test('the premade defaults to icons + radial sweep + no number, each trigger with the 6s cooldown', () => {
  const { widget } = setup();
  assert.equal(widget.displayMode, 'icons');
  assert.equal(widget.iconDepletionShade, 'radial');
  assert.equal(widget.timerFormat, 'off');
  assert.ok(widget.customTimers.every((t) => t.cooldownSec === 6));
});

test('"Off" is a real timer format: no number, offered in settings', () => {
  const overlay = read('src', 'renderer', 'overlay', 'overlay.js');
  const fn = overlay.match(/function formatTime\(totalSec, format\) \{[\s\S]*?\n\}/);
  assert.ok(fn);
  const formatTime = new Function(`const INFINITE_LABEL = '\\u221e'; ${fn[0]}; return formatTime;`)();
  assert.equal(formatTime(42, 'off'), '');
  assert.equal(formatTime(null, 'off'), '');
  assert.equal(formatTime(42, 'seconds-only'), '42');
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /name="widget-timer-format" value="off" \/> Off<\/label>/);
});

// ---------------------------------------------------------------------------
// Stance first, invocation second, always - and no low-time flash (owner, 15 Oct: they were
// swapping places as their cooldowns ticked, and every swap flashed)
// ---------------------------------------------------------------------------

test('the premade sorts by trigger order (stances listed first) and has the low-time flash off', () => {
  const { widget } = setup();
  assert.equal(widget.sortOrder, 'trigger');
  assert.equal(widget.lowTimeThresholdSec, 0);
  const lastStance = widget.customTimers.map((t) => t.name).reduce((i, n, k) => (/Stance$/.test(n) ? k : i), -1);
  const firstInvocation = widget.customTimers.findIndex((t) => /Invocation$/.test(t.name));
  assert.ok(lastStance < firstInvocation, 'every stance trigger must come before every invocation trigger');
});

test('"Trigger order" keeps tiles in the trigger list\'s order whatever their time left', () => {
  const overlay = read('src', 'renderer', 'overlay', 'overlay.js');
  const fn = overlay.match(/function sortBuffs\(buffs, order, direction\) \{[\s\S]*?\n\}/);
  assert.ok(fn);
  const currentConfig = { customTimers: [{ id: 'stance' }, { id: 'invocation' }] };
  const sortBuffs = new Function('currentConfig', `${fn[0]}; return sortBuffs;`)(currentConfig);
  // The invocation just swapped (6s cooldown left); the stance is settled (no countdown).
  const tiles = [
    { id: 'invocation', name: 'Divine Invocation', remainingSec: 6 },
    { id: 'stance', name: 'Evasive Stance', remainingSec: null },
  ];
  assert.deepEqual(sortBuffs(tiles, 'trigger').map((t) => t.id), ['stance', 'invocation']);
  assert.deepEqual(sortBuffs([...tiles].reverse(), 'trigger').map((t) => t.id), ['stance', 'invocation']);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /value="trigger" \/> Trigger order<\/label>/);
});

// ---------------------------------------------------------------------------
// "Dim tiles while on cooldown" - an aura option, on for every existing aura, off in the premade
// (owner, 15 Oct: "do not alpha fade the icons by default either")
// ---------------------------------------------------------------------------

test('cooldown dimming is on by default, off in the premade, and survives a share code', () => {
  const store = new WidgetStore({ loadJson: (n, f) => f, saveJson: () => {} });
  assert.equal(store.create('Plain', { buffSource: 'customTimer' }).cooldownDim, true, 'existing look kept');
  const premade = store.createStanceAura();
  assert.equal(premade.cooldownDim, false);
  const copy = store.importCode(store.exportCode(premade.id));
  assert.equal(copy.cooldownDim, false, 'a shared stance aura keeps it off');
  const { normalizeWidget } = require('../src/main/widgetStore');
  assert.equal(normalizeWidget({ id: 'x', kind: 'custom' }).cooldownDim, true, 'an aura saved before the option exists stays dimmed');
});

test('the overlay only dims a cooldown tile when the aura asks for it', () => {
  assert.match(
    read('src', 'renderer', 'overlay', 'overlay.js'),
    /classList\.toggle\('cooldown-phase', cooling && currentConfig\.cooldownDim !== false\)/
  );
  const mainSrc = read('src', 'main', 'main.js');
  assert.match(mainSrc, /ipcMain\.handle\('widget:setCooldownDim'/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="widget-cooldown-dim-checkbox"/);
});

// Owner, 15 Oct: tiles end on the NEXT pick, not on "You begin to change...". So a swap with no
// "begin to change" line (a bench line, or the rare one in real logs) still replaces the old tile,
// and the old tile stays up through the swap's own time instead of leaving a gap.
test('a pick with no "begin to change" line before it still replaces the old tile', () => {
  const { names, say } = setup();
  say('You assume an evasive stance.');
  say('You assume a mage hunter stance.'); // no precursor
  assert.deepEqual(names(), ['Mage Hunter Stance']);
  say('You begin reciting the divine invocation.');
  say('You begin reciting the spellblade invocation.');
  assert.deepEqual(names(), ['Mage Hunter Stance', 'Spellblade Invocation']);
});

test('no gap during a swap: the old tile stays until the new pick lands; an interrupted swap keeps it', () => {
  const { names, say } = setup();
  say('You assume an evasive stance.');
  say('You begin to change your stance.');
  assert.deepEqual(names(), ['Evasive Stance'], 'still up while the swap is in progress');
  say('You assume an offensive stance.');
  assert.deepEqual(names(), ['Offensive Stance']);
  say('You begin to change your stance.'); // ...and it never completes
  assert.deepEqual(names(), ['Offensive Stance'], 'an interrupted swap leaves the real stance showing');
});

module.exports = () => report('stance-aura');
if (require.main === module) report('stance-aura').then((n) => process.exit(n ? 1 : 0));
