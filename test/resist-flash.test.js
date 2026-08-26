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

test('the preset builds a text aura that names the actual spell that was resisted', () => {
  // Reported live 24 Aug: "resist text should say 'resisted your [skill name]'" - a bare RESISTED
  // named nothing. {spell} now resolves to whatever the "contains" trigger's own match left over
  // on the real line (customTimerEngine's capturedText) - see the dedicated test further down that
  // proves this end to end against a real log line. Wording settled 25 Aug to also name the mob
  // via {mob} (see overlay.js's textFor()), matching the owner's own live widget.
  const { widget } = setup('resisted');
  assert.equal(widget.displayMode, 'text');
  assert.equal(widget.textAuraMessage, 'Your {spell} was resisted by {mob}');
  assert.equal(widget.buffSource, 'customTimer');
  assert.equal(widget.customTimers.length, 1, 'one trigger covers every spell - see the preset comment');
});

test('the flash is the length she asked for', () => {
  // Originally 1.4s (her first number), raised to 5s at a later request, then settled at 4s by 25
  // Aug to match her own live widget - see the "override the premade with what I have" note on
  // defaultSelfBuffsWidget in widgetStore.js.
  const { widget } = setup('resisted');
  assert.equal(widget.customTimers[0].durationSec, 4);
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

test('it names the actual spell, end to end against a real log line', () => {
  // Reported live 24 Aug: "resist text should say 'resisted your [skill name]'". Verbatim line
  // from the owner's actual current session log.
  const { engine } = setup('resisted');
  engine.activeTimers.clear();
  engine.handleLine(`${TS}A wanderer resisted your Denon's Dissension!`);
  const active = engine.getActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].capturedText, "Denon's Dissension", 'the mob\'s name and the trailing "!" must not leak into it');
});

test('capturedText is absent for a spell whose contains-match ate the whole line', () => {
  // Nothing left over is not the same as forgetting to capture - both must read as "nothing to
  // show", not an empty string sitting where a spell name should be.
  const { store, engine } = setup();
  store.addCustomTimer(store.getAll()[0].id, { name: 'X', durationSec: 5, triggerText: 'resisted your', triggerMatch: 'contains' });
  engine.handleLine(`${TS}resisted your`);
  assert.equal(engine.getActive()[0].capturedText, null);
});

test('capturedPrefix names the mob, end to end against a real log line', () => {
  // Reported live 25 Aug: "Your {spell} was resisted by {mob} did not print mob name" -
  // capturedText already answered "what got resisted" (the text AFTER the match); this is the
  // same idea for "what resisted it" (the text BEFORE the match).
  const { engine } = setup('resisted');
  engine.handleLine(`${TS}An imp protector resisted your Denon's Dissension!`);
  const active = engine.getActive();
  assert.equal(active.length, 1);
  assert.equal(active[0].capturedPrefix, 'An imp protector');
  assert.equal(active[0].capturedText, "Denon's Dissension", 'the prefix capture must not have eaten the suffix one');
});

test('capturedPrefix is absent when the match sits at the very start of the line', () => {
  const { store, engine } = setup();
  store.addCustomTimer(store.getAll()[0].id, { name: 'X', durationSec: 5, triggerText: 'resisted your', triggerMatch: 'contains' });
  engine.handleLine(`${TS}resisted your Mesmerize!`);
  assert.equal(engine.getActive()[0].capturedPrefix, null, 'nothing before the match must not become an empty string');
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

test('editing a timer and re-sending the same mode keeps it', () => {
  // Reported live 24 Aug on a real saved Resist flash timer: updateCustomTimer's parameter list
  // was MISSING triggerMatch entirely - not defaulted, not ignored, simply never destructured -
  // so no edit through the form could ever change it, and it just sat at whatever the timer was
  // CREATED with. That looked harmless for an edit that didn't touch matching mode (this test's
  // old shape), but broke badly the moment someone edited the SAME timer into chat mode: the
  // triggerText/triggerChat fields changed to a synthesized "You say, '...'" line while the old
  // 'contains' triggerMatch silently stuck around from creation, matching a mode it was never
  // meant to apply to. The real form (readTimerFormData) always computes and sends a definite
  // triggerMatch on every save - undefined in chat mode, 'contains' or undefined in raw mode - so
  // the fix is the same whitelist-and-always-write addCustomTimer already uses, not a
  // preserve-if-omitted rule like cooldownSec has (that one is a genuinely optional side-channel
  // the form doesn't always touch; triggerMatch is not).
  const { store, widget } = setup();
  const added = store.addCustomTimer(widget.id, {
    name: 'R', durationSec: 1.4, triggerText: 'resisted your ', triggerMatch: 'contains',
  });
  const timerId = added.customTimers.at(-1).id;
  const after = store.updateCustomTimer(widget.id, timerId, {
    name: 'R', durationSec: 2, triggerText: 'resisted your ', triggerMatch: 'contains',
  });
  assert.equal(after.customTimers.at(-1).triggerMatch, 'contains', 'editing a timer silently made it exact');
});

test('editing a timer into chat mode actually clears the old raw-mode triggerMatch', () => {
  // The exact real-world sequence that produced the live bug: a 'contains' timer built from the
  // Resist flash preset, then re-saved through the chat-message builder without the fix above.
  const { store, widget } = setup();
  const added = store.addCustomTimer(widget.id, {
    name: 'R', durationSec: 1.4, triggerText: 'resisted your ', triggerMatch: 'contains',
  });
  const timerId = added.customTimers.at(-1).id;
  const after = store.updateCustomTimer(widget.id, timerId, {
    name: 'R',
    durationSec: 1.4,
    triggerText: "You say, 'resisted your'",
    triggerChat: { channel: 'say', isSelf: true, message: 'resisted your' },
    // triggerMatch omitted - chat mode never sets it, exactly like readTimerFormData's real output.
  });
  const saved = after.customTimers.at(-1);
  assert.equal(saved.triggerMatch, undefined, "a stale 'contains' from before the edit survived into chat mode");
  assert.equal(saved.triggerChat.message, 'resisted your');
});

test('the wiring is intact end to end: main.js\'s IPC handler and widgetStore both carry triggerMatch on update', () => {
  // Reported live 24 Aug - the field was silently dropped in THREE places (the IPC handler's own
  // destructure, the object it forwards, and widgetStore.updateCustomTimer's parameter list).
  // Pinning all three so this exact shape of bug - a field addCustomTimer accepts that
  // updateCustomTimer quietly doesn't - can't reappear for triggerMatch or the next field like it.
  const fs = require('node:fs');
  const path = require('node:path');
  const mainSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const handler = mainSrc.match(/'widget:updateCustomTimer',([\s\S]*?)\n\);/);
  assert.ok(handler, 'the update handler has been restructured');
  assert.match(handler[1], /triggerMatch/, 'triggerMatch is missing from the IPC handler again');
  const storeSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'widgetStore.js'), 'utf8');
  const method = storeSrc.match(/updateCustomTimer\(\s*id,\s*timerId,\s*\{([\s\S]*?)\}\s*\)\s*\{/);
  assert.ok(method, 'updateCustomTimer has been restructured');
  assert.match(method[1], /triggerMatch/, 'triggerMatch is missing from widgetStore.updateCustomTimer again');
});

test('the flash clears itself', () => {
  const { engine } = setup('resisted');
  engine.handleLine(`${TS}Orc centurion resisted your Mesmerize!`);
  assert.equal(engine.getActive().length, 1);
  // Reach past the expiry rather than waiting the real duration out.
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
