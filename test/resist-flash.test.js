'use strict';
/**
 * The RESIST flash - note 17's last piece.
 *
 * She asked for "a red RESIST message for about 1.4 seconds when a mob resists". The display side
 * of that already existed: note 23 built the text-only aura, and note 12's dispelled preset showed
 * the shape. What was missing was a way to trigger on the line, because a custom timer's trigger
 * had to equal the whole line exactly, and the game writes the mob's name into the middle of it.
 *
 * So triggers gained an opt-in "contains" mode. Exact stays the default, and that default is not
 * an accident: a trigger of "hi" matching every line containing "hi" is a timer that fires
 * constantly. Nothing already saved changes.
 *
 * The wording, and the three lines that must NOT fire it, were counted across the owner's seven
 * logs - 1,521,971 lines. "resisted your " appears 970 times and every one of them is a spell she
 * cast being resisted.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const ROOT = path.join(__dirname, '..');
const rendererSrc = fs
  .readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8')
  .replace(/\r\n/g, '\n');

const TS = '[Wed Aug 19 19:23:03 2026] ';

function setup(preset) {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const widget = store.createTextAura('Resist flash', { preset });
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer); // no sweeping - these tests drive it themselves
  return { store, widget, engine };
}

const fires = (engine, line) => {
  engine.activeTimers.clear();
  engine.handleLine(TS + line);
  return engine.getActive().length > 0;
};

// ---------------------------------------------------------------------------
// What it is
// ---------------------------------------------------------------------------

test('the preset builds a text aura that says RESISTED', () => {
  const { widget } = setup('resisted');
  assert.equal(widget.displayMode, 'text');
  assert.equal(widget.textAuraMessage, 'RESISTED');
  assert.equal(widget.buffSource, 'customTimer');
  assert.equal(widget.customTimers.length, 1, 'one trigger covers every spell - see the preset comment');
});

test('the flash is the length she asked for', () => {
  const { widget } = setup('resisted');
  assert.equal(widget.customTimers[0].durationSec, 1.4, 'note 17 asks for about 1.4 seconds');
});

test('it uses contains matching, because the mob name is in the middle of the line', () => {
  const { widget } = setup('resisted');
  assert.equal(widget.customTimers[0].triggerMatch, 'contains');
  assert.equal(widget.customTimers[0].triggerText, 'resisted your ');
});

// ---------------------------------------------------------------------------
// What fires it, from the owner's own logs
// ---------------------------------------------------------------------------

test('every real resist line fires it', () => {
  const { engine } = setup('resisted');
  // All verbatim. The first five are the complete population of mez resists in the logs.
  const lines = [
    'Orc centurion resisted your Mesmerize!',
    'Orc legionnaire resisted your Mesmerize!',
    'A gnoll bouncer resisted your Mesmerize!',
    'An elite gnoll shaman resisted your Mesmerize!',
    'Emperor Crush resisted your Charm!',
    'A glyphed ghoul resisted your Charm!',
    "a zol ghoul knight resisted your Denon's Dissension!",
  ];
  for (const line of lines) assert.ok(fires(engine, line), `did not fire on: ${line}`);
});

test('a spell name with a rank numeral still fires it', () => {
  // Real shapes from the logs: Plague III, Envenomed Bolt IV, Togor's Insects V.
  const { engine } = setup('resisted');
  for (const spell of ['Plague III', 'Envenomed Bolt IV', "Togor's Insects V", "Denon's Desperate Dirge IX"]) {
    assert.ok(fires(engine, `A greater kobold resisted your ${spell}!`), `did not fire on rank: ${spell}`);
  }
});

// ---------------------------------------------------------------------------
// What must NOT fire it
// ---------------------------------------------------------------------------

test('a resist happening TO you does not fire it', () => {
  // 761 of these in the logs against 970 outbound, and the shape is nearly identical. This is the
  // one that would turn a RESIST flash into a light that is on most of the time.
  const { engine } = setup('resisted');
  for (const line of [
    "You resist Fright's Earth Elemental Attack!",
    "You resist Dread's Sha's Lethargy!",
  ]) {
    assert.equal(fires(engine, line), false, `fired on an inbound resist: ${line}`);
  }
});

test('somebody else being resisted does not fire it', () => {
  // All verbatim from the logs - 11 lines of this shape.
  const { engine } = setup('resisted');
  for (const line of [
    "Bloodgurgler resisted Marrowbane's Shock of Blades!",
    "A greater kobold resisted Xibarn's Drowsy!",
    "An elite gnoll fighter resisted a gnoll necromancer's Disease Cloud!",
  ]) {
    assert.equal(fires(engine, line), false, `fired on someone else's resist: ${line}`);
  }
});

test('somebody typing the word in chat does not fire it', () => {
  // A real line from the logs. It is why "resisted" on its own would have been the wrong trigger.
  const { engine } = setup('resisted');
  assert.equal(
    fires(engine, "Ranakor tells General:1, 'i don't think anything resisted my slows with overchannel'"),
    false
  );
});

// ---------------------------------------------------------------------------
// The matching mode itself
// ---------------------------------------------------------------------------

test('exact stays the default, so nothing already set up changes', () => {
  const { store, widget, engine } = setup();
  store.addCustomTimer(widget.id, { name: 'Hi', durationSec: 5, triggerText: 'hi' });
  assert.equal(fires(engine, 'hi'), true, 'an exact trigger stopped working');
  assert.equal(
    fires(engine, 'Bob says, hi there'),
    false,
    'an existing exact trigger started matching part of a line - every saved timer would change behaviour'
  );
});

test('contains is stored only when asked for', () => {
  const { store, widget } = setup();
  const w = store.addCustomTimer(widget.id, { name: 'A', durationSec: 5, triggerText: 'x' });
  assert.equal(w.customTimers.at(-1).triggerMatch, undefined, 'a plain timer must stay byte-identical');
  const w2 = store.addCustomTimer(widget.id, { name: 'B', durationSec: 5, triggerText: 'y', triggerMatch: 'contains' });
  assert.equal(w2.customTimers.at(-1).triggerMatch, 'contains');
  // Anything else means exact, rather than becoming a third undefined mode.
  const w3 = store.addCustomTimer(widget.id, { name: 'C', durationSec: 5, triggerText: 'z', triggerMatch: 'sideways' });
  assert.equal(w3.customTimers.at(-1).triggerMatch, undefined);
});

test('editing a timer does not lose its matching mode', () => {
  // updateCustomTimer takes a fixed field list and does not know about triggerMatch. It mutates
  // the existing object rather than rebuilding it, so the field survives - but that is a property
  // worth pinning, because rebuilding would be the natural way to rewrite that function.
  const { store, widget } = setup();
  const added = store.addCustomTimer(widget.id, {
    name: 'R', durationSec: 1.4, triggerText: 'resisted your ', triggerMatch: 'contains',
  });
  const timerId = added.customTimers.at(-1).id;
  const after = store.updateCustomTimer(widget.id, timerId, {
    name: 'R', durationSec: 2, triggerText: 'resisted your ',
  });
  assert.equal(after.customTimers.at(-1).triggerMatch, 'contains', 'editing a timer silently made it exact');
});

test('the flash clears itself', () => {
  const { engine } = setup('resisted');
  engine.handleLine(`${TS}Orc centurion resisted your Mesmerize!`);
  assert.equal(engine.getActive().length, 1);
  // Reach past the expiry rather than waiting 1.4 real seconds.
  for (const t of engine.activeTimers.values()) t.expiresAt = Date.now() - 1;
  engine._tick();
  assert.equal(engine.getActive().length, 0, 'the flash never goes away');
});

// ---------------------------------------------------------------------------
// Reaching it
// ---------------------------------------------------------------------------

test('it is offered in the Add Aura list', () => {
  assert.match(rendererSrc, /id: 'resisted',/, 'no Resist flash entry in the premade list');
  assert.match(rendererSrc, /createTextAuraWidget\(name, 'resisted'\)/);
});

module.exports = () => report('resist-flash');
if (require.main === module) process.exit(report('resist-flash') ? 1 : 0);
