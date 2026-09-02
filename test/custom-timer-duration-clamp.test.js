'use strict';
/**
 * Defence in depth: widgetStore.normalizeWidget clamps every timer's durationSec / cooldownSec on
 * every real path (import, share code, UI, disk load). But a caller that hands a widget object
 * straight to CustomTimerEngine.setGetWidgetsFn, bypassing the store, could still get a NaN /
 * Infinity / string through - and `now + NaN * 1000` makes a timer whose expiresAt is NaN, so it
 * never expires and the tile is stuck forever. The engine clamps again where it reads the value
 * (clampSec in customTimerEngine.js). AEM adversarial-review follow-up, Sep 2.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const TS = '[Wed Aug 19 19:23:03 2026] ';

// A widget shaped like the store's output but NOT run through normalizeWidget - the one path the
// clamp exists to cover.
function engineWith(timer) {
  const widget = {
    id: 'w1',
    name: 'Raw',
    buffSource: 'customTimer',
    enabled: true,
    showOnAllProfiles: true,
    activeProfileIds: [],
    reverseDetection: false,
    triggerCombineMode: 'independent',
    customTimers: [{ id: 't1', name: 'T', triggerText: 'go', triggerMatch: 'contains', ...timer }],
  };
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => [widget]);
  clearInterval(engine.tickTimer);
  return engine;
}

for (const bad of [NaN, Infinity, -Infinity, 'abc', null, undefined, {}, -5]) {
  test(`durationSec of ${String(bad)} lands a timer with a finite expiry`, () => {
    const engine = engineWith({ durationSec: bad });
    engine.handleLine(`${TS}go`);
    const active = engine.getActive();
    assert.equal(active.length, 1, 'the timer should still land');
    const t = active[0];
    assert.ok(Number.isFinite(t.remainingSec), `remainingSec is ${t.remainingSec}`);
    assert.ok(t.remainingSec >= 0 && t.remainingSec <= 3600, `remainingSec ${t.remainingSec} out of range`);
  });
}

test('a huge durationSec is capped at 3600, not left to overflow', () => {
  const engine = engineWith({ durationSec: 1e999 });
  engine.handleLine(`${TS}go`);
  assert.equal(engine.getActive()[0].remainingSec <= 3600, true);
});

test('a legitimate durationSec is untouched', () => {
  const engine = engineWith({ durationSec: 42 });
  engine.handleLine(`${TS}go`);
  assert.equal(engine.getActive()[0].durationSec, 42);
});

test('a garbage cooldownSec is clamped to 0 on the stored timer, not left as NaN', () => {
  const engine = engineWith({ durationSec: 5, cooldownSec: 'nope' });
  engine.handleLine(`${TS}go`);
  const stored = [...engine.activeTimers.values()][0];
  assert.ok(stored, 'the timer should be stored');
  assert.ok(Number.isFinite(stored.cooldownSec), `stored cooldownSec is ${stored.cooldownSec}`);
  assert.equal(stored.cooldownSec, 0);
});

module.exports = () => report('custom-timer-duration-clamp');
if (require.main === module) report('custom-timer-duration-clamp').then((n) => process.exit(n ? 1 : 0));
