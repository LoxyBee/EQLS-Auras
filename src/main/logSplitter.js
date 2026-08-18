const fs = require('fs');
const path = require('path');
const readline = require('readline');

const MONTHS = {
  Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
  Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
};

// EQ log lines start with e.g. "[Sun Aug 16 12:11:41 2026] ..."
const TIMESTAMP_PATTERN = /^\[\w{3} (\w{3}) (\d{1,2}) (\d{2}):(\d{2}):(\d{2}) (\d{4})\]/;
const FLUSH_LINE_THRESHOLD = 5000;
const POLL_INTERVAL_MS = 1000;

// There's no log line for "/log off" or "/log on" - the game just stops
// writing entirely while logging is off, then resumes. The only trace of
// that is a gap in line timestamps, so that's what "start a new file on
// /log off + /log on" has to detect. This threshold is how long a gap has
// to be before it's treated as a real logging break rather than normal
// in-game quiet time.
const SESSION_GAP_MS = 10 * 60 * 1000;

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

    rl.on('line', (line) => {
      if (line.length === 0) return;
      const parsedDateKey = extractDateKey(line);
      if (parsedDateKey) lastDateKey = parsedDateKey;
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

module.exports = { LogSplitter };
