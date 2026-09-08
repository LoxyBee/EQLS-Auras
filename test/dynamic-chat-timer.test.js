'use strict';
/**
 * "Set duration from the chat line" (widget.dynamicChatTimer). Owner, 5 Sep: a custom trigger
 * whose duration is written into the line that fires it - "/say timerstart 8:10" -> an 8m10s tile,
 * "/say timerstart 3:00" -> the same tile restarts at 3:00.
 *
 * Rules the owner set:
 *  - whole-aura toggle, next to Reverse detection (not per-trigger)
 *  - mm:ss only, up to 60:00 (the engine caps at one hour, so hours are never needed)
 *  - NO fallback: a line with no mm:ss on it fires nothing ("if they fuck it up it's their fault")
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');
const { parseChatTimerDuration } = require('../src/main/buffParser');
const { WidgetStore } = require('../src/main/widgetStore');

const TS = '[Wed Aug 19 19:23:03 2026] ';
const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

// ---------------------------------------------------------------------------
// The parser
// ---------------------------------------------------------------------------

test('parseChatTimerDuration reads mm:ss out of a line, clamped to 1..3600', () => {
  assert.equal(parseChatTimerDuration(`${TS}You say, 'timerstart 8:10'`), 490);
  assert.equal(parseChatTimerDuration(`${TS}You say, 'timerstart 0:30'`), 30);
  assert.equal(parseChatTimerDuration(`${TS}You say, 'pop 60:00'`), 3600);
  assert.equal(parseChatTimerDuration(`${TS}You say, 'pop 90:00'`), 3600, 'over the cap clamps, does not reject');
  assert.equal(parseChatTimerDuration(`${TS}You say, 'go 1:05 now'`), 65, 'token can sit mid-line');
});

test('parseChatTimerDuration returns null when there is no usable token', () => {
  assert.equal(parseChatTimerDuration(`${TS}You say, 'timerstart'`), null);
  assert.equal(parseChatTimerDuration(`${TS}You say, 'timerstart 0:00'`), null, '0:00 is not a duration');
  assert.equal(parseChatTimerDuration(`${TS}You say, 'timerstart 8:99'`), null, 'seconds must be 00-59');
  assert.equal(parseChatTimerDuration(`${TS}You say, 'timerstart 810'`), null, 'needs the colon');
});

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

function engineWith(widgetPatch, timerPatch) {
  const widget = {
    id: 'w1',
    name: 'Dyn',
    buffSource: 'customTimer',
    showOnAllProfiles: true,
    activeProfileIds: [],
    reverseDetection: false,
    dynamicChatTimer: true,
    triggerCombineMode: 'independent',
    triggerDurationSec: 5,
    // A plain raw-text trigger word by default, exact match - the point being that dynamic mode
    // ignores the match setting and works off the word + the time after it either way.
    customTimers: [{ id: 't1', name: 'Pull', triggerText: 'pulltimerstart', durationSec: 5, ...timerPatch }],
    ...widgetPatch,
  };
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => [widget]);
  clearInterval(engine.tickTimer);
  return engine;
}

test('the trigger word plus a time on the same line fires it at that time', () => {
  const engine = engineWith();
  engine.handleLine(`${TS}You say, 'pulltimerstart 1:20'`);
  const active = engine.getActive();
  assert.equal(active.length, 1);
  assert.ok(active[0].remainingSec > 70 && active[0].remainingSec <= 80, `got ${active[0].remainingSec}`);
});

test('it works even when the trigger was set up as an exact chat message (the reported bug)', () => {
  const engine = engineWith(undefined, {
    triggerText: "You say, 'pulltimerstart'",
    triggerChat: { channel: 'say', isSelf: true, message: 'pulltimerstart' },
  });
  engine.handleLine(`${TS}You say, 'pulltimerstart 8:10'`);
  const active = engine.getActive();
  assert.equal(active.length, 1, 'the exact chat line never matches "pulltimerstart 8:10" - dynamic mode must not care');
  assert.ok(active[0].remainingSec > 480 && active[0].remainingSec <= 490, `got ${active[0].remainingSec}`);
});

test('a second call restarts the same tile at the new time', () => {
  const engine = engineWith();
  engine.handleLine(`${TS}You say, 'pulltimerstart 8:10'`);
  engine.handleLine(`${TS}You say, 'pulltimerstart 3:00'`);
  const active = engine.getActive();
  assert.equal(active.length, 1);
  assert.ok(active[0].remainingSec > 170 && active[0].remainingSec <= 180, `got ${active[0].remainingSec}`);
});

test('the trigger word with no time after it -> nothing fires (no fallback)', () => {
  const engine = engineWith();
  engine.handleLine(`${TS}You say, 'pulltimerstart'`);
  assert.equal(engine.getActive().length, 0);
});

test('a bare time with the wrong word does not fire it', () => {
  const engine = engineWith();
  engine.handleLine(`${TS}You say, 'something else 1:20'`);
  assert.equal(engine.getActive().length, 0);
});

test('a trigger word is not matched as the prefix of a longer word', () => {
  // Owner, 6 Sep: "/say pulltimerstart2 7:48" was also firing the "pulltimerstart" trigger.
  const engine = engineWith();
  const widget = engine.getWidgetsFn()[0];
  widget.customTimers.push({ id: 't2', name: 'Pull2', triggerText: 'pulltimerstart2', durationSec: 5 });
  engine.handleLine(`${TS}You say, 'pulltimerstart2 7:48'`);
  const ids = engine.getActive().map((t) => t.id);
  assert.deepEqual(ids, ['t2'], 'only the pulltimerstart2 trigger fires');
  engine.handleLine(`${TS}You say, 'pulltimerstart 1:20'`);
  assert.deepEqual(engine.getActive().map((t) => t.id).sort(), ['t1', 't2'], 'the plain word still works');
});

test('reverse detection + dynamic: the tile shows always, then hides for the parsed time', () => {
  const engine = engineWith({ reverseDetection: true });
  assert.deepEqual(engine.getActive().map((t) => ({ p: t.phase, inf: t.infinite })), [{ p: 'shown', inf: true }]);
  engine.handleLine(`${TS}You say, 'pulltimerstart 1:20'`);
  assert.equal(engine.getActive().length, 0, 'hidden for the 1:20');
});

test('toggling Reverse detection on does not leave a stale countdown beside the always-on tile', () => {
  // Reported live 5 Sep: a "3:35" countdown and an infinite tile on screen at once. The countdown
  // was a real timer started while the aura was still in normal mode; flipping Reverse detection on
  // synthesizes the always-on tile without clearing it.
  const engine = engineWith(); // normal mode
  engine.handleLine(`${TS}You say, 'pulltimerstart 4:23'`);
  assert.equal(engine.getActive().length, 1);
  engine.getWidgetsFn()[0].reverseDetection = true; // user ticks the box
  const active = engine.getActive();
  assert.equal(active.length, 1, 'exactly one tile, not the stale countdown plus the new one');
  assert.equal(active[0].infinite, true);
});

test('with the toggle off the fixed duration is used as normal', () => {
  const engine = engineWith({ dynamicChatTimer: false }, { triggerMatch: 'contains' });
  engine.handleLine(`${TS}You say, 'pulltimerstart 8:10'`);
  const active = engine.getActive();
  assert.equal(active.length, 1);
  assert.ok(active[0].remainingSec <= 5, `fixed 5s, got ${active[0].remainingSec}`);
});

// ---------------------------------------------------------------------------
// The store + wiring
// ---------------------------------------------------------------------------

test('dynamicChatTimer: default false, in SHAREABLE_FIELDS, coerced by normalizeWidget', () => {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const w = store.create('T', { buffSource: 'customTimer' });
  assert.equal(w.dynamicChatTimer, false);
  const updated = store.setDynamicChatTimer(w.id, 'yes');
  assert.equal(updated.dynamicChatTimer, true);
  // SHAREABLE_FIELDS is APPEND ONLY - dynamicChatTimer sits near the end, after reverseDetection.
  assert.match(read('src', 'main', 'widgetStore.js'), /'dynamicChatTimer',\n\s*'scale',\n/);
  assert.doesNotMatch(read('src', 'main', 'widgetStore.js'), /'reverseDetection',\n\s*'dynamicChatTimer',/);
  assert.match(read('src', 'main', 'widgetStore.js'), /dynamicChatTimer: !!widget\.dynamicChatTimer,/);
});

test('wired main -> preload -> renderer', () => {
  assert.match(read('src', 'main', 'main.js'), /widget:setDynamicChatTimer.*widgetManager\.setDynamicChatTimer\(id, enabled\)/);
  assert.match(read('src', 'main', 'widgetManager.js'), /function setDynamicChatTimer\(id, enabled\)/);
  assert.match(read('src', 'preload', 'preload-main.js'), /setWidgetDynamicChatTimer: \(id, enabled\)/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="widget-dynamic-chat-timer-checkbox"/);
  const r = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(r, /dynamicChatTimerCheckbox\.checked = !!widget\.dynamicChatTimer/);
  assert.match(r, /setWidgetDynamicChatTimer\(selectedId, dynamicChatTimerCheckbox\.checked\)/);
  // the fixed Duration boxes grey out while it is on
  assert.match(r, /triggerDurationMinInput\.disabled = !!on/);
});

module.exports = () => report('dynamic-chat-timer');
if (require.main === module) report('dynamic-chat-timer').then((n) => process.exit(n ? 1 : 0));
