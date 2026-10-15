'use strict';

// Test bench - DEV BUILDS ONLY. Lets the owner exercise auras without being in game.
//
// It is a SEPARATE TEST COPY of the app, not a mode inside the real one (owner, 14 Oct: a profile
// "still shows all my old auras... not an actual fresh setup"). The top-bar Test bench button
// restarts the app with --test-bench, and main.js then points userData at its own folder
// ("EQ Buff Tracker (Test bench)"): its own auras, action bars and profiles, starting empty. Only a
// short whitelist of settings is copied in so detection behaves the same (EQ folder, AA levels,
// buff corrections, detection toggles). Exit restarts back into the real setup. Nothing in the real
// data folder is read for auras or written at all while testing.
//
// In the test copy the real log is still watched (so the character / spellbook are known) but
// every real line is IGNORED - only lines sent from the bench reach the engines. The log splitter,
// weekly rotation, archive and trim never run there, so the real Logs folder is never touched.
//
// Bench lines go straight onto the app's line bus (the 'line' event the log watcher emits, flagged
// { test: true }), never into the real eqlog file.
//
// This module is the pure part - sending, presets, history. No electron, no fs; everything it
// touches is injected, so the tests drive it directly.

const { EventEmitter } = require('events');

const HISTORY_KEY = 'testBenchHistory';
const HISTORY_CAP = 40;
const MAX_LINE_LENGTH = 2000;
// The command-line flag that starts the test copy. main.js reads it before anything else loads.
const TEST_BENCH_FLAG = '--test-bench';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad2 = (n) => String(n).padStart(2, '0');

// The game's own prefix: "[Wed Aug 19 19:23:03 2026] ". Local time, like the real log. A
// single-digit day is SPACE-padded ("[Fri Aug  1 ...]"), as the game writes it - see damageLines.js.
function eqTimestamp(date = new Date()) {
  return (
    `[${DAYS[date.getDay()]} ${MONTHS[date.getMonth()]} ${String(date.getDate()).padStart(2, ' ')} ` +
    `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())} ${date.getFullYear()}] `
  );
}

// A pasted line may already carry a timestamp (copied straight out of a log). Strip it so the line
// is stamped with NOW - an old stamp would confuse anything that measures time between lines.
const EXISTING_STAMP = /^\[\w{3} \w{3}\s+\d{1,2} \d{2}:\d{2}:\d{2} \d{4}\]\s*/;
function cleanLine(text) {
  if (typeof text !== 'string') return '';
  return text.replace(/[\r\n]+/g, ' ').replace(EXISTING_STAMP, '').trim().slice(0, MAX_LINE_LENGTH);
}

// Arguments for relaunching INTO the test copy (add the flag) or OUT of it (drop it), keeping
// whatever else the app was started with (in dev, `electron .` passes the app folder).
function relaunchArgs(argv, intoTestBench) {
  const rest = (argv || []).slice(1).filter((a) => a !== TEST_BENCH_FLAG);
  return intoTestBench ? [...rest, TEST_BENCH_FLAG] : rest;
}

class TestBench extends EventEmitter {
  /**
   * deps:
   *   store     { loadJson(key, fallback), saveJson(key, value) } - the TEST COPY's own store
   *   emitLine  (fullLine) => void - pushes one line onto the app's line bus
   *   setTimeoutFn / clearTimeoutFn / now - injectable for tests
   */
  constructor(deps) {
    super();
    this.d = {
      setTimeoutFn: setTimeout,
      clearTimeoutFn: clearTimeout,
      now: () => new Date(),
      ...deps,
    };
    this.timers = new Set();
  }

  // One line, now. Recorded in history unless it came from a preset (presets are buttons already).
  send(text, { record = true } = {}) {
    const line = cleanLine(text);
    if (!line) return { ok: false, error: 'Empty line' };
    this.d.emitLine(eqTimestamp(this.d.now()) + line);
    if (record) this._remember(line);
    return { ok: true, line };
  }

  // A preset: { lines: [{ text, delayMs }] }. Each line is sent delayMs after the PREVIOUS one, so
  // a preset reads like the real sequence ("cast", 3s later "lands").
  runPreset(preset) {
    const lines = Array.isArray(preset && preset.lines) ? preset.lines : [];
    if (!lines.length) return { ok: false, error: 'Preset has no lines' };
    let at = 0;
    for (const step of lines) {
      at += Math.max(0, Number(step.delayMs) || 0);
      if (at === 0) {
        this.send(step.text, { record: false });
        continue;
      }
      const t = this.d.setTimeoutFn(() => {
        this.timers.delete(t);
        this.send(step.text, { record: false });
      }, at);
      this.timers.add(t);
    }
    return { ok: true, count: lines.length };
  }

  // Lines still waiting in a running preset - dropped before a relaunch so none fire mid-exit.
  cancelPending() {
    for (const t of this.timers) this.d.clearTimeoutFn(t);
    this.timers.clear();
  }

  getHistory() {
    const h = this.d.store.loadJson(HISTORY_KEY, []);
    return Array.isArray(h) ? h.filter((x) => typeof x === 'string') : [];
  }

  // Newest first, no duplicates (re-sending moves a line back to the top), capped.
  _remember(line) {
    const next = [line, ...this.getHistory().filter((x) => x !== line)].slice(0, HISTORY_CAP);
    this.d.store.saveJson(HISTORY_KEY, next);
    this.emit('historyChanged', next);
  }

  removeHistory(line) {
    const next = this.getHistory().filter((x) => x !== line);
    this.d.store.saveJson(HISTORY_KEY, next);
    this.emit('historyChanged', next);
    return next;
  }

  clearHistory() {
    this.d.store.saveJson(HISTORY_KEY, []);
    this.emit('historyChanged', []);
    return [];
  }
}

module.exports = {
  TestBench,
  eqTimestamp,
  cleanLine,
  relaunchArgs,
  HISTORY_KEY,
  HISTORY_CAP,
  TEST_BENCH_FLAG,
};
