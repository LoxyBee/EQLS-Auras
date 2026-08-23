'use strict';
/**
 * Note 9 - a timer that needs several things to be true at once.
 *
 * "Any-of" was the easy half and has worked for a while. This is the other one, and it was left
 * unbuilt for a long time because the note did not say over what window the parts had to line up.
 * Shara answered that on 23 August, and her answer is the thing these tests are really pinning:
 *
 *   "the time window should be whatever each individual trigger has. this kind of functionality
 *    will primarily be used for 'if in this zone (no duration check), and this thing happens', so
 *    limiting it to checks happen within a set time frame is not something i want."
 *
 * So there is no shared window - which is the interesting design decision, and the one a later
 * refactor is most likely to quietly undo by adding one back "for safety".
 *
 * And from the earlier round: "nothing shown when half is done, only show when both are active. if
 * one is active, it should be invisible to the player until the other happens."
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const T = '[Wed Aug 19 21:14:02 2026] ';

function makeEngine(timers, zone = null) {
  const engine = new CustomTimerEngine();
  clearInterval(engine.tickTimer); // no wall clock; every test drives time itself
  engine.setGetWidgetsFn(() => [{ id: 'w1', customTimers: timers }]);
  engine.setCurrentZoneFn(() => zone);
  return engine;
}

const active = (engine) => engine.getActive().map((t) => t.name).sort();

// ---------------------------------------------------------------------------
// Nothing shows until everything is true
// ---------------------------------------------------------------------------

test('one part on its own shows nothing at all', () => {
  const e = makeEngine([
    {
      id: 't1',
      name: 'Both',
      durationSec: 30,
      allOf: [
        { kind: 'line', triggerText: 'first thing' },
        { kind: 'line', triggerText: 'second thing' },
      ],
    },
  ]);
  e.handleLine(`${T}first thing`);
  assert.deepEqual(active(e), [], 'a half-satisfied condition is state, not a tile');
});

test('the second part fires it, on the same line that completes the set', () => {
  const e = makeEngine([
    {
      id: 't1',
      name: 'Both',
      durationSec: 30,
      allOf: [
        { kind: 'line', triggerText: 'first thing' },
        { kind: 'line', triggerText: 'second thing' },
      ],
    },
  ]);
  e.handleLine(`${T}first thing`);
  e.handleLine(`${T}second thing`);
  assert.deepEqual(active(e), ['Both']);
});

test('the order the parts arrive in does not matter', () => {
  const build = () => [
    {
      id: 't1',
      name: 'Both',
      durationSec: 30,
      allOf: [
        { kind: 'line', triggerText: 'first thing' },
        { kind: 'line', triggerText: 'second thing' },
      ],
    },
  ];
  const e = makeEngine(build());
  e.handleLine(`${T}second thing`);
  e.handleLine(`${T}first thing`);
  assert.deepEqual(active(e), ['Both']);
});

// ---------------------------------------------------------------------------
// Each part carries its own window, and there is no shared one
// ---------------------------------------------------------------------------

test('a part stops counting once its own hold time is up', () => {
  const e = makeEngine([
    {
      id: 't1',
      name: 'Both',
      durationSec: 30,
      allOf: [
        { kind: 'line', triggerText: 'first thing', holdSec: 5 },
        { kind: 'line', triggerText: 'second thing', holdSec: 5 },
      ],
    },
  ]);
  e.handleLine(`${T}first thing`);
  // Six seconds later, which is past this part's own five.
  e.partSatisfiedUntil.set('t1#0', Date.now() - 1000);
  e.handleLine(`${T}second thing`);
  assert.deepEqual(active(e), [], 'the first part had lapsed by the time the second arrived');
});

// The whole point of her answer. Two parts with very different holds are not forced into one
// window, so the long one is still waiting when the short one fires.
test('two parts with different holds each keep their own', () => {
  const e = makeEngine([
    {
      id: 't1',
      name: 'Both',
      durationSec: 30,
      allOf: [
        { kind: 'line', triggerText: 'slow thing', holdSec: 600 },
        { kind: 'line', triggerText: 'quick thing', holdSec: 2 },
      ],
    },
  ]);
  const now = Date.now();
  e.handleLine(`${T}slow thing`);
  // Five minutes on. A shared window of any sensible size would have expired this; its own has not.
  e.partSatisfiedUntil.set('t1#0', now + 600 * 1000);
  e.handleLine(`${T}quick thing`);
  assert.deepEqual(active(e), ['Both']);
});

test('a part with no hold time set gets a default rather than none', () => {
  const e = makeEngine([
    {
      id: 't1',
      name: 'Both',
      durationSec: 30,
      allOf: [
        { kind: 'line', triggerText: 'first thing' },
        { kind: 'line', triggerText: 'second thing' },
      ],
    },
  ]);
  e.handleLine(`${T}first thing`);
  const until = e.partSatisfiedUntil.get('t1#0');
  assert.ok(until > Date.now() + 20000, 'a missing hold must not mean satisfied for zero seconds');
});

// ---------------------------------------------------------------------------
// The zone part - the case she said this is mainly for
// ---------------------------------------------------------------------------

test('being in the zone plus the thing happening fires it', () => {
  const e = makeEngine(
    [
      {
        id: 't1',
        name: 'Here and now',
        durationSec: 30,
        allOf: [
          { kind: 'zone', zone: 'Rivervale' },
          { kind: 'line', triggerText: 'the thing' },
        ],
      },
    ],
    'Rivervale'
  );
  e.handleLine(`${T}the thing`);
  assert.deepEqual(active(e), ['Here and now']);
});

test('the same thing in the wrong zone fires nothing', () => {
  const e = makeEngine(
    [
      {
        id: 't1',
        name: 'Here and now',
        durationSec: 30,
        allOf: [
          { kind: 'zone', zone: 'Rivervale' },
          { kind: 'line', triggerText: 'the thing' },
        ],
      },
    ],
    'Misty Thicket'
  );
  e.handleLine(`${T}the thing`);
  assert.deepEqual(active(e), []);
});

// A zone is not a thing that expires - you are somewhere until you leave. This is the "no duration
// check" half of her sentence.
test('a zone part does not lapse with time', () => {
  const e = makeEngine(
    [
      {
        id: 't1',
        name: 'Here and now',
        durationSec: 30,
        allOf: [
          { kind: 'zone', zone: 'Rivervale' },
          { kind: 'line', triggerText: 'the thing' },
        ],
      },
    ],
    'Rivervale'
  );
  // Nothing was ever recorded for the zone part, because there is no clock to record.
  assert.equal(e.partSatisfiedUntil.has('t1#0'), false);
  e.handleLine(`${T}the thing`);
  assert.deepEqual(active(e), ['Here and now']);
});

// The app frequently does not know where you are - it learns from a zone line, and one only
// arrives when you cross. Treating that as "wrong zone" would leave the timer silently dead for a
// whole session started in the wrong place.
test('an unknown zone is not treated as the wrong zone', () => {
  const e = makeEngine(
    [
      {
        id: 't1',
        name: 'Here and now',
        durationSec: 30,
        allOf: [
          { kind: 'zone', zone: 'Rivervale' },
          { kind: 'line', triggerText: 'the thing' },
        ],
      },
    ],
    null
  );
  e.handleLine(`${T}the thing`);
  assert.deepEqual(active(e), ['Here and now']);
});

test('zone names match without case mattering', () => {
  const e = makeEngine(
    [
      {
        id: 't1',
        name: 'Here and now',
        durationSec: 30,
        allOf: [
          { kind: 'zone', zone: 'rivervale' },
          { kind: 'line', triggerText: 'the thing' },
        ],
      },
    ],
    'Rivervale'
  );
  e.handleLine(`${T}the thing`);
  assert.deepEqual(active(e), ['Here and now']);
});

// ---------------------------------------------------------------------------
// Firing again
// ---------------------------------------------------------------------------

// Without clearing the line parts, a zone part - which never lapses - would leave the condition
// permanently satisfied and the timer would restart on every single log line thereafter.
test('it does not re-fire on every line once the zone part is satisfied', () => {
  const e = makeEngine(
    [
      {
        id: 't1',
        name: 'Here and now',
        durationSec: 30,
        allOf: [
          { kind: 'zone', zone: 'Rivervale' },
          { kind: 'line', triggerText: 'the thing' },
        ],
      },
    ],
    'Rivervale'
  );
  e.handleLine(`${T}the thing`);
  // A SENTINEL, not the value it already had. Comparing to the original expiresAt looked right and
  // proved nothing: both firings happen in the same millisecond, so the two values are equal
  // whether or not it re-fired. Mutation testing caught this passing with the clear removed.
  const SENTINEL = 1234567890;
  e.activeTimers.get('t1').expiresAt = SENTINEL;
  e.handleLine(`${T}something else entirely`);
  e.handleLine(`${T}and another line`);
  assert.equal(e.activeTimers.get('t1').expiresAt, SENTINEL, 'the timer restarted on an unrelated line');
});

test('the whole condition coming true again does restart it', () => {
  const e = makeEngine(
    [
      {
        id: 't1',
        name: 'Here and now',
        durationSec: 30,
        allOf: [
          { kind: 'zone', zone: 'Rivervale' },
          { kind: 'line', triggerText: 'the thing' },
        ],
      },
    ],
    'Rivervale'
  );
  e.handleLine(`${T}the thing`);
  const SENTINEL = 1234567890;
  e.activeTimers.get('t1').expiresAt = SENTINEL;
  e.handleLine(`${T}the thing`);
  assert.notEqual(e.activeTimers.get('t1').expiresAt, SENTINEL, 'a genuine repeat should restart it');
});

// ---------------------------------------------------------------------------
// Not breaking what already worked
// ---------------------------------------------------------------------------

test('a plain single-trigger timer is untouched', () => {
  const e = makeEngine([{ id: 't1', name: 'Plain', durationSec: 30, triggerText: 'go' }]);
  e.handleLine(`${T}go`);
  assert.deepEqual(active(e), ['Plain']);
});

// A timer governed by an all-of must not also be fired by its own trigger text, or the extra
// conditions could be skipped by the very line they were added to qualify.
test('a timer with conditions is not fired by its plain trigger text', () => {
  const e = makeEngine([
    {
      id: 't1',
      name: 'Guarded',
      durationSec: 30,
      triggerText: 'go',
      allOf: [
        { kind: 'line', triggerText: 'go' },
        { kind: 'line', triggerText: 'and also this' },
      ],
    },
  ]);
  e.handleLine(`${T}go`);
  assert.deepEqual(active(e), [], 'the second condition has not happened yet');
  e.handleLine(`${T}and also this`);
  assert.deepEqual(active(e), ['Guarded']);
});

// An empty list is not a condition. A timer whose conditions were all deleted should go back to
// its plain trigger rather than become one that can never fire and gives no sign why.
test('an emptied condition list falls back to the plain trigger', () => {
  const e = makeEngine([{ id: 't1', name: 'Plain', durationSec: 30, triggerText: 'go', allOf: [] }]);
  // The unrelated line first, and it is the half that matters. Treating [] as a real condition
  // makes every() vacuously true, so the timer fires on ANY line - and a test that only sent the
  // trigger line passed happily while that was happening. Mutation testing caught it.
  e.handleLine(`${T}something unrelated`);
  assert.deepEqual(active(e), [], 'an empty list must not mean "always satisfied"');
  e.handleLine(`${T}go`);
  assert.deepEqual(active(e), ['Plain']);
});

test('parts use the same three match modes an ordinary trigger has', () => {
  const e = makeEngine([
    {
      id: 't1',
      name: 'Mixed',
      durationSec: 30,
      allOf: [
        { kind: 'line', triggerText: 'resisted your', triggerMatch: 'contains' },
        { kind: 'line', triggerText: 'exactly this' },
      ],
    },
  ]);
  e.handleLine(`${T}Orc centurion resisted your Mesmerize!`);
  assert.deepEqual(active(e), [], 'contains matched, but the exact part has not');
  e.handleLine(`${T}not exactly this though`);
  assert.deepEqual(active(e), [], 'an exact part must not match a line that merely contains it');
  e.handleLine(`${T}exactly this`);
  assert.deepEqual(active(e), ['Mixed']);
});

test('two timers with conditions do not share state', () => {
  const e = makeEngine([
    {
      id: 't1',
      name: 'One',
      durationSec: 30,
      allOf: [
        { kind: 'line', triggerText: 'alpha' },
        { kind: 'line', triggerText: 'beta' },
      ],
    },
    {
      id: 't2',
      name: 'Two',
      durationSec: 30,
      allOf: [
        { kind: 'line', triggerText: 'alpha' },
        { kind: 'line', triggerText: 'gamma' },
      ],
    },
  ]);
  e.handleLine(`${T}alpha`);
  e.handleLine(`${T}beta`);
  assert.deepEqual(active(e), ['One'], 'the second timer still needs its own third line');
  e.handleLine(`${T}gamma`);
  assert.deepEqual(active(e), ['One', 'Two']);
});

// ---------------------------------------------------------------------------
// Surviving the trip from the form to the engine
// ---------------------------------------------------------------------------

// The store is the real one. A condition list that is saved wrong is indistinguishable from one
// that is evaluated wrong, from the player's side - the timer just never fires.
test('conditions survive being saved and read back', () => {
  const { WidgetStore } = require('../src/main/widgetStore');
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const ws = new WidgetStore(store);
  const id = ws.getAll()[0].id;
  ws.addCustomTimer(id, {
    name: 'X',
    durationSec: 10,
    triggerText: 'boom',
    allOf: [
      { kind: 'zone', zone: 'Rivervale' },
      { kind: 'line', triggerText: 'boom', triggerMatch: 'contains', holdSec: 20 },
    ],
  });
  const saved = ws.getById(id).customTimers[0];
  assert.equal(saved.allOf.length, 2);
  assert.deepEqual(saved.allOf[0], { kind: 'zone', zone: 'Rivervale' });
  assert.deepEqual(saved.allOf[1], { kind: 'line', triggerText: 'boom', triggerMatch: 'contains', holdSec: 20 });
});

// A share code is the one path by which a value this app never wrote can arrive, and a part the
// engine does not understand is worse than a missing one - the timer sits there never firing.
test('nonsense conditions are dropped rather than saved', () => {
  const { WidgetStore } = require('../src/main/widgetStore');
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const ws = new WidgetStore(store);
  const id = ws.getAll()[0].id;
  ws.addCustomTimer(id, {
    name: 'X',
    durationSec: 10,
    triggerText: 'boom',
    allOf: [{ kind: 'zone' }, { triggerText: '   ' }, 'junk', null, { triggerText: 'ok' }],
  });
  assert.deepEqual(ws.getById(id).customTimers[0].allOf, [{ kind: 'line', triggerText: 'ok' }]);
});

test('a list with nothing usable in it becomes no list at all', () => {
  const { WidgetStore } = require('../src/main/widgetStore');
  const data = {};
  const store = {
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  };
  const ws = new WidgetStore(store);
  const id = ws.getAll()[0].id;
  ws.addCustomTimer(id, { name: 'X', durationSec: 10, triggerText: 'boom', allOf: [null, 'junk'] });
  assert.equal(ws.getById(id).customTimers[0].allOf, undefined, 'it must fall back to the plain trigger');
});

/**
 * The IPC handlers destructure a FIXED LIST of field names, so a field missing from that list is
 * dropped in silence rather than erroring. That is not hypothetical: triggerMatch 'castOf' was
 * absent from addCustomTimer's whitelist for the whole time castOf timers existed, and the
 * cooldown premade only worked because it writes the timer object directly and never goes through
 * that path. Anything routed through the UI was quietly downgraded and never fired.
 *
 * A source-text check is a blunt instrument, but the bug it guards is invisible at runtime unless
 * you happen to test the whole chain end to end, which needs Electron.
 */
test('allOf is not dropped on the way through the IPC handlers', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  for (const channel of ['widget:addCustomTimer', 'widget:updateCustomTimer']) {
    const at = src.indexOf(channel);
    assert.notEqual(at, -1, `${channel} has been renamed`);
    // Bounded by the NEXT handler, not by a fixed 900 characters. A fixed window spilled into
    // the following ipcMain.handle - which has an allOf of its own - so gutting this one's
    // forwarding call still found the word and passed. Mutation testing again.
    const nextHandler = src.indexOf('ipcMain.handle', at);
    const block = src.slice(at, nextHandler === -1 ? src.length : nextHandler);
    // The destructure and the forwarding call are checked separately, because getting one right
    // and the other wrong is the failure that looks like it works.
    const openAt = block.indexOf('(_event, {');
    const destructure = block.slice(openAt, block.indexOf('})', openAt));
    assert.ok(
      destructure.includes('allOf'),
      `${channel} destructures without allOf, so the field is silently dropped`
    );
    // Split on the ARROW, not on a closing brace. The first version looked for '});' - which
    // does not appear in this code at all, so the slice ran to the end of the block and found
    // the destructure's own allOf again. It passed with the forwarding call gutted; mutation
    // testing is the only reason that is not still true.
    const arrowAt = block.indexOf('=>', openAt);
    const forwarded = block.slice(arrowAt);
    assert.ok(forwarded.includes('widgetManager.'), `${channel} no longer calls the store`);
    assert.ok(forwarded.includes('allOf'), `${channel} does not pass allOf on to the store`);
  }
});

module.exports = () => report('all-of-triggers');
if (require.main === module) process.exit(report('all-of-triggers') ? 1 : 0);
