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
// THE RESET: TUESDAY, 11:00 US EASTERN — the owner's own reading, not something this app measured.
// It comes from the owner's in-game Alt+Z lockout timer, stated first-hand. lockoutCore.js's
// RESET_RULE and docs/EVIDENCE.md both record it as `provenance: 'stated'`, and lockoutCore's
// parser deliberately runs with `hour: null` — "the reset hour has never been measured". Two Alt+Z
// readings 10.84 hours apart on Tuesday 1 September 2026 landed within 6 seconds of each other and
// within 18 seconds of 11:00:00, every row showing the same remaining time — consistent with one
// shared reset, though consistency is not confirmation. This is the host-side default only; the
// user may change the day/hour, and it must always match the Lockouts grid setting.
//
// TIME ZONE. The reset is the SERVER's, which runs on US Eastern, so the boundary is resolved in
// America/New_York - see src/shared/easternReset.js. That handles the daylight-saving change on
// its own (the boundary stays "11:00 as the Eastern clock reads", an hour apart in UTC either side
// of it) and is correct whatever zone the player's own machine is on. Log-line timestamps are
// parsed as local Dates - absolute instants - so comparing them against this Eastern-derived
// instant is right regardless. The user may change the day/hour; those are Eastern too.

const fs = require('fs');
const path = require('path');
const { extractTimestampMs } = require('./logSplitter');
const { easternResetBefore, easternResetAfter, easternParts } = require('../shared/easternReset');

// 0 = Sunday, so 2 = Tuesday. The owner's Alt+Z reading, not a measurement (see the header);
// overridable by the user, who sets the same value the Lockouts grid uses - the two must never
// differ. This is only the default.
const DEFAULT_RESET = { weekday: 2, hour: 11 };

// How long a log must have been still before it is touched. The host's own quiet check watches the
// ONE log the tailer is following; this one asks each file directly, because a second account can
// be writing to its own log while the watched one is idle - and the rotation empties every one of
// them on the strength of that single file's silence.
const QUIET_MS = 10000;

/**
 * The most recent reset boundary at or before `now`.
 *
 * The reset day/hour are US EASTERN - the server's zone - resolved to an absolute instant with the
 * daylight-saving change already handled (easternReset.js). A player whose machine is on a
 * different zone still gets the right instant, and comparisons against log-line timestamps (which
 * logSplitter parses as local Dates, i.e. absolute instants) stay correct.
 */
function resetBoundaryBefore(now = new Date(), rule = DEFAULT_RESET) {
  const weekday = Number.isInteger(rule.weekday) ? rule.weekday : DEFAULT_RESET.weekday;
  const hour = Number.isInteger(rule.hour) ? rule.hour : DEFAULT_RESET.hour;
  return new Date(easternResetBefore(now, weekday, hour));
}

/**
 * Where the rotation cuts the log. Identical to `resetBoundaryBefore` today: the host always
 * supplies an hour (default 11) and passes the same hour to lockoutCore's grid, so the cut and the
 * grid's period boundary are the same instant.
 *
 * Kept as its own name because the two were briefly different (commit 6834d78 cut at the boundary
 * DAY's midnight, when lockoutCore ran with `hour: null`, and named the archive for 11:00). If the
 * grid ever goes back to an unknown hour, re-introduce that split HERE — never let the cut drift
 * from what lockoutCore's grid uses, or a kill in the gap reads as "raid available" when it's
 * done. That was 6834d78's bug.
 */
function rotationCutBefore(now = new Date(), rule = DEFAULT_RESET) {
  return resetBoundaryBefore(now, rule);
}

/**
 * `2026-09-01`, the EASTERN calendar date of a boundary instant - the day the lockout week actually
 * turns over on the server. Used to name archives and to recognise them again, so the name is the
 * same for every player regardless of the zone their own machine is on. (Reading the boundary's
 * LOCAL fields here - as this did until 31 Aug 2026 - named the wrong day for anyone not on Eastern,
 * which is also why 8 tests only passed in that one zone.)
 */
// A boundary may arrive as a Date, an epoch-ms number, or an ISO string (report.boundary).
function boundaryMs(boundary) {
  if (boundary instanceof Date) return boundary.getTime();
  if (typeof boundary === 'number') return boundary;
  return new Date(boundary).getTime();
}

function boundaryKey(boundary) {
  const p = (n) => String(n).padStart(2, '0');
  const e = easternParts(boundaryMs(boundary));
  return `${e.year}-${p(e.month)}-${p(e.day)}`;
}

/** The Eastern wall-clock hour of a boundary instant - 11 for the default reset, in any machine zone. */
function boundaryHour(boundary) {
  const ms = boundaryMs(boundary);
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(ms)).find((x) => x.type === 'hour').value
  );
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
// How much to read at a time when stepping over a run of NUL padding. See firstNonNulOffset.
const CHUNK_BYTES = 1024 * 1024;

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
/**
 * The offset of the first byte that is not a NUL.
 *
 * A writer that keeps its own file offset across a truncation leaves exactly as many NUL bytes as
 * the file used to be long. WHICH MODE EVERQUEST USES IS UNMEASURED: an append handle pads nothing,
 * a read-write handle pads everything, and no log on this machine can settle it because
 * `Logs/Archive` does not exist - the manual archive has never been run here, so no truncation has
 * ever happened to these files. The absence of NUL bytes in the corpus is therefore not evidence
 * either way, and it was briefly mistaken for some.
 *
 * If it is the padding case, the run is the size of the whole previous week - a hundred and forty
 * megabytes on this machine - so a fixed two-megabyte search window never reaches the first real
 * line, and the rotation would refuse that log for ever while it grew without bound. Stepping over
 * the run costs one pass of a file we are about to copy anyway.
 */
function firstNonNulOffset(fd, size) {
  const buf = Buffer.alloc(CHUNK_BYTES);
  let at = 0;
  while (at < size) {
    const want = Math.min(CHUNK_BYTES, size - at);
    const read = fs.readSync(fd, buf, 0, want, at);
    if (!read) return at;
    for (let i = 0; i < read; i += 1) {
      if (buf[i] !== 0) return at + i;
    }
    at += read;
  }
  return size;
}

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
    // Step over any NUL padding first, so the search window is spent on log rather than on zeroes.
    const from = firstNonNulOffset(fd, size);
    if (from >= size) return null;
    for (const window of [HEAD_BYTES, HEAD_BYTES_MAX]) {
      const want = Math.min(window, size - from);
      if (!want) return null;
      const buf = Buffer.alloc(want);
      const read = fs.readSync(fd, buf, 0, want, from);
      if (!read) return null;
      for (const line of buf.slice(0, read).toString('utf8').split('\n')) {
        const ms = extractTimestampMs(stripPadding(line));
        if (ms !== null) return ms;
      }
      if (from + want >= size) return null;
    }
    return null;
  } catch (err) {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

/**
 * The byte offset where the current lockout week begins - the first line at or after `cutMs`.
 *
 * SCANNED UPWARD from the end. The log is chronological, so there is a single transition: lines
 * below it are >= cutMs, lines above are older. Reading backward in 64 KB chunks stops at that
 * transition after touching only ~one week of the file, however large the whole thing is.
 *
 * Returns `size` if the newest line is already older than the boundary (whole file is last week),
 * or 0 if the scan reaches the start without crossing it (whole file is this week). `fd` is an
 * open read handle; the caller owns it.
 */
function findWeekStartOffset(fd, size, cutMs) {
  const CH = 1 << 16;
  let pos = size;                 // everything from pos..size has been processed
  let weekStart = size;           // oldest line confirmed >= cutMs; `size` = none seen yet
  let carry = Buffer.alloc(0);    // leading partial of the last buf - continues into the earlier chunk
  const chunk = Buffer.alloc(CH);

  while (pos > 0) {
    const readStart = Math.max(0, pos - CH);
    const want = pos - readStart;
    fs.readSync(fd, chunk, 0, want, readStart);
    const buf = Buffer.concat([chunk.slice(0, want), carry]); // buf[0] is at file offset readStart

    const text = buf.toString('latin1'); // EQ logs are latin1/ASCII - 1 char == 1 byte, offsets hold
    const segs = text.split('\n');
    // segs[k] occupies [start_k, start_k + segs[k].length); the byte after it is '\n' (bar the last).
    const starts = [];
    let off = readStart;
    for (const s of segs) { starts.push(off); off += s.length + 1; }

    // segs[0] is a partial continuing from an earlier chunk unless we are at the file start.
    const judgeFrom = readStart === 0 ? 0 : 1;
    for (let k = segs.length - 1; k >= judgeFrom; k--) {
      const line = segs[k];
      if (!line.length) continue;
      const ms = extractTimestampMs(stripPadding(line));
      if (ms === null) continue;              // unstamped: leave weekStart, do not stop (goes to archive)
      if (ms >= cutMs) weekStart = starts[k];
      else return weekStart;                  // crossed the boundary
    }
    if (readStart === 0) return weekStart;     // reached the start of the file without crossing

    const firstNL = buf.indexOf(0x0a);
    carry = firstNL === -1 ? buf : buf.slice(0, firstNL + 1);
    pos = readStart;
  }
  return weekStart;
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
    // ON by default (owner's call). The weekly archive is what keeps the live log scoped to the
    // current lockout week, which is what the Lockouts grid depends on - so it should work out of
    // the box. It still refuses to touch a log that has been played on since the reset, and it
    // copies-and-verifies before it truncates. An explicit off in the settings file is honoured.
    this.enabled = true;
    // The reset day/hour. The SAME value the Lockouts grid uses - main.js loads it once and pushes
    // it to both. Defaulted here so the module works standalone in a test.
    this.resetRule = { ...DEFAULT_RESET };
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

  // The reset day/hour. Set from main.js whenever the user changes it (Lockouts page or Setup -
  // one setting, one store key), so this and lockoutCore always agree on where the week begins.
  setResetRule(rule) {
    const weekday = Number.isInteger(rule && rule.weekday) ? ((rule.weekday % 7) + 7) % 7 : this.resetRule.weekday;
    const hour = Number.isInteger(rule && rule.hour) ? Math.min(23, Math.max(0, rule.hour)) : this.resetRule.hour;
    this.resetRule = { weekday, hour };
    return this.resetRule;
  }

  loadSettings() {
    // ON unless the file explicitly says otherwise. A missing file, or a missing key, is the
    // default (on); only `enabled: false` written down turns it off.
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

    // The reset instant, which is what the archive is NAMED for and what the status reports.
    const boundary = resetBoundaryBefore(now, this.resetRule);
    // Where the bytes are actually divided. Equal to `boundary` today (the hour is always set);
    // kept separate in case the cut and the boundary ever diverge again — see rotationCutBefore.
    const cut = rotationCutBefore(now, this.resetRule);
    report.boundary = boundary.toISOString();
    report.cut = cut.toISOString();
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
        if (firstMs >= cut.getTime()) {
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
        if (lastMs !== null && lastMs >= cut.getTime()) {
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

  // Does this log's last line fall in the current lockout week? If so, archiving it whole removes
  // this week's kills from what the Lockouts grid reads - the manual "Archive log now" button
  // warns on the strength of this.
  logHoldsCurrentWeek(filePath, now = new Date()) {
    try {
      if (!filePath || !fs.existsSync(filePath)) return false;
      const size = fs.statSync(filePath).size;
      if (!size) return false;
      const last = lastStampMs(filePath, size);
      return last !== null && last >= rotationCutBefore(now, this.resetRule).getTime();
    } catch (err) {
      return false;
    }
  }

  /**
   * Split ONE log at this week's reset: archive everything before it, keep everything after.
   *
   * The manual, any-number-of-weeks counterpart to rotateIfDue. The weekly rotation REFUSES a log
   * that holds more than the current week (`skippedSpansBoundary`) rather than risk moving this
   * week's kills into the archive - which leaves a multi-week log stuck. This is how the user
   * unsticks it from the Lockouts page.
   *
   * Same care as rotateIfDue: only when the log has been quiet (EQ is not mid-write), the archived
   * front is written to its own file and size-verified, and the live log is checked for growth
   * before it is rewritten. `filePath` is the log to trim - normally the watched one.
   */
  trimAtBoundary(filePath, now = new Date()) {
    const out = { ok: false, reason: null, archivedTo: null, archivedBytes: 0, keptBytes: 0, keptFrom: 0 };
    try {
      if (!filePath || !fs.existsSync(filePath)) { out.reason = 'no log file'; return out; }
      if (!this.isQuietFn()) { out.reason = 'the log is being written to right now - try again in a moment'; return out; }

      const size = fs.statSync(filePath).size;
      if (!size) { out.reason = 'the log is empty'; return out; }
      const cutMs = rotationCutBefore(now, this.resetRule).getTime();

      // WHERE THIS WEEK STARTS. Scanned UPWARD from the end - the log is chronological, so this
      // week's lines are all at the bottom and the scan stops the moment it crosses the boundary.
      // On a multi-week log this touches ~one week of bytes rather than the whole file.
      const sfd = fs.openSync(filePath, 'r');
      let offset;
      try {
        offset = findWeekStartOffset(sfd, size, cutMs);
      } finally {
        fs.closeSync(sfd);
      }

      if (offset === 0) { out.reason = 'nothing before this week - the log is already just this week'; return out; }

      const archiveDir = path.join(path.dirname(filePath), 'Archive');
      fs.mkdirSync(archiveDir, { recursive: true });
      const boundaryDate = boundaryKey(resetBoundaryBefore(now, this.resetRule));
      const base = path.basename(filePath, path.extname(filePath));
      let archivePath = path.join(archiveDir, `${base}_before_${boundaryDate}.txt`);
      let n = 2;
      while (fs.existsSync(archivePath)) archivePath = path.join(archiveDir, `${base}_before_${boundaryDate}_${n++}.txt`);

      // Copy the front [0, offset) to the archive in 1 MB chunks - never the whole file in memory.
      const rfd = fs.openSync(filePath, 'r');
      const wfd = fs.openSync(archivePath, 'w');
      const cbuf = Buffer.alloc(1 << 20);
      let copied = 0;
      try {
        while (copied < offset) {
          const want = Math.min(cbuf.length, offset - copied);
          const nread = fs.readSync(rfd, cbuf, 0, want, copied);
          if (!nread) break;
          fs.writeSync(wfd, cbuf, 0, nread);
          copied += nread;
        }
        fs.fsyncSync(wfd);
      } finally {
        fs.closeSync(rfd);
        fs.closeSync(wfd);
      }
      if (fs.statSync(archivePath).size !== offset) {
        try { fs.unlinkSync(archivePath); } catch (e) { /* leave it */ }
        out.reason = 'the archive did not verify - nothing was changed';
        return out;
      }

      // The kept tail is one week - small enough to hold while the live log is rewritten.
      const keepLen = size - offset;
      const keep = Buffer.alloc(keepLen);
      if (keepLen) {
        const kfd = fs.openSync(filePath, 'r');
        fs.readSync(kfd, keep, 0, keepLen, offset);
        fs.closeSync(kfd);
      }
      if (fs.statSync(filePath).size !== size) {
        try { fs.unlinkSync(archivePath); } catch (e) { /* leave it */ }
        out.reason = 'the log grew while the trim was running - try again';
        return out;
      }

      fs.writeFileSync(filePath, keep); // truncates and replaces in one call
      out.ok = true;
      out.archivedTo = archivePath;
      out.archivedBytes = offset;
      out.keptBytes = keepLen;
      out.keptFrom = offset; // the host resyncs the tailer/splitter to keepLen, not 0 - see main.js
      return out;
    } catch (err) {
      this._note(err);
      out.reason = err && err.message ? err.message : String(err);
      return out;
    }
  }

  getStatus() {
    return {
      enabled: this.enabled,
      resetRule: { ...this.resetRule },
      lastRun: this.lastRun,
      lastCheck: this.lastCheck,
      nextBoundaryAfterNow: (() => {
        const weekday = Number.isInteger(this.resetRule.weekday) ? this.resetRule.weekday : DEFAULT_RESET.weekday;
        const hour = Number.isInteger(this.resetRule.hour) ? this.resetRule.hour : DEFAULT_RESET.hour;
        // Resolved through the Eastern zone (not a local +7 days), so a DST change inside the week
        // keeps it at 11:00 Eastern rather than drifting an hour.
        return new Date(easternResetAfter(new Date(), weekday, hour)).toISOString();
      })(),
      errors: this.errors,
      lastError: this.lastError,
    };
  }
}

module.exports = {
  LogRotationService,
  resetBoundaryBefore,
  rotationCutBefore,
  boundaryKey,
  boundaryHour,
  archiveNameFor,
  DEFAULT_RESET,
};
