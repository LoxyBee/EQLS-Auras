'use strict';

// Weekly log rotation, at the raid lockout reset.
//
// WHY THIS EXISTS, and it is not really about tidiness.
//
// The lockout grid has to answer "have you killed this boss THIS period". Every other tool that
// ships this feature answers it by inferring from kill history and typing a reset day into the
// source. This app can do something better and much simpler: if the live log is archived and
// emptied at the reset boundary, then everything in the live log belongs to the current period
// BY CONSTRUCTION. There is nothing to infer, no boundary arithmetic on individual kills, and no
// hour to be uncertain about.
//
// NOTHING IS DESTROYED. The log is copied to `Logs/Archive/` first, the copy is verified, and only
// then is the original emptied. The owner's whole history stays on disk, in a folder she can open.
//
// WHY TRUNCATE AND NOT DELETE. EverQuest holds the log file open while it is running, and Windows
// will not delete a file with a live handle - but it will let you truncate one to zero length, and
// the game simply carries on appending. `logService.archiveNow()` already chose truncate for this
// reason and this module reuses it wholesale rather than inventing a second mechanism.
// `logWatcher` already handles the result (`stat.size < offset` resets the offset to 0), verified
// by simulating a rotation against the real watcher while it was running.
//
// THE RESET, MEASURED RATHER THAN TYPED. Tuesday, 11:00, local wall clock. Two Alt+Z readings
// 10.84 hours apart landed 6 seconds from each other and both within 18 seconds of a clean
// 11:00:00 on Tuesday 1 September 2026 - and every row of that window showed the same remaining
// time, which is what establishes that all the locks share one reset rather than each running its
// own. That is a measurement, not a constant somebody typed.
//
// TIME ZONE, stated because it is an assumption and not a measurement. The reading came from a
// machine running Eastern time. Working in LOCAL WALL CLOCK means the boundary self-adjusts across
// the daylight-saving change on 1 November - it stays "11:00 as the clock on the wall reads" - and
// that is the owner's stated expectation. It is correct for a player whose machine is on the same
// clock as the server's reset and wrong by the offset for anyone else. If a non-Eastern user ever
// reports the grid rolling over at the wrong time, THIS COMMENT IS THE REASON and the fix is to
// resolve the boundary through a fixed zone instead.

const fs = require('fs');
const path = require('path');
const { extractTimestampMs } = require('./logSplitter');

// 0 = Sunday, so 2 = Tuesday. Measured; see the header.
const RESET_WEEKDAY = 2;
const RESET_HOUR = 11;

// How long a log must have been still before it is touched. The host's own quiet check watches the
// ONE log the tailer is following; this one asks each file directly, because a second account can
// be writing to its own log while the watched one is idle - and the rotation empties every one of
// them on the strength of that single file's silence.
const QUIET_MS = 10000;

/**
 * The most recent reset boundary at or before `now`, in local time.
 *
 * Local wall clock deliberately - see the time-zone note in the header. `setHours` on a local Date
 * is what makes the daylight-saving transition a non-event rather than an hour of wrongness.
 */
function resetBoundaryBefore(now = new Date()) {
  const d = new Date(now.getTime());
  d.setHours(RESET_HOUR, 0, 0, 0);
  const back = (d.getDay() - RESET_WEEKDAY + 7) % 7;
  d.setDate(d.getDate() - back);
  // Landing in the future means today IS the reset weekday but the hour has not arrived yet, so
  // the period that is actually current began a week earlier.
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 7);
  return d;
}

/** `2026-09-01`, the local date of a boundary. Used to name archives and to recognise them again. */
function boundaryKey(boundary) {
  const p = (n) => String(n).padStart(2, '0');
  return `${boundary.getFullYear()}-${p(boundary.getMonth() + 1)}-${p(boundary.getDate())}`;
}

// `eqlog_Avenrae_rivervale.txt` -> `eqlog_Avenrae_rivervale_week_2026-09-01.txt`
function archiveNameFor(logFileName, boundary) {
  const base = path.basename(logFileName, path.extname(logFileName));
  return `${base}_week_${boundaryKey(boundary)}.txt`;
}


// How much of the head of a log to read looking for a usable timestamp. A log line is well under
// this; the allowance is for a file that begins with a partial line.
const HEAD_BYTES = 8192;
// If the first window carries no stamp, look this far before concluding it cannot be read. A log
// can legitimately begin with junk - a torn line, or a run of NUL bytes left by a writer that kept
// its old offset across a truncation - and giving up at 8 KB means such a log is never rotated
// again, for ever, growing without bound. Two megabytes is still a single cheap read.
const HEAD_BYTES_MAX = 2 * 1024 * 1024;

/**
 * The timestamp on the earliest line of a log, or null if it cannot be established.
 *
 * THIS IS WHAT MAKES "the live log holds exactly this week" TRUE, rather than merely intended.
 * The archive filename records that a week was handled, but it is not enough on its own: a log that
 * was EMPTY when the week opened gets no archive, so nothing records the week, and the first
 * evening of play afterwards would then be rotated away mid-week - archived safely, but out of the
 * live log, which is where the lockout grid reads. The kills would be real and the grid would say
 * they had not happened. Asking the log what it actually starts with settles it directly.
 *
 * Returns null on an unparseable head, and the caller treats null as DO NOT TOUCH. An unreadable
 * log is a thing we do not know, and the rule for those here is to leave the file alone and say so.
 */
/**
 * Drop leading NUL or blank padding from a line before parsing it.
 *
 * A writer that keeps its own file offset across a truncation leaves as many NUL bytes as the file
 * used to be long, and then appends its next line with no newline in between - so the stamp is
 * real, it is just not at the start of what splitting on newlines calls a line. Without this such a
 * file reads as having no timestamp at all, which means never rotated, for ever, growing unbounded.
 *
 * Only NULs and whitespace are stepped over. Anything else and the line is returned untouched, so
 * this cannot promote a timestamp quoted in the middle of somebody's chat into the log's start.
 */
function stripPadding(line) {
  const at = line.indexOf('[');
  if (at <= 0) return line;
  return /^[\0\s]+$/.test(line.slice(0, at)) ? line.slice(at) : line;
}

function lastStampMs(filePath, size) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const from = Math.max(0, size - HEAD_BYTES);
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, size));
    const read = fs.readSync(fd, buf, 0, buf.length, from);
    if (!read) return null;
    const lines = buf.slice(0, read).toString('utf8').split('\n');
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      const ms = extractTimestampMs(stripPadding(lines[i]));
      if (ms !== null) return ms;
    }
    return null;
  } catch (err) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function firstStampMs(filePath, size) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    for (const window of [HEAD_BYTES, HEAD_BYTES_MAX]) {
      const want = Math.min(window, size);
      if (!want) return null;
      const buf = Buffer.alloc(want);
      const read = fs.readSync(fd, buf, 0, want, 0);
      if (!read) return null;
      for (const line of buf.slice(0, read).toString('utf8').split('\n')) {
        const ms = extractTimestampMs(stripPadding(line));
        if (ms !== null) return ms;
      }
      if (want >= size) return null;
    }
    return null;
  } catch (err) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * Rotates every character's log once per lockout week.
 *
 * THE FILESYSTEM IS THE RECORD OF WHETHER THIS ALREADY HAPPENED, deliberately, rather than a
 * marker in settings. An archive is named after the boundary it opened, so "have we already
 * rotated for this week" is answered by asking whether that file exists. That survives a settings
 * file being unreadable - which this app currently handles by silently returning defaults, and a
 * default of "never rotated" would rotate a second time mid-week. It also survives a reinstall.
 */
class LogRotationService {
  constructor({ loadJson, saveJson } = {}) {
    this.logsFolderFn = () => null;
    // Injected so this stays testable without Electron, same as every other service here.
    this.loadJson = loadJson || (() => ({}));
    this.saveJson = saveJson || (() => {});
    this.enabled = true;
    // Seconds of log silence required before touching a file. Defaults to "always quiet" so the
    // module stays usable without a host; main.js injects the real answer.
    this.isQuietFn = () => true;
    this.lastRun = null;
    // What the LAST CHECK found, kept apart from the last run that did something. Collapsing the
    // two meant a success or a failure message survived exactly one sixty-second tick before the
    // next no-op check overwrote it, so the one moment a person needed to see was the one moment
    // it was hardest to catch.
    this.lastCheck = null;
    // The currently tailed log, so it can be rotated LAST. Rotation renews every file's mtime, and
    // the watcher follows the newest - so emptying a logged-out character's log after the played
    // one silently drags the watcher onto the mule, and every line the player writes until the next
    // directory scan is lost to buffs, lockouts and everything else on that feed.
    this.currentFileFn = () => null;
    this.errors = 0;
    this.lastError = null;
  }

  setLogsFolderFn(fn) {
    if (typeof fn === 'function') this.logsFolderFn = fn;
  }

  /**
   * Is the game idle enough to touch the log right now?
   *
   * SHARA'S OWN WARNING, on the Archive log card in Setup: "if EQ is actively writing to the log at
   * the exact moment it's cleared, there's a small chance of a lost line or a game hiccup. Safest
   * to do it right after logging out." That advice was written for a button a person presses. This
   * rotation fires on a schedule, while they are playing, which is exactly the case she warned
   * about - so it waits for a lull instead of ignoring her.
   *
   * A miss costs nothing: the check runs again in fifteen minutes, and the boundary does not move.
   */
  setIsQuietFn(fn) {
    if (typeof fn === 'function') this.isQuietFn = fn;
  }

  setCurrentFileFn(fn) {
    if (typeof fn === 'function') this.currentFileFn = fn;
  }

  setEnabled(enabled) {
    this.enabled = !!enabled;
    this.saveJson('logRotation', { enabled: this.enabled });
    return this.enabled;
  }

  loadSettings() {
    const cfg = this.loadJson('logRotation', { enabled: true });
    this.enabled = cfg.enabled !== false;
    return { enabled: this.enabled };
  }

  /**
   * Do the rotation if it is due. Safe to call as often as you like.
   *
   * Returns a report rather than throwing. This is called from app startup, and a rotation problem
   * must never stop the app from starting.
   */
  rotateIfDue(now = new Date()) {
    const report = {
      ran: false,
      boundary: null,
      rotated: [],
      skippedEmpty: [],
      skippedAlreadyDone: [],
      // Already holds nothing older than this week's boundary, so it is already what the lockout
      // grid needs it to be and rotating it would take this week's own kills out of view.
      skippedAlreadyCurrent: [],
      // The head of the file carries no readable timestamp, so whether it predates the boundary
      // cannot be established. Left untouched, and reported rather than swallowed.
      skippedUnreadable: [],
      // Holds both this week and last. Rotating it whole would archive kills that count right now.
      skippedSpansBoundary: [],
      // Written to within the last ten seconds by SOMETHING - which for a second account is a
      // client the tailer never sees.
      skippedBusy: [],
      failed: [],
      reason: null,
    };
    if (!this.enabled) {
      report.reason = 'turned off';
      return this._finish(report, now);
    }
    const folder = this.logsFolderFn();
    if (!folder) {
      report.reason = 'no logs folder';
      return this._finish(report, now);
    }

    const boundary = resetBoundaryBefore(now);
    report.boundary = boundary.toISOString();
    // The local calendar date of the boundary. The ISO string above is UTC, and slicing a date
    // off it names the wrong day for anyone far enough east or west - so the day is carried
    // explicitly rather than recovered from a string.
    report.boundaryDate = boundaryKey(boundary);

    // Mid-fight is the worst moment to empty a file the game is writing to. Waiting is free.
    if (!this.isQuietFn()) {
      report.reason = 'the log is being written to right now; will try again shortly';
      return this._finish(report, now);
    }

    let names;
    try {
      names = fs.readdirSync(folder).filter((n) => /^eqlog_.+\.txt$/i.test(n));
      // The tailed log goes LAST so that it ends up with the newest mtime and the watcher stays on
      // it. See currentFileFn.
      const current = this.currentFileFn();
      if (current) {
        const base = path.basename(current).toLowerCase();
        names.sort((a, b) => (a.toLowerCase() === base ? 1 : 0) - (b.toLowerCase() === base ? 1 : 0));
      }
    } catch (err) {
      this._note(err);
      report.reason = `cannot read ${folder}`;
      return this._finish(report, now);
    }

    const archiveDir = path.join(folder, 'Archive');
    for (const name of names) {
      const live = path.join(folder, name);
      const archivePath = path.join(archiveDir, archiveNameFor(name, boundary));
      try {
        // Already rotated for this boundary. The file's own name is the record.
        if (fs.existsSync(archivePath)) {
          report.skippedAlreadyDone.push(name);
          continue;
        }
        const stat = fs.statSync(live);
        // This file's own silence, not the watched file's. A boxed second account writes to its own
        // log, which the tailer never sees.
        if (now.getTime() - stat.mtimeMs < QUIET_MS) {
          report.skippedBusy.push(name);
          continue;
        }
        // Nothing to archive and nothing to reset. Without this, a week away from the game leaves
        // a trail of zero-byte archives that look like something went wrong.
        if (stat.size === 0) {
          report.skippedEmpty.push(name);
          continue;
        }

        // Does this log actually still hold anything from before the week opened? If not, there is
        // nothing to close off and rotating would only remove this week's own play from the file
        // the grid reads. See firstStampMs.
        const firstMs = firstStampMs(live, stat.size);
        if (firstMs === null) {
          report.skippedUnreadable.push(name);
          continue;
        }
        if (firstMs >= boundary.getTime()) {
          report.skippedAlreadyCurrent.push(name);
          continue;
        }

        // DOES THIS LOG CROSS THE BOUNDARY? If its last line is already in the new week, then part
        // of it belongs to the period the grid is about to be asked about, and archiving the file
        // wholesale would move THIS week's kills out of the only place the grid reads. Refuse, and
        // say so. Refusing costs the accuracy this feature adds; rotating anyway costs accuracy the
        // app already has, by turning kills that happened into kills it reports as missing.
        //
        // Reachable when the app was not running at the reset and play continued past it. It is not
        // the normal path: the servers are down at the reset, so the usual first launch afterwards
        // sees a log whose last line predates it.
        const lastMs = lastStampMs(live, stat.size);
        if (lastMs !== null && lastMs >= boundary.getTime()) {
          report.skippedSpansBoundary.push(name);
          continue;
        }

        fs.mkdirSync(archiveDir, { recursive: true });
        fs.copyFileSync(live, archivePath);

        // VERIFY BEFORE EMPTYING. copyFileSync throws on failure, so this is belt and braces
        // rather than a hole being plugged - but the next statement empties the owner's log, and
        // that is not a line to cross on the strength of "it would have thrown".
        const copied = fs.statSync(archivePath);
        if (copied.size !== stat.size) {
          this._fail(report, name, `archive is ${copied.size}B, log was ${stat.size}B`, archivePath);
          continue;
        }

        // ONE LAST LOOK BEFORE EMPTYING IT. Growth DURING the copy is caught above, because the
        // archive comes out larger than the log was. Growth in the gap between the copy finishing
        // and this line is not: those bytes are in the live log, absent from the archive, and
        // truncate would take them from both. Measured, the gap is about 100 microseconds and the
        // exposure a byte or so - but the whole point of this module is that the archive is proved
        // before anything is emptied, and a proof with a hole in it is not one.
        const nowSize = fs.statSync(live).size;
        if (nowSize !== stat.size) {
          this._fail(report, name, `the log grew from ${stat.size}B to ${nowSize}B mid-archive`, archivePath);
          continue;
        }

        fs.truncateSync(live, 0);
        report.rotated.push({ file: name, archivedTo: archivePath, bytes: stat.size });
      } catch (err) {
        this._fail(report, name, err.message, archivePath);
      }
    }

    // KEEP THE WATCHER WHERE IT IS. Rotating renews a file's mtime and the tailer follows the
    // newest file in the folder. Sorting the watched log last only helps when it is actually
    // rotated - and the ordinary multi-box case is the opposite: the played character's log
    // straddles the reset and is skipped, while a logged-out mule's is entirely last week's and
    // rotates. The mule then holds the newest mtime and the tailer moves to it, losing every line
    // the player writes until the next directory scan - for buffs and the damage meter too, not
    // just this feature. Measured: watched-newest true before, false after.
    //
    // Touching the mtime changes no bytes. If it fails, the rotation still stands; it is noted.
    if (report.rotated.length) {
      const current = this.currentFileFn();
      const base = current ? path.basename(current).toLowerCase() : null;
      const rotatedTheWatchedOne = base && report.rotated.some((r) => r.file.toLowerCase() === base);
      if (base && !rotatedTheWatchedOne) {
        try {
          // A millisecond past the newest file we just touched, rather than simply "now". Date has
          // millisecond precision and the filesystem records mtimes finer than that, so stamping
          // the current time could land BEHIND a file truncated moments earlier in the same
          // millisecond - which put the mule back in front one run in three.
          let newest = 0;
          for (const r of report.rotated) {
            try {
              newest = Math.max(newest, fs.statSync(path.join(folder, r.file)).mtimeMs);
            } catch (err) {
              this._note(err);
            }
          }
          const t = new Date(Math.max(Date.now(), newest) + 1);
          fs.utimesSync(current, t, t);
        } catch (err) {
          this._note(err);
        }
      }
    }

    report.ran = report.rotated.length > 0;
    return this._finish(report, now);
  }

  /**
   * Record a failure, and REMOVE WHATEVER ARCHIVE IT LEFT BEHIND.
   *
   * This is the fix for the worst thing found in this module. Whether a week has been rotated is
   * answered by whether its archive exists - so an attempt that failed halfway and left a file at
   * that path answers "yes, done" for the rest of the week. Every route in was demonstrated: the
   * log grew during the copy, the truncate threw EPERM on a read-only log, the disk filled mid-copy
   * and left a hundred bytes of a one-kilobyte log. In each case the next run reported
   * skippedAlreadyDone, cheerfully, with lastError reading null - and in the third case a fragment
   * had become the permanent archive for that week.
   *
   * A failed rotation must leave NOTHING: no archive, no record, and a visible error. Then the next
   * check a minute later simply tries again.
   *
   * Nothing at that path can belong to anyone else. It did not exist when this file's turn began -
   * that is checked first, and an existing archive means the week is skipped before we get here.
   */
  _fail(report, name, error, archivePath) {
    report.failed.push({ file: name, error });
    this._note(new Error(`${name}: ${error}`));
    try {
      if (fs.existsSync(archivePath) && fs.statSync(archivePath).isFile()) fs.unlinkSync(archivePath);
    } catch (err) {
      // Reported, not thrown. A rotation problem must never stop the app.
      this._note(err);
    }
  }

  /**
   * Record what this check found, and hand the report back.
   *
   * EVERY exit goes through here, including the early ones. They used to return before recording
   * anything, so the most common outcome by far - "the log is being written to right now" - left
   * `lastCheck` null and the Setup card blank. Running the real app for ninety-five seconds is what
   * showed it: a check had certainly happened, and the status said nothing at all, which is
   * indistinguishable from the feature being dead.
   *
   * `lastRun` is separate and only moves for a check that actually did something, so a success or a
   * failure is not erased by the quiet minute that follows it.
   */
  _finish(report, now) {
    this.lastCheck = { at: now.toISOString(), ...report };
    if (report.rotated.length || report.failed.length) {
      this.lastRun = this.lastCheck;
    }
    return report;
  }

  /**
   * Record a check the HOST declined to make, so the card can say so.
   *
   * The module was fixed so that every way out of a check leaves a record. Then the host grew two
   * guards of its own - not during a lockout backfill, not while the splitter has a backlog - and
   * both return before rotateIfDue is ever called, so nothing was recorded and the Setup card went
   * blank again. Same defect, one level up.
   */
  noteHostSkip(reason, now = new Date()) {
    return this._finish(
      {
        ran: false,
        boundary: null,
        boundaryDate: null,
        rotated: [],
        skippedEmpty: [],
        skippedAlreadyDone: [],
        skippedAlreadyCurrent: [],
        skippedUnreadable: [],
        skippedSpansBoundary: [],
        skippedBusy: [],
        failed: [],
        reason,
      },
      now
    );
  }

  _note(err) {
    this.errors += 1;
    this.lastError = err && err.message ? err.message : String(err);
  }

  getStatus() {
    return {
      enabled: this.enabled,
      lastRun: this.lastRun,
      lastCheck: this.lastCheck,
      nextBoundaryAfterNow: (() => {
        const b = resetBoundaryBefore(new Date());
        const next = new Date(b.getTime());
        next.setDate(next.getDate() + 7);
        return next.toISOString();
      })(),
      errors: this.errors,
      lastError: this.lastError,
    };
  }
}

module.exports = {
  LogRotationService,
  resetBoundaryBefore,
  boundaryKey,
  archiveNameFor,
  RESET_WEEKDAY,
  RESET_HOUR,
};
