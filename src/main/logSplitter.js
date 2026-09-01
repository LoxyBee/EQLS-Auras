const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

// EQ log lines start with e.g. "[Sun Aug 16 12:11:41 2026] ..."
//
// TOLERANCE, NOT A BUG FIX, and the difference is worth stating because it was got wrong once.
//
// The two-space form is what C's ctime()/asctime() produces: it right-aligns the day in two
// columns, so the 1st to the 9th come out as "Aug  4". EverQuest Legends writes the DAY with
// strftime's %d, which is zero-padded - "Aug 04". The two formats look so alike that one was
// mistaken for the other here. (The client does pad other columns: /who output for an AFK player
// carries two spaces after the closing bracket. So "EQ never emits a double space" would be wrong;
// what is true is that it does not space-pad the day.)
//
// MEASURED over every EverQuest log on this machine, deduplicated by content hash - 67 files on
// disk, 34 distinct, the rest being worktree copies of each other:
//
//     stamped lines                          9,026,690
//     lines on days 1-9                      1,381,716   (Aug 04 through Aug 09)
//     lines the ORIGINAL pattern misread             0
//
// The client's own line, byte for byte, is the example: "[Tue Aug 04 13:33:15 2026] Logging to
// 'eqlog.txt' is now *ON*." - the bytes at the day are 20 30 34, space-zero-four.
//
// So the widening below fixes nothing that was broken. It is kept because it is free, and because
// it costs a zero-padded log nothing to also accept a format some other client might write. What it
// is NOT is evidence that anything was ever misfiled - nothing was.
const TIMESTAMP_PATTERN = /^\[\w{3} (\w{3}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})\]/;
const FLUSH_LINE_THRESHOLD = 5000;
const POLL_INTERVAL_MS = 1000;

// The hour (0-23, local) at which the per-day split file rolls over. Default 0 = calendar
// midnight. Set higher (e.g. 6) so a raid night that runs past midnight stays in ONE file - the
// file dated for the day it STARTED - instead of being cut in two. Only changes which copy-file a
// line is filed under; the live log and every line's real timestamp are untouched (QOL #23).
const DEFAULT_DAY_START_HOUR = 0;
function clampDayStartHour(h) {
  const n = Number(h);
  return Number.isInteger(n) && n >= 0 && n <= 23 ? n : DEFAULT_DAY_START_HOUR;
}

// WHEN A LINE HAS NO READABLE STAMP, it is filed under the day of the line before it. That is
// correct and it is why the rule exists: EverQuest wraps a long server broadcast onto continuation
// lines that carry no stamp of their own, and those belong with the line above.
//
// It is also almost never used. Measured over the owner's real log: 1,761,090 lines, TEN of them
// unstamped - 0.0006%, and all ten were continuations of "we must bring the servers down for a
// hotfix". So the rule is right and rare, which makes the RATE a very sharp instrument.
//
// If the parser ever stops understanding the log's format, that rate does not creep - it jumps
// toward 100%, because it is one pattern reading one format. Five orders of magnitude.
//
// This exists because of a mistake rather than a bug: the day pattern was widened on the strength
// of a reasoned claim that EverQuest space-pads single-digit days, and the claim was wrong - see
// the note on TIMESTAMP_PATTERN, and 9.6 million real lines that say so. Nothing had been misfiled.
// But the reason it took a measurement to find that out is that NOTHING WAS COUNTING. Had the day
// pattern really stopped matching, every line of the 1st would have gone into the 31st's file and
// the app would have carried on without a word.
//
// Five per cent is roughly eight thousand times the observed baseline, so this cannot cry wolf on
// a real log; and the minimum sample stops a handful of broadcast lines in a quiet batch tripping
// it. What it catches is the whole class: a client patch, a locale change, a format we have never
// seen. The tool should notice when it can no longer read what it is reading.
const UNSTAMPED_ALARM_RATIO = 0.05;
// Enough lines for the ratio to mean something. ACCUMULATED ACROSS BATCHES, not required within
// one - and that distinction is the difference between an alarm that works and one that cannot
// fire at all. A batch is one poll, one second. Measured on the owner's real log, a second holds a
// median of 6 lines, 60 at the 99th percentile and 182 at its absolute peak, so a live batch never
// reaches two hundred. Requiring it per batch meant the alarm could only ever fire on a startup
// backfill: a format that broke mid-session was 100% unreadable and announced nothing, which is
// precisely the case it exists for.
const UNSTAMPED_ALARM_MIN_LINES = 200;

// `dayStartHour` 0 (the default) is the fast path: the date in the stamp IS the file's date, pure
// string work, and it is the path the UNSTAMPED_ALARM reasoning below is measured against. A
// non-zero hour shifts the stamp back by that many hours before taking the date, so anything
// before <hour>:00 lands in the previous day's file.
function extractDateKey(line, dayStartHour = 0) {
  const match = TIMESTAMP_PATTERN.exec(line);
  if (!match) return null;
  const [, monAbbr, day, hh, mm, ss, year] = match;
  const month = MONTHS[monAbbr];
  if (!month) return null;
  if (!dayStartHour) return `${year}-${month}-${day.padStart(2, '0')}`;
  const t = new Date(`${year}-${month}-${day.padStart(2, '0')}T${hh}:${mm}:${ss}`);
  if (Number.isNaN(t.getTime())) return null;
  t.setHours(t.getHours() - dayStartHour);
  const p = (n) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())}`;
}

function extractTimestampMs(line) {
  const match = TIMESTAMP_PATTERN.exec(line);
  if (!match) return null;
  const [, monAbbr, day, hh, mm, ss, year] = match;
  const month = MONTHS[monAbbr];
  if (!month) return null;
  const ms = new Date(`${year}-${month}-${day.padStart(2, '0')}T${hh}:${mm}:${ss}`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// Last wall-clock stamp already written into a per-day Split file. Used to make a
// re-split from offset 0 (lost/reset splitProgress, or a bookmark file that was
// wiped) a no-op instead of doubling every line: anything at or before this is
// already on disk. Reads only the tail, since that is where the newest line is.
function lastStampMsInFile(filePath) {
  let fd;
  try {
    const size = fs.statSync(filePath).size;
    if (!size) return null;
    const readLen = Math.min(size, 65536);
    const buf = Buffer.alloc(readLen);
    fd = fs.openSync(filePath, 'r');
    fs.readSync(fd, buf, 0, readLen, size - readLen);
    const lines = buf.toString('latin1').split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
      const ms = extractTimestampMs(lines[i]);
      if (ms !== null) return ms;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* already gone */ }
    }
  }
}

// Continuously copies lines from the active eqlog file into per-day
// files under a Split folder (default, or a user-chosen one), so a log
// that's never cleared doesn't turn into one unmanageable multi-hundred-MB
// file. Remembers how far it's already processed (per file path) so
// restarting the app doesn't redo work. Can be turned off entirely, and can
// optionally start a new file whenever there's a large gap in log activity
// (a proxy for /log off followed by /log on later, even same-day).
class LogSplitter {
  constructor(store) {
    this.store = store; // { loadJson, saveJson }
    this.progress = store.loadJson('splitProgress', {});

    const settings = store.loadJson('splitSettings', {});
    // OFF by default (changed for the first public release). It maintains a parallel per-day copy
    // of the log - useful, but disk-doubling and unexpected on a fresh "buff overlay" install, and
    // nothing core depends on it (lockouts read the live log directly - see lockoutService.js).
    // Only `enabled: true` written down (the user ticking the box) turns it on; an install that had
    // ticked it keeps its saved value.
    this.enabled = settings.enabled === true;
    this.dayStartHour = clampDayStartHour(settings.splitDayStartHour);
    this.customOutputDir = settings.customOutputDir || null;

    this.filePath = null;
    this.outputDir = null;
    this.offset = 0;
    this.lastDateKeySeen = null;
    this.timer = null;
    this.processing = false;

    // How much of the log this parser could and could not read. Cumulative for the session.
    this.stampedLines = 0;
    this.unstampedLines = 0;
    // Set when a batch reads as mostly unreadable. Sticky, because the point of it is to still be
    // there when somebody eventually looks.
    this.formatAlarm = null;
    // The rolling window the ratio is judged over. Reset each time it is judged, so a bad patch of
    // log cannot be diluted forever by the good hours either side of it.
    this.windowStamped = 0;
    this.windowUnstamped = 0;
    this.windowSample = null;
    // Injected by the host so this module keeps owning no logger. Defaults to saying nothing.
    this.onFormatAlarm = () => {};
  }

  /**
   * What the splitter has been able to read. The ratio is the useful part - see the note on
   * UNSTAMPED_ALARM_RATIO for why an unstamped line is normal and a lot of them is not.
   */
  getStatus() {
    const total = this.stampedLines + this.unstampedLines;
    return {
      enabled: this.enabled,
      filePath: this.filePath,
      outputDir: this.outputDir,
      lastDateKeySeen: this.lastDateKeySeen,
      stampedLines: this.stampedLines,
      unstampedLines: this.unstampedLines,
      unstampedRatio: total ? this.unstampedLines / total : 0,
      formatAlarm: this.formatAlarm,
    };
  }

  /**
   * How far the splitter still has to read before it has seen the whole live log.
   *
   * The weekly rotation asks this before emptying anything. Truncation makes _processOnce reset the
   * offset to 0, so whatever the splitter had not reached yet never reaches Logs/Split/ - it is all
   * safe in the archive, but the per-day folder gets a hole. Measured with the real modules: a
   * rotation fired against a 400,000-line backlog left every one of those lines out of Split/.
   *
   * Not reachable at ordinary speeds - the splitter reads the owner's real 140 MB log in 1.3 s and
   * the rotation's first check is a minute after launch - so this guard exists to make the
   * invariant explicit rather than accidental, and to cover the case it would take: a first launch
   * against a log somebody let grow for a year.
   *
   * Zero when splitting is off, because then there is nothing to protect.
   */
  bytesBehind() {
    if (!this.enabled || !this.filePath) return 0;
    try {
      return Math.max(0, fs.statSync(this.filePath).size - this.offset);
    } catch {
      return 0;
    }
  }

  setOnFormatAlarm(fn) {
    if (typeof fn === 'function') this.onFormatAlarm = fn;
  }

  attachToFile(filePath) {
    if (this.filePath === filePath) return;
    this.filePath = filePath;
    this.outputDir = this.customOutputDir || path.join(path.dirname(filePath), 'Split');
    fs.mkdirSync(this.outputDir, { recursive: true });

    const saved = this.progress[filePath];
    if (saved && typeof saved === 'object') {
      this.offset = saved.offset || 0;
      this.lastDateKeySeen = saved.lastDateKeySeen || null;
    } else {
      // Legacy format was a plain offset number - still fine to reuse.
      this.offset = typeof saved === 'number' ? saved : 0;
      this.lastDateKeySeen = null;
    }

    this._scheduleProcessing();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    this._persistSettings();
    if (enabled) {
      if (this.filePath) this._scheduleProcessing();
    } else if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // QOL #23 - the hour (0-23) the per-day file rolls over. Takes effect for lines processed from
  // now on; existing split files are not rewritten.
  setDayStartHour(hour) {
    this.dayStartHour = clampDayStartHour(hour);
    this._persistSettings();
    return this.dayStartHour;
  }

  setOutputDir(dir) {
    this.customOutputDir = dir || null;
    this._persistSettings();
    if (this.filePath) {
      this.outputDir = this.customOutputDir || path.join(path.dirname(this.filePath), 'Split');
      fs.mkdirSync(this.outputDir, { recursive: true });
    }
  }

  getSettings() {
    return {
      enabled: this.enabled,
      dayStartHour: this.dayStartHour,
      outputDir: this.outputDir,
      customOutputDir: this.customOutputDir,
      // Rides along with the settings because this is the payload that already reaches the Setup
      // page. A counter nobody reads is not an improvement on not counting, and the first version
      // of this alarm reached only a console the owner never opens.
      formatAlarm: this.formatAlarm,
    };
  }

  _persistSettings() {
    this.store.saveJson('splitSettings', {
      enabled: this.enabled,
      splitDayStartHour: this.dayStartHour,
      customOutputDir: this.customOutputDir,
    });
  }

  /**
   * Did this batch read like a log we understand?
   *
   * Raised once and left standing. A batch that is mostly unreadable does not mean the log is
   * broken - it means THIS PARSER has stopped matching what the game writes, and every one of
   * those lines has just been filed under whatever day was last recognised. Saying so is the
   * difference between the bug that prompted this (nine days a month quietly in the wrong file,
   * for as long as nobody thought to check) and a line in the log that names it.
   */
  _checkReadability(stamped, unstamped, sample, dateKey) {
    if (this.formatAlarm) return;
    this.windowStamped += stamped;
    this.windowUnstamped += unstamped;
    if (this.windowSample === null && sample !== null) this.windowSample = sample;

    const total = this.windowStamped + this.windowUnstamped;
    if (total < UNSTAMPED_ALARM_MIN_LINES) return;

    const ratio = this.windowUnstamped / total;
    const unstampedInWindow = this.windowUnstamped;
    const windowSample = this.windowSample;
    this.windowStamped = 0;
    this.windowUnstamped = 0;
    this.windowSample = null;
    if (ratio < UNSTAMPED_ALARM_RATIO) return;

    this.formatAlarm = {
      ratio,
      unstamped: unstampedInWindow,
      total,
      sample: windowSample,
      lastDateKeySeen: dateKey || this.lastDateKeySeen,
    };
    this.onFormatAlarm(this.formatAlarm);
  }

  // The live log was rewritten in place by a trim (logRotation.trimAtBoundary) - the front was
  // moved to Archive and the kept tail is now at byte 0. This week's tail was ALREADY split into
  // the per-day files, so re-reading it from 0 would double those lines. Skip straight to the new
  // end. `lastDateKeySeen` carries over - the tail is the same content, just relocated.
  resyncOffset(filePath, bytes) {
    if (this.filePath !== filePath) return;
    this.offset = Math.max(0, bytes | 0);
    this._persistProgress();
  }

  _persistProgress() {
    this.progress[this.filePath] = {
      offset: this.offset,
      lastDateKeySeen: this.lastDateKeySeen,
    };
    this.store.saveJson('splitProgress', this.progress);
  }

  _scheduleProcessing() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.enabled) return;
    this._processOnce();
    this.timer = setInterval(() => this._processOnce(), POLL_INTERVAL_MS);
  }

  _processOnce() {
    if (this.processing || !this.filePath || !this.enabled) return;

    let stat;
    try {
      stat = fs.statSync(this.filePath);
    } catch {
      return;
    }

    if (stat.size < this.offset) {
      // File got truncated/archived out from under us - resume from its new
      // end and treat whatever comes next as a fresh session.
      this.offset = 0;
      this.lastDateKeySeen = null;
    }

    if (stat.size <= this.offset) return;

    this.processing = true;
    const startOffset = this.offset;
    const baseName = path.basename(this.filePath, path.extname(this.filePath));
    // Reading from byte 0 means the bookmark was lost or reset. This week's tail
    // is already in the per-day files, so re-appending it would double it. Guard
    // each incoming line against the day-file's own last stamp.
    const dedupe = startOffset === 0;
    const dedupeCutoff = new Map(); // outPath -> last ms already on disk (null = file absent/empty)
    const dedupeKept = new Map();   // dateKey -> was the last stamped line kept? (for unstamped follow-on lines)
    const cutoffFor = (outPath) => {
      if (!dedupeCutoff.has(outPath)) dedupeCutoff.set(outPath, lastStampMsInFile(outPath));
      return dedupeCutoff.get(outPath);
    };
    const buffers = new Map(); // key: dateKey -> lines[]
    let bufferedLineCount = 0;
    let lastDateKey = this.lastDateKeySeen;

    const flush = () => {
      for (const [dateKey, lines] of buffers) {
        if (lines.length === 0) continue;
        const outPath = path.join(this.outputDir, `${baseName}_${dateKey}.txt`);
        fs.appendFileSync(outPath, lines.join('\n') + '\n', 'utf8');
        lines.length = 0;
      }
      bufferedLineCount = 0;
    };

    const stream = fs.createReadStream(this.filePath, { start: startOffset, encoding: 'utf8' });
    const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

    let stampedBatch = 0;
    let unstampedBatch = 0;
    let firstUnstamped = null;

    rl.on('line', (line) => {
      if (line.length === 0) return;
      const parsedDateKey = extractDateKey(line, this.dayStartHour);
      if (parsedDateKey) {
        lastDateKey = parsedDateKey;
        stampedBatch += 1;
      } else {
        unstampedBatch += 1;
        if (firstUnstamped === null) firstUnstamped = line.slice(0, 120);
      }
      const dateKey = parsedDateKey || lastDateKey;
      if (!dateKey) return; // no timestamp seen yet - can't bucket this line

      if (dedupe) {
        const outPath = path.join(this.outputDir, `${baseName}_${dateKey}.txt`);
        const cutoff = cutoffFor(outPath);
        if (cutoff !== null) {
          const ts = extractTimestampMs(line);
          if (ts !== null) {
            const keep = ts > cutoff;
            dedupeKept.set(dateKey, keep);
            if (!keep) return; // already on disk
          } else if (dedupeKept.get(dateKey) === false) {
            return; // trails a line we skipped
          }
        }
      }

      if (!buffers.has(dateKey)) buffers.set(dateKey, []);
      buffers.get(dateKey).push(line);
      bufferedLineCount++;
      if (bufferedLineCount >= FLUSH_LINE_THRESHOLD) flush();
    });

    rl.on('close', () => {
      flush();
      this.stampedLines += stampedBatch;
      this.unstampedLines += unstampedBatch;
      // lastDateKey, not this.lastDateKeySeen - the latter is assigned further down, so reading it
      // here reported the PREVIOUS batch's day, or "null" on the first one. The whole value of the
      // message is naming the day those lines went to.
      this._checkReadability(stampedBatch, unstampedBatch, firstUnstamped, lastDateKey);
      let newSize;
      try {
        newSize = fs.statSync(this.filePath).size;
      } catch {
        newSize = startOffset;
      }
      this.offset = newSize;
      this.lastDateKeySeen = lastDateKey;
      this._persistProgress();
      this.processing = false;
    });

    stream.on('error', () => {
      this.processing = false;
    });
  }
}

// extractTimestampMs is exported so the weekly rotation can ask "does this log still hold
// anything from before the current lockout week" using the SAME stamp parser the splitter
// uses, rather than a second copy of the pattern that could drift away from it.
module.exports = { LogSplitter, extractTimestampMs };
