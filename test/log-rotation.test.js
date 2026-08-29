'use strict';
/**
 * Weekly log rotation at the lockout reset.
 *
 * This is the one piece of this app that MODIFIES THE USER'S GAME FILES on a schedule, without
 * being asked each time. Everything here is written on that basis: the archive is proved to exist
 * and to match before the original is touched, an already-rotated week is never rotated twice, and
 * a failure of any kind leaves the live log exactly as it was.
 *
 * Nothing is destroyed. The log is copied to `Logs/Archive/` and the copy is verified; the original
 * is then emptied, not deleted, because EverQuest holds it open while running.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const {
  LogRotationService,
  resetBoundaryBefore,
  boundaryKey,
  archiveNameFor,
  RESET_WEEKDAY,
  RESET_HOUR,
} = require('../src/main/logRotation');
const { extractTimestampMs } = require('../src/main/logSplitter');

const LINE = '[Sat Aug 29 10:00:00 2026] You have slain Lady Vox!';

function tempLogs(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-rot-'));
  for (const [name, body] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), body, 'utf8');
  }
  return dir;
}
const svc = (dir, opts) => {
  const s = new LogRotationService(opts);
  s.setLogsFolderFn(() => dir);
  return s;
};
const archived = (dir) => {
  const a = path.join(dir, 'Archive');
  return fs.existsSync(a) ? fs.readdirSync(a).sort() : [];
};

// ---------------------------------------------------------------------------
// The boundary, which is a measurement
// ---------------------------------------------------------------------------

// Tuesday 11:00. Two Alt+Z readings 10.84 h apart landed 6 s from each other and both within 18 s
// of 11:00:00 on Tuesday 1 September 2026.
test('the reset is Tuesday at 11:00, and that is where the constants point', () => {
  assert.equal(RESET_WEEKDAY, 2);
  assert.equal(RESET_HOUR, 11);
});

test('the boundary is the most recent Tuesday 11:00 at or before now', () => {
  const at = (y, m, d, h, mi) => resetBoundaryBefore(new Date(y, m, d, h, mi, 0));
  const key = (b) => boundaryKey(b) + ' ' + b.getHours() + ':00';
  assert.equal(key(at(2026, 7, 29, 11, 20)), '2026-08-25 11:00', 'Saturday looks back to Tuesday');
  assert.equal(key(at(2026, 8, 2, 3, 0)), '2026-09-01 11:00', 'Wednesday looks back one day');
  assert.equal(key(at(2026, 8, 7, 23, 59)), '2026-09-01 11:00', 'the Monday before the next reset');
});

// The hour matters as much as the day, and this is the case a weekday-only rule gets wrong.
test('Tuesday BEFORE 11:00 still belongs to last week', () => {
  const before = resetBoundaryBefore(new Date(2026, 8, 1, 10, 59, 0));
  const after = resetBoundaryBefore(new Date(2026, 8, 1, 11, 1, 0));
  assert.equal(boundaryKey(before), '2026-08-25', 'a Tuesday morning is still the old period');
  assert.equal(boundaryKey(after), '2026-09-01');
});

test('11:00:00 exactly belongs to the new week', () => {
  assert.equal(boundaryKey(resetBoundaryBefore(new Date(2026, 8, 1, 11, 0, 0))), '2026-09-01');
});

// Local wall clock, so the daylight-saving change on 1 November is a non-event: the boundary stays
// at "11:00 as the clock reads" and moves itself. If this ever breaks, the fix is in the header of
// logRotation.js, not here.
test('the boundary survives the daylight-saving change', () => {
  // This test used to be a placebo. It sampled 28 October (look back one day) and 3 November (look
  // back none), so neither look-back ever crossed the 1 November transition it was named for -
  // and three mutations that replaced the calendar arithmetic with fixed 24-hour days survived it.
  // The look-back has to STRADDLE the change for the test to mean anything.
  const at = (y, m, d, h, mi) => resetBoundaryBefore(new Date(y, m, d, h, mi, 0));
  const shows = (b) => boundaryKey(b) + ' ' + b.getHours() + ':' + String(b.getMinutes()).padStart(2, '0');

  // Monday 2 November, looking back past Sunday 1 November's fall-back to Tuesday 27 October.
  assert.equal(shows(at(2026, 10, 2, 9, 0)), '2026-10-27 11:00');
  // Tuesday 3 November before the reset hour: still the week that opened before the change.
  assert.equal(shows(at(2026, 10, 3, 10, 0)), '2026-10-27 11:00');
  // Tuesday 3 November after it: the new week, still at 11:00 as the clock on the wall reads.
  assert.equal(shows(at(2026, 10, 3, 11, 30)), '2026-11-03 11:00');

  // And the spring-forward direction: Monday 9 March looking back past Sunday 8 March.
  assert.equal(shows(at(2026, 2, 9, 9, 0)), '2026-03-03 11:00');
  assert.equal(shows(at(2026, 2, 10, 12, 0)), '2026-03-10 11:00');

  // The wall clock is what is held fixed, so a week containing a transition is not 168 real hours.
  // Stated here because it looks like a bug to anyone who checks, and it is the correct answer.
  const fallBack = at(2026, 10, 3, 12, 0) - at(2026, 9, 27, 12, 0);
  assert.equal(fallBack / 3600000, 169, 'a fall-back week is 169 real hours, and that is right');
  const springFwd = at(2026, 2, 10, 12, 0) - at(2026, 2, 3, 12, 0);
  assert.equal(springFwd / 3600000, 167, 'a spring-forward week is 167 real hours, and that is right');
});

// boundaryKey names the LOCAL day. Built from UTC fields it would be identical in Eastern time for
// every hour of the year and wrong on every single day for anyone at UTC+12 or beyond - a mutation
// no run on this machine can catch, because Node on Windows ignores TZ. Read the source instead.
test('the week is named from local fields, never UTC ones', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'logRotation.js'), 'utf8');
  const start = source.indexOf('function boundaryKey');
  assert.ok(start > -1, 'boundaryKey is gone - this test needs rewriting');
  const body = source.slice(start, source.indexOf('\n}', start));
  assert.ok(!/getUTC/.test(body), 'boundaryKey reads UTC fields, which names the wrong day east of UTC+11');
  assert.ok(/getFullYear|getMonth|getDate/.test(body), 'boundaryKey no longer reads local fields at all');
});

// ---------------------------------------------------------------------------
// Rotating
// ---------------------------------------------------------------------------

test('every character rotates, not just the one being watched', () => {
  const dir = tempLogs({
    'eqlog_Avenrae_rivervale.txt': LINE,
    'eqlog_Shara_rivervale.txt': LINE,
    'eqlog_Third_rivervale.txt': LINE,
  });
  const r = svc(dir).rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(r.rotated.length, 3);
  assert.equal(archived(dir).length, 3);
  for (const name of ['eqlog_Avenrae_rivervale.txt', 'eqlog_Shara_rivervale.txt']) {
    assert.equal(fs.statSync(path.join(dir, name)).size, 0, `${name} was not emptied`);
  }
});

test('the archive holds the log, byte for byte, before the original is emptied', () => {
  const body = LINE + '\r\n' + LINE + '\r\n';
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': body });
  svc(dir).rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  const a = path.join(dir, 'Archive', archived(dir)[0]);
  assert.equal(fs.readFileSync(a, 'utf8'), body, 'the archive is not the log that was emptied');
  assert.equal(fs.statSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt')).size, 0);
});

test('the archive is named after the week it closes', () => {
  assert.equal(
    archiveNameFor('eqlog_Avenrae_rivervale.txt', new Date(2026, 8, 1, 11, 0, 0)),
    'eqlog_Avenrae_rivervale_week_2026-09-01.txt'
  );
});

// The archive's own name is the record of whether this week was done. No marker file, so an
// unreadable settings file cannot cause a second rotation mid-week - which matters, because this
// app currently answers an unreadable settings file by returning defaults.
test('a second run in the same week does nothing', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  const now = new Date(2026, 8, 2, 12, 0, 0);
  const s = svc(dir);
  assert.equal(s.rotateIfDue(now).rotated.length, 1);

  fs.appendFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), LINE);
  const second = s.rotateIfDue(now);
  assert.equal(second.rotated.length, 0);
  assert.deepEqual(second.skippedAlreadyDone, ['eqlog_Avenrae_rivervale.txt']);
  assert.ok(fs.statSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt')).size > 0, 'this week was emptied twice');
});

test('a fresh service instance also knows the week was done', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  const now = new Date(2026, 8, 2, 12, 0, 0);
  svc(dir).rotateIfDue(now);
  fs.appendFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), LINE);
  // A restart must not re-rotate: the filesystem, not memory, is the record.
  assert.equal(svc(dir).rotateIfDue(now).rotated.length, 0);
});

test('the next week does rotate', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  const s = svc(dir);
  s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  fs.appendFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), LINE);
  assert.equal(s.rotateIfDue(new Date(2026, 8, 9, 12, 0, 0)).rotated.length, 1);
  assert.deepEqual(archived(dir), [
    'eqlog_Avenrae_rivervale_week_2026-09-01.txt',
    'eqlog_Avenrae_rivervale_week_2026-09-08.txt',
  ]);
});

// A week away from the game would otherwise leave a trail of zero-byte archives that look like
// something went wrong.
test('an empty log is left alone and produces no archive', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': '' });
  const r = svc(dir).rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.deepEqual(r.skippedEmpty, ['eqlog_Avenrae_rivervale.txt']);
  assert.equal(r.rotated.length, 0);
  assert.deepEqual(archived(dir), [], 'an empty log should leave nothing behind');
});

test('files that are not character logs are never touched', () => {
  const dir = tempLogs({
    'eqlog_Avenrae_rivervale.txt': LINE,
    'dbg.txt': 'keep me',
    'Sky.txt': 'keep me too',
  });
  svc(dir).rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(fs.readFileSync(path.join(dir, 'dbg.txt'), 'utf8'), 'keep me');
  assert.equal(fs.readFileSync(path.join(dir, 'Sky.txt'), 'utf8'), 'keep me too');
});

// ---------------------------------------------------------------------------
// Not losing anything, which is the whole point
// ---------------------------------------------------------------------------

// The live log is only emptied after the archive is proved to match. If the copy cannot be made,
// the log must come through completely untouched.
test('a log is never emptied when the archive cannot be written', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  const s = svc(dir);
  // A FILE where the Archive directory needs to be, so mkdir/copy cannot succeed.
  fs.writeFileSync(path.join(dir, 'Archive'), 'not a directory');
  const r = s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(r.rotated.length, 0);
  assert.equal(r.failed.length, 1);
  assert.equal(
    fs.readFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), 'utf8'),
    LINE,
    'THE LOG WAS EMPTIED WITHOUT AN ARCHIVE'
  );
});

test('one bad file does not stop the others rotating', () => {
  const dir = tempLogs({ 'eqlog_Good_rivervale.txt': LINE, 'eqlog_Bad_rivervale.txt': LINE });
  const s = svc(dir);
  const realCopy = fs.copyFileSync;
  fs.copyFileSync = (src, dest) => {
    if (String(src).includes('Bad')) throw new Error('locked by another process');
    return realCopy(src, dest);
  };
  let r;
  try {
    r = s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  } finally {
    fs.copyFileSync = realCopy;
  }
  assert.equal(r.rotated.length, 1);
  assert.equal(r.failed.length, 1);
  assert.equal(fs.readFileSync(path.join(dir, 'eqlog_Bad_rivervale.txt'), 'utf8'), LINE, 'the failed log lost data');
  assert.equal(fs.statSync(path.join(dir, 'eqlog_Good_rivervale.txt')).size, 0);
});

// A short archive means something went wrong mid-copy. Emptying the original on top of that is how
// a rotation becomes data loss.
test('a truncated archive stops the rotation instead of completing it', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  const s = svc(dir);
  const realCopy = fs.copyFileSync;
  fs.copyFileSync = (src, dest) => fs.writeFileSync(dest, 'short');
  let r;
  try {
    r = s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  } finally {
    fs.copyFileSync = realCopy;
  }
  assert.equal(r.rotated.length, 0);
  assert.equal(r.failed.length, 1);
  assert.match(r.failed[0].error, /archive is/);
  assert.equal(fs.readFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), 'utf8'), LINE);
});

test('turning it off means nothing is touched at all', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  const s = svc(dir, { loadJson: () => ({ enabled: false }), saveJson: () => {} });
  s.loadSettings();
  const r = s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(r.reason, 'turned off');
  assert.equal(fs.readFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), 'utf8'), LINE);
  assert.deepEqual(archived(dir), []);
});

test('it is on unless someone turned it off', () => {
  const s = new LogRotationService({ loadJson: (n, d) => d, saveJson: () => {} });
  assert.equal(s.loadSettings().enabled, true);
});

test('no logs folder is a quiet no-op, not a throw', () => {
  const s = new LogRotationService();
  let r;
  assert.doesNotThrow(() => { r = s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0)); });
  assert.equal(r.reason, 'no logs folder');
});

test('an unreadable logs folder is reported, not thrown', () => {
  const s = new LogRotationService();
  s.setLogsFolderFn(() => path.join(os.tmpdir(), 'eqls-does-not-exist-' + Math.random()));
  let r;
  assert.doesNotThrow(() => { r = s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0)); });
  assert.equal(r.rotated.length, 0);
  assert.match(r.reason, /cannot read/);
});

// ---------------------------------------------------------------------------
// The live log must hold exactly this week - which the archive filename alone does not guarantee
// ---------------------------------------------------------------------------

// THE REGRESSION THIS SECTION EXISTS FOR. An empty log when the week opens produces no archive, so
// nothing recorded that the week was handled - and the next evening of play was then rotated away
// MID-WEEK. Nothing was lost, it went to the Archive folder intact, but it left the live log, which
// is where the lockout grid reads. Bosses killed on Tuesday night would have read as not killed.
test('a week that opened with an empty log does not eat the first night of play', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': '' });
  const live = path.join(dir, 'eqlog_Avenrae_rivervale.txt');
  const s = svc(dir);

  // Tuesday 11:05, the week opens. She has not played since the last rotation.
  const opened = s.rotateIfDue(new Date(2026, 8, 1, 11, 5, 0));
  assert.deepEqual(opened.skippedEmpty, ['eqlog_Avenrae_rivervale.txt']);
  assert.deepEqual(archived(dir), []);

  // Tuesday evening. Two bosses die.
  const night =
    '[Tue Sep 01 20:00:00 2026] You have slain Lady Vox!\n' +
    '[Tue Sep 01 21:30:00 2026] You have slain Lord Nagafen!\n';
  fs.writeFileSync(live, night);

  // Wednesday morning she opens the app again.
  const next = s.rotateIfDue(new Date(2026, 8, 2, 9, 0, 0));
  assert.equal(next.rotated.length, 0, 'IT ROTATED MID-WEEK');
  assert.deepEqual(next.skippedAlreadyCurrent, ['eqlog_Avenrae_rivervale.txt']);
  assert.equal(fs.readFileSync(live, 'utf8'), night, 'TUESDAY NIGHT LEFT THE LIVE LOG');
  assert.deepEqual(archived(dir), []);
});

// The same guarantee stated directly: what decides a rotation is whether the log still holds
// anything from before the boundary, not merely whether an archive happens to be on disk.
test('a log that already starts after the boundary is left alone', () => {
  const body = '[Wed Sep 02 08:00:00 2026] You have slain Lady Vox!\n';
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': body });
  const r = svc(dir).rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(r.rotated.length, 0);
  assert.deepEqual(r.skippedAlreadyCurrent, ['eqlog_Avenrae_rivervale.txt']);
  assert.equal(fs.readFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), 'utf8'), body);
});

test('a log that starts before the boundary is what actually rotates', () => {
  const dir = tempLogs({
    'eqlog_Avenrae_rivervale.txt': '[Mon Aug 31 22:00:00 2026] You have slain Lady Vox!\n',
  });
  const r = svc(dir).rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(r.rotated.length, 1);
  assert.deepEqual(r.skippedAlreadyCurrent, []);
});

// A head with no readable stamp means the question cannot be answered, and an unanswerable question
// is not a licence to empty someone's log. It is reported rather than passed over in silence.
test('a log with no readable timestamp is left alone and said out loud', () => {
  const body = 'no timestamp on this line at all\nnor on this one\n';
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': body });
  const r = svc(dir).rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(r.rotated.length, 0, 'it emptied a log it could not read');
  assert.deepEqual(r.skippedUnreadable, ['eqlog_Avenrae_rivervale.txt']);
  assert.equal(fs.readFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), 'utf8'), body);
  assert.deepEqual(archived(dir), []);
});

// A partial first line - which is what a file can begin with after being truncated under a game
// that was mid-write - must not stop the rotation, because the second line is readable.
test('a torn first line does not hide the timestamp on the second', () => {
  const dir = tempLogs({
    'eqlog_Avenrae_rivervale.txt':
      'ou have slain Lady Vox!\n[Mon Aug 31 22:00:00 2026] You have slain Lord Nagafen!\n',
  });
  const r = svc(dir).rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(r.rotated.length, 1);
});

// The week is named by the LOCAL calendar day. The ISO string beside it is UTC, so a renderer that
// sliced a date out of that would name the wrong day for anyone at UTC+12 or beyond, where local
// Tuesday 11:00 is still Monday in UTC.
//
// THIS MACHINE CANNOT DEMONSTRATE THAT. In Eastern time the two answers always coincide, and Node
// on Windows ignores the TZ environment variable, so there is no way to run the difference here.
// What is checkable is that the report and the archive name are computed from the same thing, and
// that the renderer reads the field rather than the string - which is where the bug would land.
test('the reported week and the archive name are the same computation', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  const r = svc(dir).rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(r.boundaryDate, '2026-09-01');
  assert.ok(
    r.rotated[0].archivedTo.endsWith('_week_' + r.boundaryDate + '.txt'),
    'the archive name and the reported week disagree'
  );
});

test('the renderer names the week from the local date, never from the UTC string', () => {
  const renderer = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'),
    'utf8'
  );
  const start = renderer.indexOf('function renderLogRotationStatus');
  assert.ok(start > -1, 'renderLogRotationStatus is gone - this test needs rewriting');
  const body = renderer.slice(start, renderer.indexOf('\n  }', start));
  assert.ok(body.includes('boundaryDate'), 'the renderer does not read boundaryDate');
  assert.ok(
    !/last\.boundary\b(?!Date)/.test(body),
    'the renderer reads the raw UTC boundary string, which names the wrong day east of UTC+11'
  );
});

// ---------------------------------------------------------------------------
// How the host calls it, which is where the last bug actually was
// ---------------------------------------------------------------------------

// The quiet check is worth nothing if it is first consulted before anything could have been heard.
// The watcher opens the log at the end and emits nothing for existing content, so at launch "time
// since the last line" is vacuously enormous and EVERY log reads as quiet - including one the game
// is writing to at that moment. On this machine, on the day this was found, that meant launching
// =Auras would have emptied a 142 MB log mid-session.
test('the host does not rotate before it has had a chance to hear the log', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.ok(
    /let lastLogLineAt = Date\.now\(\)/.test(main),
    'lastLogLineAt starts at zero, so the very first quiet check passes for any log at all'
  );
  assert.ok(
    !/runLogRotation\('startup'\)/.test(main),
    'a rotation runs at startup, before the quiet check can mean anything'
  );
  assert.ok(
    /setInterval\(\(\) => runLogRotation\('interval'\), 60 \* 1000\)/.test(main),
    'the periodic check is gone or has changed cadence'
  );
});

// The rotation clears the lockout state so the grid rebuilds from what is now on disk. Doing that
// underneath a running backfill loses whichever characters it had not reached yet: the backfill
// holds its own per-file state object and writes its own 'done' at the end, so it finishes
// reporting success with a character silently missing from the grid until someone hits rescan.
test('the host will not rotate underneath a running backfill', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const start = main.indexOf('function runLogRotation');
  assert.ok(start > -1, 'runLogRotation is gone - this test needs rewriting');
  const body = main.slice(start, main.indexOf('\n}', start));
  assert.ok(
    /backfillState === 'running'/.test(body),
    'a rotation can fire mid-backfill, which loses a character out of the grid'
  );
  // And it must bail before doing anything, not after.
  assert.ok(
    body.indexOf("backfillState === 'running'") < body.indexOf('rotateIfDue'),
    'the backfill guard is checked after the rotation has already happened'
  );
});

// Rotation renews every log's mtime and the watcher follows the newest file in the folder, so the
// tailed log has to be rotated last or the watcher is dragged onto a logged-out character. The
// module can only do that if the host tells it which log is being tailed.
test('the host tells the rotation which log is being watched', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  assert.ok(
    /logRotationService\.setCurrentFileFn\(/.test(main),
    'nothing tells the rotation which log is tailed, so it cannot keep the watcher in place'
  );
});

// Every IPC channel the main process answers on should be reachable from the preload bridge.
// An unreachable handler is dead weight that reads as a feature.
test('every rotation IPC channel is one the renderer can actually reach', () => {
  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const preload = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'preload', 'preload-main.js'),
    'utf8'
  );
  const handled = [...main.matchAll(/ipcMain\.handle\('(logRotation:[^']+)'/g)].map((m) => m[1]);
  assert.ok(handled.length > 0, 'no rotation IPC handlers found at all');
  for (const channel of handled) {
    assert.ok(preload.includes(`'${channel}'`), `${channel} is handled but not exposed in preload`);
  }
});

// The off switch, tested through the method the Setup toggle actually calls. Reaching the off state
// only via loadSettings() left setEnabled itself unexercised: a mutant that ignored its argument
// passed the whole suite, which is a toggle that silently does nothing and rotates anyway forever.
test('turning it off through the toggle sticks, and is written down', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  const saved = [];
  const s = svc(dir, { loadJson: (n, d) => d, saveJson: (n, v) => saved.push([n, v]) });
  assert.equal(s.setEnabled(false), false, 'setEnabled(false) did not turn it off');
  assert.deepEqual(saved, [['logRotation', { enabled: false }]], 'the choice was not persisted');
  const r = s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(r.reason, 'turned off');
  assert.equal(fs.readFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), 'utf8'), LINE);
  assert.deepEqual(archived(dir), []);
  assert.equal(s.setEnabled(true), true, 'setEnabled(true) did not turn it back on');
});

// Shara's own warning on the Archive log card: clearing the log while EQ is writing to it risks a
// lost line. The rotation fires on a timer while she is playing, so that warning is about THIS.
// Both directions are asserted - a gate stuck shut would starve the rotation forever, which is its
// own kind of wrong answer.
test('it waits while the game is writing, and proceeds once it stops', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  const s = svc(dir);
  let quiet = false;
  s.setIsQuietFn(() => quiet);

  const busy = s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(busy.rotated.length, 0, 'IT ROTATED WHILE THE GAME WAS WRITING');
  assert.match(busy.reason, /written to right now/);
  assert.equal(fs.readFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), 'utf8'), LINE);
  assert.deepEqual(archived(dir), [], 'it made an archive mid-write');

  quiet = true;
  const lull = s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(lull.rotated.length, 1, 'it never rotates once the log falls quiet');
  assert.equal(fs.statSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt')).size, 0);
});

// The copy-then-truncate ORDER, tested by failing after the Archive directory exists. The sibling
// test above puts a file where Archive/ must go, so mkdirSync throws a line before the truncate and
// the log survives for a reason that has nothing to do with ordering - it passed against code that
// truncated first. This one fails at the copy itself, which is the only place the order is visible.
test('the log is emptied only after a copy succeeds, never before', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  const s = svc(dir);
  const realCopy = fs.copyFileSync;
  fs.copyFileSync = () => { throw new Error('the disk filled up mid-copy'); };
  let r;
  try {
    r = s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  } finally {
    fs.copyFileSync = realCopy;
  }
  assert.ok(fs.existsSync(path.join(dir, 'Archive')), 'the copy never got as far as being attempted');
  assert.equal(r.rotated.length, 0);
  assert.equal(r.failed.length, 1);
  assert.equal(
    fs.readFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), 'utf8'),
    LINE,
    'THE LOG WAS EMPTIED BEFORE THE ARCHIVE EXISTED'
  );
});

// ---------------------------------------------------------------------------
// A failed rotation must leave nothing behind
// ---------------------------------------------------------------------------

// THE WORST DEFECT FOUND IN THIS MODULE. Whether a week has been rotated is answered by whether its
// archive exists, so an attempt that failed halfway and left a file at that path answers "yes,
// already done" for the rest of the week - silently, with no error recorded. In the disk-full case
// a hundred-byte fragment became the permanent archive for that week.
for (const [how, breakIt] of [
  ['the copy throws part-way and leaves a fragment', (dir, archive) => {
    const real = fs.copyFileSync;
    fs.copyFileSync = (src, dest) => { fs.writeFileSync(dest, 'frag'); throw new Error('ENOSPC'); };
    return () => { fs.copyFileSync = real; };
  }],
  ['the copy produces a short archive', () => {
    const real = fs.copyFileSync;
    fs.copyFileSync = (src, dest) => { fs.writeFileSync(dest, 'short'); };
    return () => { fs.copyFileSync = real; };
  }],
  ['the log cannot be emptied afterwards', () => {
    const real = fs.truncateSync;
    fs.truncateSync = () => { throw new Error('EPERM: the log is read-only'); };
    return () => { fs.truncateSync = real; };
  }],
]) {
  test(`a week is retried, not written off, when ${how}`, () => {
    const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
    const live = path.join(dir, 'eqlog_Avenrae_rivervale.txt');
    const s = svc(dir);
    const when = new Date(2026, 8, 2, 12, 0, 0);

    const restore = breakIt(dir);
    let first;
    try {
      first = s.rotateIfDue(when);
    } finally {
      restore();
    }

    assert.equal(first.failed.length, 1, 'the attempt did not report a failure');
    assert.deepEqual(archived(dir), [], 'A FAILED ATTEMPT LEFT AN ARCHIVE, WHICH READS AS "DONE"');
    assert.ok(s.getStatus().lastError, 'the failure was not recorded anywhere a person could see it');

    // The minute-later retry, with nothing broken any more, must actually rotate.
    const second = s.rotateIfDue(when);
    assert.equal(second.skippedAlreadyDone.length, 0, 'the week was written off after one failure');
    assert.equal(second.rotated.length, 1, 'the retry did not rotate');
    assert.equal(fs.statSync(live).size, 0);
  });
}

// Growth DURING the copy is caught because the archive comes out larger. Growth in the gap between
// the copy finishing and the truncate is not - those bytes are in the log, absent from the archive,
// and emptying it would take them from both. Measured at roughly 100 microseconds and a byte or so
// of real exposure, which is small, and not the same as closed.
test('a log that grows in the last moment before emptying is not emptied', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  const live = path.join(dir, 'eqlog_Avenrae_rivervale.txt');
  const s = svc(dir);
  const real = fs.copyFileSync;
  fs.copyFileSync = (src, dest) => {
    real(src, dest);
    fs.appendFileSync(src, '\n[Wed Sep 02 11:59:59 2026] You have slain Lord Nagafen!');
  };
  let r;
  try {
    r = s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  } finally {
    fs.copyFileSync = real;
  }
  assert.equal(r.rotated.length, 0);
  assert.match(r.failed[0].error, /grew from/);
  assert.ok(fs.readFileSync(live, 'utf8').includes('Nagafen'), 'THE LATE LINE WAS LOST');
  assert.deepEqual(archived(dir), [], 'the aborted attempt left an archive behind');
});

// ---------------------------------------------------------------------------
// A log that holds both weeks at once
// ---------------------------------------------------------------------------

// The head check alone only catches a log that is ENTIRELY current. One that starts before the
// reset and carries on past it was archived whole - and the grid reads the live log, never the
// Archive folder, so this week's kills disappeared from it. Refusing costs the accuracy this
// feature adds. Rotating anyway costs accuracy the app already had.
test('a log holding both last week and this one is left alone, and says so', () => {
  const body =
    '[Mon Aug 31 22:00:00 2026] You have slain Lady Vox!\n' +
    '[Tue Sep 01 20:00:00 2026] You have slain Lord Nagafen!\n';
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': body });
  const r = svc(dir).rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(r.rotated.length, 0, 'IT ARCHIVED THIS WEEK[S KILLS OUT OF THE LIVE LOG');
  assert.deepEqual(r.skippedSpansBoundary, ['eqlog_Avenrae_rivervale.txt']);
  assert.equal(fs.readFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), 'utf8'), body);
  assert.deepEqual(archived(dir), []);
});

// A real log is a hundred megabytes, and the boundary crossing is somewhere in the middle of it.
// Both ends have to be read from their own end of the file: with the tail read taken from offset 0
// instead, a log longer than the read window looks like it stops wherever the first 8 KB stop, and
// the spanning check silently passes everything.
test('a log far larger than the read window is judged by its real last line', () => {
  const filler = [];
  for (let i = 0; i < 400; i += 1) {
    filler.push(`[Mon Aug 31 ${String(10 + (i % 12)).padStart(2, '0')}:00:00 2026] You say, 'line ${i}'`);
  }
  const body =
    '[Mon Aug 31 09:00:00 2026] You have slain Lady Vox!\n' +
    filler.join('\n') + '\n' +
    '[Tue Sep 01 20:00:00 2026] You have slain Lord Nagafen!\n';
  assert.ok(body.length > 8192 * 2, 'the fixture is not big enough to span two read windows');

  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': body });
  const r = svc(dir).rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.deepEqual(r.skippedSpansBoundary, ['eqlog_Avenrae_rivervale.txt'],
    'the crossing at the end of a large log was not seen');
  assert.equal(fs.readFileSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt'), 'utf8'), body);
});

// The ordinary case, and the one the owner described: the servers are down at the reset, so the
// first launch afterwards sees a log whose last line is from before it.
test('a log that ends before the reset is the one that rotates', () => {
  const body =
    '[Sun Aug 30 21:00:00 2026] You have slain Lady Vox!\n' +
    '[Mon Aug 31 23:30:00 2026] You have slain Lord Nagafen!\n';
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': body });
  const r = svc(dir).rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  assert.equal(r.rotated.length, 1);
  assert.deepEqual(r.skippedSpansBoundary, []);
});

// ---------------------------------------------------------------------------
// More than one character in the folder
// ---------------------------------------------------------------------------

// A helper that sets a file's modification time relative to the fixture's clock, because the whole
// point of these is what the FILESYSTEM says about a file, not what a test happened to write when.
const aged = (dir, name, now, secondsAgo) => {
  const t = new Date(now.getTime() - secondsAgo * 1000);
  fs.utimesSync(path.join(dir, name), t, t);
};

// The host's quiet check watches the ONE log the tailer follows. A second account writes to its own
// log, which the tailer never sees - so on that one file's silence the rotation would empty a log
// another client is writing to at that moment. Each file is asked about itself.
test('a log another client is writing to right now is left alone', () => {
  const now = new Date(2026, 8, 2, 12, 0, 0);
  const dir = tempLogs({
    'eqlog_Avenrae_rivervale.txt': LINE,
    'eqlog_Boxmule_rivervale.txt': LINE,
  });
  aged(dir, 'eqlog_Avenrae_rivervale.txt', now, 600);  // idle ten minutes
  aged(dir, 'eqlog_Boxmule_rivervale.txt', now, 2);    // written to two seconds ago

  const r = svc(dir).rotateIfDue(now);
  assert.deepEqual(r.skippedBusy, ['eqlog_Boxmule_rivervale.txt'], 'the busy log was not spared');
  assert.equal(r.rotated.length, 1, 'the idle log should still have rotated');
  assert.equal(fs.readFileSync(path.join(dir, 'eqlog_Boxmule_rivervale.txt'), 'utf8'), LINE);
  assert.equal(fs.statSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt')).size, 0);
});

// Rotation renews every file's mtime, and the watcher follows the newest file in the folder. Empty
// the played character's log before a logged-out mule's and the watcher is dragged onto the mule at
// its next directory scan - and everything the player writes until then is lost to buffs, lockouts
// and every other consumer of that one feed. The tailed log therefore goes last.
test('the log being watched is the last one emptied, so the watcher stays on it', () => {
  const now = new Date(2026, 8, 2, 12, 0, 0);
  const dir = tempLogs({
    'eqlog_Avenrae_rivervale.txt': LINE,
    'eqlog_Zzmule_rivervale.txt': LINE,
  });
  aged(dir, 'eqlog_Avenrae_rivervale.txt', now, 600);
  aged(dir, 'eqlog_Zzmule_rivervale.txt', now, 600);

  const s = svc(dir);
  // Avenrae is being tailed - and sorts FIRST alphabetically, which is the order readdir gives.
  s.setCurrentFileFn(() => path.join(dir, 'eqlog_Avenrae_rivervale.txt'));
  const r = s.rotateIfDue(now);
  assert.equal(r.rotated.length, 2);
  assert.equal(
    path.basename(r.rotated[r.rotated.length - 1].file),
    'eqlog_Avenrae_rivervale.txt',
    'THE WATCHED LOG WAS NOT ROTATED LAST - the watcher will jump to the other character'
  );
  const watched = fs.statSync(path.join(dir, 'eqlog_Avenrae_rivervale.txt')).mtimeMs;
  const mule = fs.statSync(path.join(dir, 'eqlog_Zzmule_rivervale.txt')).mtimeMs;
  assert.ok(watched >= mule, 'the mule ended up with the newer mtime');
});

// ---------------------------------------------------------------------------
// Saying what happened, for longer than one minute
// ---------------------------------------------------------------------------

// The check runs every sixty seconds. When last run and last check were the same field, a success
// or a failure was erased by the next quiet minute - so the one thing a person needed to see was
// visible for one tick and then gone, and a feature that had stopped working looked identical to
// one that had never had anything to do.
test('what happened survives the quiet minutes that follow it', () => {
  const now = new Date(2026, 8, 2, 12, 0, 0);
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  aged(dir, 'eqlog_Avenrae_rivervale.txt', now, 600);
  const s = svc(dir);

  s.rotateIfDue(now);
  const afterRun = s.getStatus();
  assert.equal(afterRun.lastRun.rotated.length, 1);

  // Five more checks that find nothing to do, as the next five minutes would.
  for (let i = 0; i < 5; i += 1) s.rotateIfDue(now);
  const later = s.getStatus();
  assert.equal(later.lastRun.rotated.length, 1, 'THE RECORD OF THE ROTATION WAS ERASED BY DOING NOTHING');
  assert.equal(later.lastCheck.rotated.length, 0, 'lastCheck should show the most recent look');
  assert.ok(later.lastCheck.skippedAlreadyDone.length, 'and it should say why it did nothing');
});

// EVERY WAY OUT OF A CHECK HAS TO LEAVE A RECORD, including the ones that give up early. This was
// found by running the real app for ninety-five seconds - a check had certainly happened, and the
// Setup card was blank, because the commonest outcome of all (the game is writing to the log right
// now) returned before anything was written down. A feature that is working and waiting looked
// exactly like a feature that was dead.
test('every way a check can end leaves something a person could read', () => {
  const now = new Date(2026, 8, 2, 12, 0, 0);
  const ends = {
    'turned off': () => {
      const s2 = svc(tempLogs({}), { loadJson: () => ({ enabled: false }), saveJson: () => {} });
      s2.loadSettings();
      return s2;
    },
    'no logs folder': () => new LogRotationService(),
    'the game is writing': () => {
      const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
      const s2 = svc(dir);
      s2.setIsQuietFn(() => false);
      return s2;
    },
    'the folder cannot be read': () => {
      const s2 = new LogRotationService();
      s2.setLogsFolderFn(() => path.join(os.tmpdir(), 'eqls-gone-' + Math.random()));
      return s2;
    },
    'nothing to do': () => svc(tempLogs({})),
    'it rotated': () => {
      const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
      aged(dir, 'eqlog_Avenrae_rivervale.txt', now, 600);
      return svc(dir);
    },
  };

  for (const [name, build] of Object.entries(ends)) {
    const s2 = build();
    s2.rotateIfDue(now);
    const status = s2.getStatus();
    assert.ok(status.lastCheck, `"${name}" left no record of the check at all`);
    assert.equal(status.lastCheck.at, now.toISOString(), `"${name}" recorded the wrong time`);
  }
});

// A head that begins with junk - a torn line, or the run of NUL bytes a writer holding its old
// offset leaves behind after a truncation - used to make a log unreadable and therefore untouchable
// for ever, growing without bound, in silence. The window escalates before giving up.
test('a log buried under more junk than one read window still rotates', () => {
  const now = new Date(2026, 8, 2, 12, 0, 0);
  const junk = '\0'.repeat(20000);
  const dir = tempLogs({
    'eqlog_Avenrae_rivervale.txt': junk + '[Mon Aug 31 22:00:00 2026] You have slain Lady Vox!\n',
  });
  aged(dir, 'eqlog_Avenrae_rivervale.txt', now, 600);
  const r = svc(dir).rotateIfDue(now);
  assert.deepEqual(r.skippedUnreadable, [], 'it gave up inside the first window');
  assert.equal(r.rotated.length, 1);
});

// ---------------------------------------------------------------------------
// The stamp EverQuest actually writes
// ---------------------------------------------------------------------------

// EverQuest Legends writes "Aug 04", zero-padded, one space - measured over 9,621,621 real lines
// including 1,957,073 on days 1 to 9. These two tests are therefore TOLERANCE tests for a format
// this client does not emit: C's ctime() right-aligns the day ("Aug  4"), the two formats look
// almost identical, and one was briefly mistaken for the other here.
//
// They are kept because the tolerance is real and free, and because if the parser is going to
// accept that form it should be held to doing so. They are NOT evidence of a bug that existed.
test('a space-padded single-digit day is a timestamp, not an unstamped line', () => {
  assert.notEqual(extractTimestampMs('[Tue Sep  1 12:00:00 2026] You have slain Lady Vox!'), null,
    'the space-padded form still reads as unstamped');
  assert.equal(
    extractTimestampMs('[Tue Sep  1 12:00:00 2026] x'),
    extractTimestampMs('[Tue Sep 01 12:00:00 2026] x'),
    'the two spellings of the same instant disagree'
  );
  assert.notEqual(extractTimestampMs('[Tue Sep 15 12:00:00 2026] x'), null, 'two-digit days broke');
});

test('a log written in a space-padded format would still rotate', () => {
  const dir = tempLogs({
    'eqlog_Avenrae_rivervale.txt': '[Tue Sep  1 09:00:00 2026] You have slain Lady Vox!\n',
  });
  // Boundary is Tuesday 8 September; the log is from the 1st, so it is last week's and must go.
  const r = svc(dir).rotateIfDue(new Date(2026, 8, 9, 12, 0, 0));
  assert.equal(r.rotated.length, 1, 'a space-padded log would be treated as unreadable');
  assert.deepEqual(r.skippedUnreadable, []);
});

// ---------------------------------------------------------------------------
// It must not reach the user's settings
// ---------------------------------------------------------------------------

// Auras live in userData; rotation works inside the EverQuest Logs folder. The two are different
// trees and this asserts the module cannot reach across.
test('rotation writes nothing outside the logs folder', () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': LINE });
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'logRotation.js'), 'utf8');
  assert.ok(!/getPath\(/.test(src), 'the rotation must not resolve app paths - that is where auras live');
  assert.ok(!/userData/.test(src.replace(/^\s*\/\/.*$/gm, '')), 'no userData outside comments');
  const s = svc(dir);
  s.rotateIfDue(new Date(2026, 8, 2, 12, 0, 0));
  // Everything it produced is inside the folder it was given.
  const produced = fs.readdirSync(path.join(dir, 'Archive'));
  assert.ok(produced.length === 1 && produced[0].startsWith('eqlog_'));
});

module.exports = () => report('log-rotation');
if (require.main === module) report('log-rotation').then((n) => process.exit(n ? 1 : 0));
