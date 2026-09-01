'use strict';
/**
 * Share codes are pasted out of chat (shareCodeChat's "Look at it" prompt). The only guard before
 * this was on WHO applies a code, never WHAT is in it. A payload with `customTimers: [null]` passed
 * `Array.isArray` in normalizeWidget, reached customTimerEngine, threw
 * "Cannot read properties of null (reading 'triggerText')" on the shared log-line bus, and silently
 * took out every consumer downstream of it - damage meter, raid board, lockouts, ... - once per
 * line. Also: a shrinking log file made logWatcher replay its whole contents as live lines.
 *
 * Verified by eq-tracker-89's audit (repros in %TEMP%/eqls-bug-repro). These pin the fixes.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { test, report } = require('./harness');
const {
  WidgetStore, normalizeWidget, sanitizeCustomTimers, stringList, SHARE_CODE_PREFIX,
} = require('../src/main/widgetStore');
const { CustomTimerEngine } = require('../src/main/customTimerEngine');
const { LogWatcher } = require('../src/main/logWatcher');

// ---------------------------------------------------------------------------
// P1(a) - normalizeWidget sanitises the list fields element by element
// ---------------------------------------------------------------------------

test('sanitizeCustomTimers drops null / non-object / id-less elements, keeps valid ones', () => {
  const kept = { id: 'a', name: 'A', triggerText: 'zap', triggerMatch: 'contains', durationSec: 10 };
  const r = sanitizeCustomTimers([null, 'a string', 42, [], {}, { name: 'no id' }, kept]);
  assert.deepEqual(r.map((t) => t.id), ['a']);
  assert.equal(r[0].durationSec, 10);
});

test('sanitizeCustomTimers clamps a timer\'s numeric fields (P3)', () => {
  const mk = (durationSec) => sanitizeCustomTimers([{ id: 'x', durationSec }])[0].durationSec;
  assert.equal(mk('abc'), 5, 'a string -> the default');
  assert.equal(mk(1e999), 5, 'Infinity -> the default');
  assert.equal(mk(-30), 0, 'negative floors at 0');
  assert.equal(mk(999999999), 3600, 'a 31-year timer -> the 1h ceiling');
  assert.equal(mk(0), 0, '0 is legitimate (a timer that only makes a noise)');
  assert.equal(sanitizeCustomTimers([{ id: 'x', cooldownSec: 'nope' }])[0].cooldownSec, 0);
});

test('stringList keeps only non-empty strings', () => {
  assert.deepEqual(stringList(['Mez', '', null, 42, {}, 'Charm']), ['Mez', 'Charm']);
  assert.deepEqual(stringList('not an array'), []);
  assert.deepEqual(stringList(undefined), []);
});

test('normalizeWidget runs both sanitisers on a widget', () => {
  const w = normalizeWidget({
    id: 'w', name: 'W', kind: 'custom', buffFilterMode: 'explicit',
    buffNames: ['Real', null, 7],
    excludedBuffNames: [{}, 'AlsoReal'],
    customTimers: [null, { id: 't', triggerText: 'x', durationSec: 'abc' }],
  });
  assert.deepEqual(w.buffNames, ['Real']);
  assert.deepEqual(w.excludedBuffNames, ['AlsoReal']);
  assert.deepEqual(w.customTimers.map((t) => t.id), ['t']);
  assert.equal(w.customTimers[0].durationSec, 5);
});

// ---------------------------------------------------------------------------
// End to end: a hostile share code no longer breaks the log pipeline
// ---------------------------------------------------------------------------

function makeStore() {
  const data = {};
  return new WidgetStore({
    loadJson: (n, f) => (n in data ? JSON.parse(JSON.stringify(data[n])) : f),
    saveJson: (n, v) => { data[n] = JSON.parse(JSON.stringify(v)); },
  });
}
const mkCode = (payload) =>
  SHARE_CODE_PREFIX + zlib.deflateRawSync(Buffer.from(JSON.stringify(payload), 'utf8')).toString('base64');

test('importing `customTimers: [null]` creates a widget the engine can process without throwing', () => {
  const store = makeStore();
  const w = store.importCode(mkCode({ name: 'Hostile', kind: 'custom', buffSource: 'customTimer', customTimers: [null] }), {});
  assert.ok(w, 'the code should still import');
  assert.deepEqual(w.customTimers, [], 'the null element was dropped');

  const cte = new CustomTimerEngine();
  cte.stop();
  cte.setGetWidgetsFn(() => store.getAll());
  assert.doesNotThrow(() => cte.handleLine('[Wed Aug 19 20:15:02 2026] You have entered Befallen.'));
});

test('a zoneEnter trigger still fires after a hostile widget is present (not left torn)', () => {
  const store = makeStore();
  store.importCode(mkCode({ name: 'Bad', kind: 'custom', buffSource: 'customTimer', customTimers: [null] }), {});
  const good = store.importCode(mkCode({
    name: 'ZoneT', kind: 'custom', buffSource: 'customTimer',
    customTimers: [{ id: 'z', name: 'ZoneT', triggerText: 'Befallen', triggerMatch: 'zoneEnter', durationSec: 30 }],
  }), {});
  assert.ok(good.customTimers.length === 1);

  const cte = new CustomTimerEngine();
  cte.stop();
  cte.setGetWidgetsFn(() => store.getAll());
  cte.handleLine('[Wed Aug 19 20:15:02 2026] You have entered Befallen.');
  assert.ok(cte.getActive().some((t) => t.name === 'ZoneT'), 'the zone trigger was lost to the torn line');
});

test('applyCodeToSelfBuffs sanitises too (a self-buffs code routes THERE, not through importCode)', () => {
  const store = makeStore();
  const hostile = mkCode({
    name: 'Looks Harmless', kind: 'self-buffs-builtin',
    customTimers: [null], buffNames: [null, 42], excludedBuffNames: [{}],
  });
  // importCode refuses a self-buffs code by design, so the UI routes it to applyCodeToSelfBuffs -
  // the path that used to bypass normalizeWidget entirely.
  assert.equal(store.importCode(hostile, {}), null, 'importCode should still refuse a self-buffs code');

  const w = store.applyCodeToSelfBuffs(hostile);
  assert.deepEqual(w.customTimers, [], 'the null timer reached the un-deletable Self Buffs aura');
  assert.deepEqual(w.buffNames, []);
  assert.deepEqual(w.excludedBuffNames, []);

  const cte = new CustomTimerEngine();
  cte.stop();
  cte.setGetWidgetsFn(() => store.getAll());
  assert.doesNotThrow(() => cte.handleLine('[Wed Aug 19 20:15:02 2026] You have entered Befallen.'));
});

test('customTimerEngine skips a null timer element defensively, whichever store path fed it', () => {
  const cte = new CustomTimerEngine();
  cte.stop();
  cte.setGetWidgetsFn(() => [{ id: 'x', customTimers: [null, { id: 't', triggerText: 'zap', triggerMatch: 'contains' }] }]);
  assert.doesNotThrow(() => cte.handleLine('[ts] zap'));
});

// ---------------------------------------------------------------------------
// P2 - logWatcher must not replay when the file shrinks
// ---------------------------------------------------------------------------

test('a log file shrinking to a smaller non-zero size does NOT re-emit its contents', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqlw-'));
  const log = path.join(dir, 'eqlog_Tester_server.txt');
  fs.writeFileSync(log, Array.from({ length: 400 }, (_, i) => `[Wed Aug 19 20:15:02 2026] history ${i}`).join('\n') + '\n');

  const w = new LogWatcher();
  const seen = [];
  w.on('line', (l) => seen.push(l));
  w.start(dir);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(seen.length, 0, 'history must never replay on start');

  fs.appendFileSync(log, '[Wed Aug 19 20:15:03 2026] live one\n');
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(seen.length, 1);
  seen.length = 0;

  // external truncation to a smaller, non-zero file
  fs.writeFileSync(log, Array.from({ length: 200 }, (_, i) => `[Wed Aug 19 20:15:04 2026] kept ${i}`).join('\n') + '\n');
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(seen.length, 0, `${seen.length} lines re-emitted after a shrink - the watcher replayed history`);

  // a genuinely new line after the shrink is still picked up
  fs.appendFileSync(log, '[Wed Aug 19 20:15:05 2026] live two\n');
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(seen, ['[Wed Aug 19 20:15:05 2026] live two']);

  w.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// P1(b) - each log-line listener is isolated so one throwing can't stop the rest
// ---------------------------------------------------------------------------

test('every engine log-line listener goes through the isolating onLogLine wrapper', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /function onLogLine\(label, fn\) \{[\s\S]*?try \{[\s\S]*?catch \(err\)/, 'onLogLine does not try/catch the handler');
  assert.match(main, /_lineHandlerFaults\.has\(sig\)/, 'a repeat fault is not de-duplicated - it would spam once per line');
  assert.match(main, /recordCrash\(`lineHandler\[\$\{label\}\]`/, 'a fault is not surfaced anywhere');
  // the engine handlers use it, not a bare watcher.on('line')
  for (const eng of ['buffEngine', 'customTimerEngine', 'damageEngine', 'raidNamedTracker', 'lockoutService']) {
    assert.match(main, new RegExp(`onLogLine\\('${eng}'`), `${eng} is not wrapped`);
  }
  const bare = main.match(/logService\.watcher\.on\('line'/g) || [];
  assert.equal(bare.length, 1, `expected exactly one raw watcher.on('line') (inside onLogLine), found ${bare.length}`);
});

test('crash.log is rolled at a size cap (P4)', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.match(main, /CRASH_LOG_MAX_BYTES/);
  assert.match(main, /statSync\(p\)\.size > CRASH_LOG_MAX_BYTES\) fs\.renameSync/);
});

module.exports = () => report('share-code-hardening');
if (require.main === module) report('share-code-hardening').then((n) => process.exit(n ? 1 : 0));
