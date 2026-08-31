'use strict';
/**
 * Where the detection log lives - Vaela, 23 August.
 *
 * She said: "I cannot provide this currently as that log file doesn't exist. it should probably be
 * created as an actual file in it's own folder, that updates and is split per day."
 *
 * IT DID EXIST, and that is the more useful finding. It was a single loose file in
 * %APPDATA%/EQ Buff Tracker, sitting among Cache, Code Cache, DawnGraphiteCache, DawnWebGPUCache,
 * GPUCache, Local Storage, Network and Preferences. Note 28 stayed blocked for days waiting on a
 * file that had been written the whole time, because nobody could reasonably be expected to find
 * it. A log nobody can reach is a log that does not exist, and treating her report as wrong
 * because a file was technically present would have missed the actual problem.
 *
 * So: its own folder, one file per day, old ones pruned, and a button in the app that opens the
 * folder - plus the path in plain text beside it, so it can be reached when the app is not running.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const mainSrc = read('src', 'main', 'main.js');
const preloadSrc = read('src', 'preload', 'preload-main.js');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const html = read('src', 'renderer', 'main-window', 'index.html');

// The date-stamp helper, which decides which file a line lands in. Small enough to reproduce, and
// pinned against the source below - the one thing it must get right is being LOCAL.
const stamp = (d) => {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

test('it has a folder of its own, not a loose file beside Chromium caches', () => {
  assert.match(mainSrc, /const DEBUG_LOG_DIR = path\.join\(app\.getPath\('userData'\), 'detection-logs'\);/);
  assert.match(mainSrc, /fs\.mkdirSync\(DEBUG_LOG_DIR, \{ recursive: true \}\)/);
});

test('one file per day, named by the date', () => {
  assert.match(mainSrc, /`detection-\$\{stamp\}\.log`/, 'the filename does not carry the date');
  const fn = mainSrc.match(/function debugLog\(message\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'debugLog has been restructured');
  assert.match(fn[1], /if \(stamp !== debugLogStamp\)/, 'the file never rolls over to a new day');
  assert.match(fn[1], /fs\.appendFileSync\(debugLogPath/);
});

test('the date is local, so an evening lands in that evening', () => {
  // An ISO/UTC stamp would put a British player's late-evening lines into tomorrow's file, which
  // is exactly when someone is most likely to go looking for them.
  const fn = mainSrc.match(/function debugLogDateStamp\(d\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'debugLogDateStamp has been renamed');
  assert.match(fn[1], /getFullYear\(\)/);
  assert.doesNotMatch(fn[1], /toISOString|getUTC/, 'the stamp is UTC, so evenings land in the wrong day');

  // And it produces what the filename pattern expects.
  assert.match(stamp(new Date(2026, 7, 3)), /^2026-08-03$/);
});

test('old files are pruned, and only ones this app wrote', () => {
  assert.match(mainSrc, /const DEBUG_LOG_KEEP_DAYS = \d+;/);
  const fn = mainSrc.match(/function pruneOldDebugLogs\(\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'pruneOldDebugLogs has been renamed');
  // Anchored filename test - deleting by extension alone would remove whatever else a user had
  // put in that folder.
  assert.match(fn[1], /\^detection-/, 'the prune is not anchored to this app\'s own filenames');
  assert.match(fn[1], /mtimeMs < cutoff/);
});

test('an existing loose file is moved in, not deleted', () => {
  // It may be the very thing someone is looking for - note 28's evidence would have been in it.
  const block = mainSrc.match(/const legacy = path\.join[\s\S]*?\n\} catch/);
  assert.ok(block, 'the migration of the old single file is gone');
  assert.match(block[0], /fs\.renameSync\(legacy, dest\)/);
  assert.match(block[0], /fs\.appendFileSync\(dest, fs\.readFileSync\(legacy\)\)/,
    'a same-day collision would lose the old contents');
});

test('there is a way to reach it from inside the app', () => {
  // The whole point. It was findable in principle before and nobody found it.
  assert.match(mainSrc, /ipcMain\.handle\('debug:openLogFolder'/);
  assert.match(mainSrc, /shell\.openPath\(DEBUG_LOG_DIR\)/);
  assert.match(mainSrc, /require\('electron'\)/);
  assert.match(mainSrc, /globalShortcut, shell \}/, 'shell is used but never imported');
  assert.match(preloadSrc, /openDebugLogFolder:/);
  assert.match(html, /id="open-debug-log-folder-btn"/);
  assert.match(rendererSrc, /openDebugLogFolderBtn\.addEventListener\('click'/);
});

test('the path is shown as text too', () => {
  // So it can be reached when the app is not running - which is the state it is in after the kind
  // of crash someone would be investigating.
  assert.match(html, /id="debug-log-folder-path"/);
  assert.match(preloadSrc, /getDebugLogFolder:/);
  assert.match(mainSrc, /ipcMain\.handle\('debug:logFolder'/);
  assert.match(rendererSrc, /getDebugLogFolder\(\)\.then/);
});

test('a write failure still cannot break detection', () => {
  // Unchanged from before, and worth keeping pinned: this runs on every detection decision.
  const fn = mainSrc.match(/function debugLog\(message\) \{([\s\S]*?)\n\}/)[1];
  assert.match(fn, /catch \{/, 'a logging failure would now throw into the detection path');
  assert.match(fn, /broadcast\('debug:line', line\)/, 'the live feed stopped being fed');
});

// ---------------------------------------------------------------------------
// The manual enable toggle - Vaela, 25 August
// ---------------------------------------------------------------------------
//
// "should there be a debug log of every aura that is fired/loaded/ended?... add it to the log,
// behind a toggle, i will enable it manually for myself, under diagnostics." This log used to run
// unconditionally on every launch with no way to turn it off; now it defaults OFF and needs a
// deliberate opt-in, and customTimerEngine (custom triggers) feeds the exact same function
// buffEngine already did, closing the actual gap that made the last two live-reported bugs
// (OR-mode filtering, {mob} resolution) both hard to root-cause from the outside.

test('the log is off by default and gated behind a persisted setting', () => {
  const fn = mainSrc.match(/function debugLog\(message\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'debugLog has been restructured');
  assert.match(fn[1], /if \(!debugLogEnabled\) return;/, 'the toggle no longer actually gates anything');
  assert.match(mainSrc, /let debugLogEnabled = loadJson\('debugLogEnabled', false\)/, 'the default flipped to on, or stopped persisting');
});

test('the toggle is wired end to end: IPC, preload, and the Diagnostics checkbox', () => {
  assert.match(mainSrc, /ipcMain\.handle\('debug:getEnabled', \(\) => debugLogEnabled\)/);
  assert.match(mainSrc, /ipcMain\.handle\('debug:setEnabled'/);
  assert.match(mainSrc, /saveJson\('debugLogEnabled', debugLogEnabled\)/, 'a toggle that does not persist reverts on every restart');
  assert.match(preloadSrc, /getDebugLogEnabled:/);
  assert.match(preloadSrc, /setDebugLogEnabled:/);
  assert.match(html, /id="debug-log-enabled-checkbox"/);
  assert.match(html, /Enable detection log/);
  assert.match(rendererSrc, /debugLogEnabledCheckbox\.addEventListener\('change'/);
  assert.match(rendererSrc, /window\.eqTracker\.setDebugLogEnabled\(debugLogEnabledCheckbox\.checked\)/);
});

test('it lives under the existing Diagnostics section, not a new one', () => {
  const diagnosticsBlock = html.slice(html.indexOf('>Diagnostics<'), html.indexOf('>Diagnostics<') + 3000);
  assert.match(diagnosticsBlock, /id="debug-log-enabled-checkbox"/, 'the checkbox is not actually inside Diagnostics');
});

test('customTimerEngine feeds the same function buffEngine does, not a second unwired log', () => {
  assert.match(mainSrc, /buffEngine\.setDebugLogFn\(debugLog\)/);
  assert.match(mainSrc, /customTimerEngine\.setDebugLogFn\(debugLog\)/);
});

module.exports = () => report('detection-log-file');
if (require.main === module) report('detection-log-file').then((n) => process.exit(n ? 1 : 0));
