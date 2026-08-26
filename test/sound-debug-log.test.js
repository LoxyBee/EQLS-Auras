'use strict';
/**
 * A debug line every time an alert sound actually plays - added to help answer "is the ~half
 * second between doing something in game and the app catching up the log-poll interval, or is
 * the app itself slow?" A land/expire/warning beep is the one observable event a player can time
 * against their own action, so timestamping it precisely is what turns that question into a
 * measurement instead of a guess.
 *
 * Routes through the SAME debugLog()/Diagnostics toggle every other detection line already uses
 * (see custom-timer-debug-log.test.js, detection.test.js) rather than a new mechanism - an overlay
 * window is a renderer with no filesystem access, so it needs an IPC hop main.js's debugLog()
 * doesn't need for itself. Every hop has to exist or the call throws: preload bridge, then main
 * handler, then the actual call site in playAlertSound - same shape as text-aura.test.js's own
 * "every hop of the wiring exists" check.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

const overlaySrc = read('src', 'renderer', 'overlay', 'overlay.js');
const preloadSrc = read('src', 'preload', 'preload-overlay.js');
const mainSrc = read('src', 'main', 'main.js');

test('the preload bridge exposes debugLog and sends on a real channel', () => {
  assert.match(
    preloadSrc,
    /debugLog: \(message\) => \{\s*\n\s*ipcRenderer\.send\('debug:logLine', message\);/,
    'debugLog is missing from the overlay preload bridge, or no longer sends on debug:logLine'
  );
});

test('the main process handler routes the line into the SAME debugLog() every detection line uses', () => {
  assert.match(
    mainSrc,
    /ipcMain\.on\('debug:logLine', \(_event, message\) => debugLog\(message\)\);/,
    "the handler is missing, or no longer forwards into debugLog() - it would either throw when " +
      "the overlay calls it, or silently write somewhere the Diagnostics toggle/log-folder button " +
      "don't know about"
  );
});

test('playAlertSound actually calls the bridge, only for a sound that really plays', () => {
  const fn = overlaySrc.match(/function playAlertSound\(kind\) \{([\s\S]*?)\n\}/);
  assert.ok(fn, 'playAlertSound has been restructured');
  const body = fn[1];
  assert.match(
    body,
    /window\.eqOverlay\.debugLog\(`SOUND \$\{kind\}/,
    'the debug line is missing, or no longer names which kind of alert fired'
  );
  const audibleAt = body.indexOf('if (!audible) return;');
  const debounceAt = body.indexOf('if (lastPlayed !== undefined');
  const logAt = body.indexOf('window.eqOverlay.debugLog(');
  assert.ok(audibleAt >= 0 && debounceAt >= 0 && logAt >= 0, 'one of the three landmarks moved');
  // Must come after both bail-outs, or muting the aura (or a debounced duplicate) would still log
  // a line claiming a sound played when nothing was actually heard.
  assert.ok(audibleAt < logAt, 'the debug line is logged even while the aura is muted');
  assert.ok(debounceAt < logAt, 'the debug line is logged even for a play the debounce just suppressed');
});

test('the debug line carries millisecond precision - the whole point, since the shared prefix only has seconds', () => {
  const fn = overlaySrc.match(/function playAlertSound\(kind\) \{([\s\S]*?)\n\}/);
  assert.ok(fn);
  assert.match(
    fn[1],
    /String\(now % 1000\)\.padStart\(3, '0'\)/,
    'no millisecond suffix is being computed - without it this line is no more precise than every other debugLog call'
  );
});

module.exports = () => report('sound-debug-log');
if (require.main === module) report('sound-debug-log').then((n) => process.exit(n ? 1 : 0));
