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
// columns, so the 1st to the 9th come out as "Aug  4". EverQuest Legends does NOT do this. It uses
// strftime("%a %b %d %H:%M:%S %Y"), whose %d is zero-padded by definition, and the two formats look
// so alike that one was mistaken for the other.
//
// MEASURED, on 28 real logs on this machine: 9,621,621 stamped lines, 1,957,073 of them on days 1
// to 9, and the ORIGINAL one-space pattern read every single one. Zero failures. The client's own
// line "[Tue Aug 04 13:33:15 2026] Logging to 'eqlog.txt' is now *ON*" is a byte-level example.
//
// So the widening below fixes nothing that was broken. It is kept because it is free, and because
// it costs a zero-padded log nothing to also accept a format some other client might write. What it
// is NOT is evidence that anything was ever misfiled - nothing was.
const TIMESTAMP_PATTERN = /^\[\w{3} (\w{3}) {1,2}(\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})\]/;
const FLUSH_LINE_THRESHOLD = 5000;
const POLL_INTERVAL_MS = 1000;

// There's no log line for "/log off" or "/log on" - the game just stops
// writing entirely while logging is off, then resumes. The only trace of
// that is a gap in line timestamps, so that's what "start a new file on
// /log off + /log on" has to detect. This threshold is how long a gap has
// to be before it's treated as a real logging break rather than normal
// in-game quiet time.
const SESSION_GAP_MS = 10 * 60 * 1000;

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
const UNSTAMPED_ALARM_MIN_LINES = 200;

function extractDateKey(line) {
  const match = TIMESTAMP_PATTERN.exec(line);
  if (!match) return null;
  const [, monAbbr, day, , , , year] = match;
  const month = MONTHS[monAbbr];
  if (!month) return null;
  return `${year}-${month}-${day.padStart(2, '0')}`;
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

function formatSessionSuffix(ms) {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${hh}${mm}${ss}`;
}

// Continuously copies lines from the active eqlog file into per-calendar-day
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
    this.enabled = settings.enabled !== false;
    this.splitOnGap = settings.splitOnGap === true;
    this.customOutputDir = settings.customOutputDir || null;

    this.filePath = null;
    this.outputDir = null;
    this.offset = 0;
    this.lastDateKeySeen = null;
    this.lastTimestampMs = null;
    this.sessionSuffix = '';
    this.timer = null;
    this.processing = false;

    // How much of the log this parser could and could not read. Cumulative for the session.
    this.stampedLines = 0;
    this.unstampedLines = 0;
    // Set when a batch reads as mostly unreadable. Sticky, because the point of it is to still be
    // there when somebody eventually looks.
    this.formatAlarm = null;
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
      this.lastTimestampMs = saved.lastTimestampMs || null;
      this.sessionSuffix = saved.sessionSuffix || '';
    } else {
      // Legacy format was a plain offset number - still fine to reuse.
      this.offset = typeof saved === 'number' ? saved : 0;
      this.lastDateKeySeen = null;
      this.lastTimestampMs = null;
      this.sessionSuffix = '';
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

  setSplitOnGap(splitOnGap) {
    this.splitOnGap = splitOnGap;
    this._persistSettings();
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
      splitOnGap: this.splitOnGap,
      outputDir: this.outputDir,
      customOutputDir: this.customOutputDir,
    };
  }

  _persistSettings() {
    this.store.saveJson('splitSettings', {
      enabled: this.enabled,
      splitOnGap: this.splitOnGap,
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
  _checkReadability(stamped, unstamped, sample) {
    const total = stamped + unstamped;
    if (total < UNSTAMPED_ALARM_MIN_LINES) return;
    const ratio = unstamped / total;
    if (ratio < UNSTAMPED_ALARM_RATIO) return;
    if (this.formatAlarm) return;
    this.formatAlarm = {
      ratio,
      unstamped,
      total,
      sample,
      lastDateKeySeen: this.lastDateKeySeen,
    };
    this.onFormatAlarm(this.formatAlarm);
  }

  _persistProgress() {
    this.progress[this.filePath] = {
      offset: this.offset,
      lastDateKeySeen: this.lastDateKeySeen,
      lastTimestampMs: this.lastTimestampMs,
      sessionSuffix: this.sessionSuffix,
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
      this.lastTimestampMs = null;
      this.sessionSuffix = '';
    }

    if (stat.size <= this.offset) return;

    this.processing = true;
    const startOffset = this.offset;
    const baseName = path.basename(this.filePath, path.extname(this.filePath));
    const buffers = new Map(); // key: "dateKey|sessionSuffix" -> lines[]
    let bufferedLineCount = 0;
    let lastDateKey = this.lastDateKeySeen;
    let lastTimestampMs = this.lastTimestampMs;
    let sessionSuffix = this.sessionSuffix;

    const flush = () => {
      for (const [key, lines] of buffers) {
        if (lines.length === 0) continue;
        const [dateKey, suffix] = key.split('|');
        const suffixPart = suffix ? `_${suffix}` : '';
        const outPath = path.join(this.outputDir, `${baseName}_${dateKey}${suffixPart}.txt`);
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
      const parsedDateKey = extractDateKey(line);
      if (parsedDateKey) {
        lastDateKey = parsedDateKey;
        stampedBatch += 1;
      } else {
        unstampedBatch += 1;
        if (firstUnstamped === null) firstUnstamped = line.slice(0, 120);
      }
      const dateKey = parsedDateKey || lastDateKey;
      if (!dateKey) return; // no timestamp seen yet - can't bucket this line

      if (this.splitOnGap) {
        const ts = extractTimestampMs(line);
        if (ts !== null) {
          if (lastTimestampMs !== null && ts - lastTimestampMs > SESSION_GAP_MS) {
            sessionSuffix = formatSessionSuffix(ts);
          }
          lastTimestampMs = ts;
        }
      } else {
        sessionSuffix = '';
      }

      const key = `${dateKey}|${sessionSuffix}`;
      if (!buffers.has(key)) buffers.set(key, []);
      buffers.get(key).push(line);
      bufferedLineCount++;
      if (bufferedLineCount >= FLUSH_LINE_THRESHOLD) flush();
    });

    rl.on('close', () => {
      flush();
      this.stampedLines += stampedBatch;
      this.unstampedLines += unstampedBatch;
      this._checkReadability(stampedBatch, unstampedBatch, firstUnstamped);
      let newSize;
      try {
        newSize = fs.statSync(this.filePath).size;
      } catch {
        newSize = startOffset;
      }
      this.offset = newSize;
      this.lastDateKeySeen = lastDateKey;
      this.lastTimestampMs = lastTimestampMs;
      this.sessionSuffix = sessionSuffix;
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
