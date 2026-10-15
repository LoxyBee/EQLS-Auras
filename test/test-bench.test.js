'use strict';
/**
 * Test bench (dev builds only) - src/main/testBench.js. The owner's spec: test auras without being
 * in game, in a FULL BLANK SLATE (owner, 14 Oct - a profile "still shows all my old auras... not an
 * actual fresh setup"), send custom log lines, keep a history to resend, all from its own movable
 * window. Built as a separate test copy of the app: --test-bench restarts it on its own data folder.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const {
  TestBench, eqTimestamp, cleanLine, relaunchArgs, HISTORY_KEY, HISTORY_CAP, TEST_BENCH_FLAG,
} = require('../src/main/testBench');
const { stripTimestamp } = require('../src/main/buffParser');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

function makeBench() {
  const data = {};
  const store = {
    loadJson: (k, f) => (k in data ? JSON.parse(JSON.stringify(data[k])) : f),
    saveJson: (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); },
  };
  const lines = [];
  const timers = [];
  const bench = new TestBench({
    store,
    emitLine: (l) => lines.push(l),
    setTimeoutFn: (fn, ms) => { const t = { fn, ms, done: false }; timers.push(t); return t; },
    clearTimeoutFn: (t) => { t.done = true; },
    now: () => new Date(2026, 7, 1, 21, 5, 9), // Sat Aug 1 2026 21:05:09 local
  });
  const runTimers = () => timers.filter((t) => !t.done).forEach((t) => { t.done = true; t.fn(); });
  const texts = () => lines.map((l) => stripTimestamp(l));
  return { bench, data, lines, timers, runTimers, texts };
}

test('eqTimestamp writes the game\'s own prefix, space-padding a single-digit day', () => {
  const s = eqTimestamp(new Date(2026, 7, 1, 21, 5, 9));
  assert.equal(s, '[Sat Aug  1 21:05:09 2026] ');
  assert.equal(stripTimestamp(s + 'hello'), 'hello', 'the app\'s own parser must accept the stamp');
  assert.equal(eqTimestamp(new Date(2026, 9, 13, 9, 0, 0)), '[Tue Oct 13 09:00:00 2026] ');
});

test('cleanLine drops a pasted timestamp and line breaks', () => {
  assert.equal(cleanLine('[Wed Aug 19 19:23:03 2026] You feel agile.'), 'You feel agile.');
  assert.equal(cleanLine('  two\nlines  '), 'two lines');
  assert.equal(cleanLine(42), '');
});

test('relaunchArgs adds the flag going in, drops it coming out, keeps everything else', () => {
  const dev = ['C:/electron.exe', '.'];
  assert.deepEqual(relaunchArgs(dev, true), ['.', TEST_BENCH_FLAG]);
  assert.deepEqual(relaunchArgs([...dev, TEST_BENCH_FLAG], false), ['.']);
  assert.deepEqual(relaunchArgs([...dev, TEST_BENCH_FLAG], true), ['.', TEST_BENCH_FLAG], 'never doubled');
  // The installed app: argv is just the exe (+ the flag) - no app folder argument.
  const packaged = ['C:/Program Files/EQLS Auras/EQLS Auras.exe'];
  assert.deepEqual(relaunchArgs(packaged, true), [TEST_BENCH_FLAG]);
  assert.deepEqual(relaunchArgs([...packaged, TEST_BENCH_FLAG], false), [], 'back to a plain launch');
});

test('send: stamps the line with now and keeps a newest-first unique history', () => {
  const { bench, lines } = makeBench();
  bench.send('You feel agile.');
  bench.send('You feel very brave.');
  bench.send('You feel agile.');
  assert.equal(lines[0], '[Sat Aug  1 21:05:09 2026] You feel agile.');
  assert.deepEqual(bench.getHistory(), ['You feel agile.', 'You feel very brave.']);
  assert.equal(bench.send('   ').ok, false);
});

test('history is capped, and can be pruned or cleared', () => {
  const { bench, data } = makeBench();
  for (let i = 0; i < HISTORY_CAP + 5; i += 1) bench.send(`line ${i}`);
  assert.equal(bench.getHistory().length, HISTORY_CAP);
  assert.equal(bench.getHistory()[0], `line ${HISTORY_CAP + 4}`);
  bench.removeHistory(`line ${HISTORY_CAP + 4}`);
  assert.equal(bench.getHistory()[0], `line ${HISTORY_CAP + 3}`);
  bench.clearHistory();
  assert.deepEqual(data[HISTORY_KEY], []);
});

test('runPreset: sends in order with each delay after the previous line; presets stay out of history', () => {
  const { bench, timers, runTimers, texts } = makeBench();
  const r = bench.runPreset({ lines: [{ text: 'a', delayMs: 0 }, { text: 'b', delayMs: 3000 }, { text: 'c', delayMs: 2000 }] });
  assert.equal(r.ok, true);
  assert.deepEqual(texts(), ['a'], 'the first line goes at once');
  assert.deepEqual(timers.map((t) => t.ms), [3000, 5000], 'delays add up line by line');
  runTimers();
  assert.deepEqual(texts(), ['a', 'b', 'c']);
  assert.deepEqual(bench.getHistory(), []);
});

test('cancelPending drops lines still waiting in a preset (done before a restart)', () => {
  const { bench, runTimers, texts } = makeBench();
  bench.runPreset({ lines: [{ text: 'cast', delayMs: 0 }, { text: 'lands', delayMs: 3000 }] });
  bench.cancelPending();
  runTimers();
  assert.deepEqual(texts(), ['cast']);
});

test('every preset in the shipped file has a group, a label and at least one line', () => {
  const { presets } = JSON.parse(read('src', 'shared', 'data', 'test-bench-presets.json'));
  assert.ok(presets.length > 0);
  for (const p of presets) {
    assert.ok(p.group && p.label, JSON.stringify(p));
    assert.ok(Array.isArray(p.lines) && p.lines.length, `${p.label}: no lines`);
    for (const l of p.lines) {
      assert.equal(typeof l.text, 'string', `${p.label}: a line without text`);
      assert.equal(cleanLine(l.text), l.text, `${p.label}: "${l.text}" should be written without a timestamp`);
    }
  }
});

test('a bench-stamped line goes through the real buff engine and lands', () => {
  const data = {};
  const store = {
    loadJson: (k, f) => (k in data ? JSON.parse(JSON.stringify(data[k])) : f),
    saveJson: (k, v) => { data[k] = JSON.parse(JSON.stringify(v)); },
  };
  const buffStore = new BuffStore(store);
  buffStore.upsert('Test Bench Ward', 600, { landingText: 'A test ward settles on you.', endedText: 'The test ward fades.' });
  const engine = new BuffEngine(buffStore, store);
  engine.stop();
  engine.handleLine(eqTimestamp() + 'You begin casting Test Bench Ward.');
  engine.handleLine(eqTimestamp() + 'A test ward settles on you.');
  assert.deepEqual(engine.getActiveBuffs().map((b) => b.name), ['Test Bench Ward']);
});

test('wiring: a separate data folder, chosen before anything reads the real one', () => {
  const mainSrc = read('src', 'main', 'main.js');
  const pin = mainSrc.indexOf("app.setPath('userData', path.join(app.getPath('appData'), 'EQ Buff Tracker'));");
  const mode = mainSrc.indexOf(`const TEST_BENCH_MODE = process.argv.includes('${TEST_BENCH_FLAG}');`);
  const sandbox = mainSrc.indexOf("app.setPath('userData', path.join(app.getPath('appData'), 'EQ Buff Tracker (Test bench)'));");
  const firstLocalRequire = mainSrc.search(/^(?!\s*\/\/).*require\(['"]\.\.?\//m); // skipping comments
  assert.ok(pin >= 0 && mode > pin && sandbox > mode, 'the real pin first, then the test-copy switch');
  assert.ok(sandbox < firstLocalRequire, 'the test copy must be chosen before any store can read the real folder');
  for (const never of ['widgets.json', 'profiles.json', 'actionBars.json', 'sessionRestore.json', 'ambiguousResolutions.json']) {
    const seed = mainSrc.slice(mainSrc.indexOf('const SEED = ['), mainSrc.indexOf('];', mainSrc.indexOf('const SEED = [')));
    assert.ok(!seed.includes(`'${never}'`), `${never} must never be copied into the test copy`);
  }
});

test('wiring: the test copy ignores real log lines and never touches the real Logs folder', () => {
  const mainSrc = read('src', 'main', 'main.js');
  assert.match(mainSrc, /if \(TEST_BENCH_MODE && !isTest\) return;/, 'real lines reach no engine in the test copy');
  assert.match(mainSrc, /logService\.watcher\.emit\('line', line, \{ test: true \}\)/);
  assert.match(mainSrc, /function runLogRotation\(why\) \{\s*if \(TEST_BENCH_MODE\) return;/);
  assert.match(mainSrc, /ipcMain\.handle\('lockouts:trim', async \(\) => \{\s*if \(TEST_BENCH_MODE\) return/);
  assert.match(mainSrc, /ipcMain\.handle\('log:archiveNow', async \(\) => \{\s*if \(TEST_BENCH_MODE\) return/);
  assert.match(mainSrc, /new LogService\(\{ testBenchMode: TEST_BENCH_MODE \}\)/);
  const ls = read('src', 'main', 'logService.js');
  assert.match(ls, /if \(status\.currentFilePath && !this\.testBenchMode\) \{\s*this\.splitter\.attachToFile/, 'no splitting in the test copy');
  const html = read('src', 'renderer', 'main-window', 'index.html');
  assert.match(html, /id="test-bench-btn"\s+style="display:none"/, 'hidden until the main process says it exists');
});

// Fix 1 (owner, 15 Oct): the lock is keyed on the userData folder, so the test copy - which has
// its own folder - used to take a DIFFERENT lock, letting the real app and the test copy run at
// once (two sets of overlays, two log watchers). Taking it before the repoint makes them share it.
test('the real setup and the test copy share ONE single-instance lock', () => {
  const mainSrc = read('src', 'main', 'main.js');
  const lock = mainSrc.indexOf('const GOT_SINGLE_INSTANCE_LOCK = app.requestSingleInstanceLock();');
  const sandbox = mainSrc.indexOf("app.setPath('userData', path.join(app.getPath('appData'), 'EQ Buff Tracker (Test bench)'));");
  assert.ok(lock >= 0, 'the lock must be taken at the top of main.js');
  assert.ok(lock < sandbox, 'taken against the REAL folder, before the test copy repoints userData');
  assert.equal(mainSrc.split('app.requestSingleInstanceLock()').length - 1, 1, 'exactly one lock request');
  assert.ok(mainSrc.includes('if (!GOT_SINGLE_INSTANCE_LOCK) {\n  app.quit();\n  return;\n}'), 'a rejected launch quits at once');
  assert.ok(mainSrc.includes('if (TEST_BENCH_MODE && GOT_SINGLE_INSTANCE_LOCK) {\n  const SEED'), 'a rejected launch copies nothing');
});

test('shipping: shown via Log -> Diagnostics (on in dev, off installed), always shown inside the test copy', () => {
  const mainSrc = read('src', 'main', 'main.js');
  assert.ok(mainSrc.includes("return TEST_BENCH_MODE || loadJson('testBenchEnabled', !app.isPackaged) === true;"));
  assert.ok(mainSrc.includes('(into && !testBenchAvailable())'), 'cannot be entered while switched off');
  assert.ok(!mainSrc.includes('TEST_BENCH_MODE = !app.isPackaged'), 'no longer dev-only');
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="test-bench-enabled-checkbox"/);
});

module.exports = () => report('test-bench');
if (require.main === module) report('test-bench').then((n) => process.exit(n ? 1 : 0));
