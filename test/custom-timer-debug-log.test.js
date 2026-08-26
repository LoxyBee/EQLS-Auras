'use strict';
/**
 * customTimerEngine's own debug log - reported live 25 Aug: "should there be a debug log of every
 * aura that is fired/loaded/ended... so that there actually exists a way for you to tell the
 * output from my inputs?"
 *
 * BuffEngine already had this (LANDED/IGNORED/CANCELLED/etc. - see detection.test.js), wired into
 * the always-on "Detection log" under Diagnostics. Custom triggers had NONE of that - not one line
 * anywhere traced a trigger firing, ending, or being restored. That silence is exactly the shape of
 * the last two live-reported bugs (an OR-combined aura showing nothing at all, {mob} resolving to
 * nothing) - both needed the real widgets.json read by hand to root-cause, because the running app
 * gave no account of what it had decided and why.
 *
 * Now off by default and behind a manual toggle (see detection-log-file.test.js for that half) -
 * this file only pins that the engine itself actually produces the lines once given somewhere to
 * write them, which is the same setDebugLogFn/_debugLog shape buffEngine already uses.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const { WidgetStore } = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');

const TS = '[Wed Aug 19 19:23:03 2026] ';

function setup() {
  const data = {};
  const store = new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
  const widget = store.create('Test', { buffSource: 'customTimer' });
  const engine = new CustomTimerEngine();
  engine.setGetWidgetsFn(() => store.getAll());
  clearInterval(engine.tickTimer); // no wall clock - these tests drive time themselves
  const log = [];
  engine.setDebugLogFn((m) => log.push(m));
  return { store, widget, engine, log };
}

test('no debugLogFn wired means _debugLog is a silent no-op, same as BuffEngine\'s', () => {
  const engine = new CustomTimerEngine();
  clearInterval(engine.tickTimer);
  assert.doesNotThrow(() => engine._debugLog('anything'));
});

test('a trigger firing is logged, with the actual line that fired it', () => {
  const { store, widget, engine, log } = setup();
  store.addCustomTimer(widget.id, { name: 'Ability', durationSec: 30, triggerText: 'go go go' });
  engine.handleLine(`${TS}go go go`);
  assert.ok(log.some((l) => l.includes('FIRED') && l.includes('Ability') && l.includes('go go go')));
});

test('a trigger seen again while on cooldown is logged as ignored, not silently dropped', () => {
  const { store, widget, engine, log } = setup();
  store.addCustomTimer(widget.id, { name: 'Ability', durationSec: 2, triggerText: 'go', cooldownSec: 5 });
  engine.handleLine(`${TS}go`);
  engine.activeTimers.forEach((t) => { t.phase = 'cooldown'; });
  log.length = 0;
  engine.handleLine(`${TS}go`);
  assert.ok(log.some((l) => l.includes('IGNORED') && l.includes('Ability') && l.includes('cooldown')));
});

test('ending via endedText is logged with the line that ended it', () => {
  const { store, widget, engine, log } = setup();
  store.addCustomTimer(widget.id, { name: 'Ability', durationSec: 30, triggerText: 'go', endedText: 'stop' });
  engine.handleLine(`${TS}go`);
  log.length = 0;
  engine.handleLine(`${TS}stop`);
  assert.ok(log.some((l) => l.includes('ENDED') && l.includes('Ability') && l.includes('stop')));
});

test('a natural duration expiry is logged as ended too', () => {
  const { store, widget, engine, log } = setup();
  store.addCustomTimer(widget.id, { name: 'Ability', durationSec: 30, triggerText: 'go' });
  engine.handleLine(`${TS}go`);
  const [entry] = [...engine.activeTimers.values()];
  entry.expiresAt = Date.now() - 1000;
  log.length = 0;
  engine._tick();
  assert.ok(log.some((l) => l.includes('ENDED') && l.includes('Ability') && l.includes('duration ran out')));
});

test('a cooldown finishing is also logged as ended, distinctly from a plain duration running out', () => {
  const { store, widget, engine, log } = setup();
  store.addCustomTimer(widget.id, { name: 'Ability', durationSec: 2, triggerText: 'go', cooldownSec: 5 });
  engine.handleLine(`${TS}go`);
  const [entry] = [...engine.activeTimers.values()];
  entry.phase = 'cooldown';
  entry.expiresAt = Date.now() - 1000;
  log.length = 0;
  engine._tick();
  assert.ok(log.some((l) => l.includes('ENDED') && l.includes('Ability') && l.includes('cooldown finished')));
});

test('an interrupted cast is logged as cancelled', () => {
  const { store, widget, engine, log } = setup();
  store.addCustomTimer(widget.id, { name: 'Cooldown', durationSec: 30, triggerText: 'fireball', triggerMatch: 'castOf' });
  engine.handleLine(`${TS}You begin casting Fireball.`);
  log.length = 0;
  engine.handleLine(`${TS}Your Fireball spell is interrupted.`);
  assert.ok(log.some((l) => l.includes('CANCELLED') && l.includes('Cooldown')));
});

test('restoring from a session snapshot logs a LOADED line per timer', () => {
  const { engine, log } = setup();
  engine.restoreSnapshot([
    { id: 't1', name: 'Ability', durationSec: 30, expiresAt: Date.now() + 30000, phase: 'duration' },
  ]);
  assert.ok(log.some((l) => l.includes('LOADED') && l.includes('Ability')));
});

module.exports = () => report('custom-timer-debug-log');
if (require.main === module) report('custom-timer-debug-log').then((n) => process.exit(n ? 1 : 0));
