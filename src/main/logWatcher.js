const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');

const POLL_INTERVAL_MS = 200;
const DIRECTORY_SCAN_INTERVAL_MS = 3000;
const LOG_FILE_PATTERN = /^eqlog_.*\.txt$/i;

// Watches a character's Logs folder, always tails whichever eqlog_*.txt was
// modified most recently (so it follows you across character switches), and
// emits complete new lines as they're written. Never replays old history -
// each file is picked up starting from its current end.
class LogWatcher extends EventEmitter {
  constructor() {
    super();
    this.logsFolder = null;
    this.currentFilePath = null;
    this.offset = 0;
    this.lineBuffer = '';
    this.pollTimer = null;
    this.scanTimer = null;
    this.reading = false;
  }

  // logsFolder must be the actual Logs folder to watch (already resolved -
  // see eqLocator.resolveLogsFolder).
  start(logsFolder) {
    this.stop();
    this.logsFolder = logsFolder;

    this._scanForNewestFile();
    this.scanTimer = setInterval(() => this._scanForNewestFile(), DIRECTORY_SCAN_INTERVAL_MS);
    this.pollTimer = setInterval(() => this._pollActiveFile(), POLL_INTERVAL_MS);
  }

  stop() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.scanTimer) clearInterval(this.scanTimer);
    this.pollTimer = null;
    this.scanTimer = null;
    this.currentFilePath = null;
    this.offset = 0;
    this.lineBuffer = '';
  }

  getStatus() {
    return {
      logsFolder: this.logsFolder,
      currentFile: this.currentFilePath ? path.basename(this.currentFilePath) : null,
      currentFilePath: this.currentFilePath,
      watching: !!this.pollTimer,
    };
  }

  _findNewestLogFile() {
    let entries;
    try {
      entries = fs.readdirSync(this.logsFolder);
    } catch {
      this.emit('error', `Can't read Logs folder: ${this.logsFolder}`);
      return null;
    }

    let newestPath = null;
    let newestMtime = 0;
    for (const name of entries) {
      if (!LOG_FILE_PATTERN.test(name)) continue;
      const fullPath = path.join(this.logsFolder, name);
      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch {
        continue;
      }
      if (stat.mtimeMs > newestMtime) {
        newestMtime = stat.mtimeMs;
        newestPath = fullPath;
      }
    }
    return newestPath;
  }

  _scanForNewestFile() {
    const newest = this._findNewestLogFile();
    if (!newest) return;
    if (newest !== this.currentFilePath) {
      this._switchToFile(newest);
    }
  }

  _switchToFile(filePath) {
    this.currentFilePath = filePath;
    this.lineBuffer = '';
    try {
      this.offset = fs.statSync(filePath).size; // start at end, don't replay history
    } catch {
      this.offset = 0;
    }
    this.emit('status', this.getStatus());
  }

  _pollActiveFile() {
    if (!this.currentFilePath || this.reading) return;

    let stat;
    try {
      stat = fs.statSync(this.currentFilePath);
    } catch {
      // File may have been deleted/rotated away; rescan immediately.
      this.currentFilePath = null;
      this._scanForNewestFile();
      return;
    }

    if (stat.size < this.offset) {
      // File got truncated/replaced (e.g. log cleared) - restart from its new end.
      this.offset = 0;
    }

    if (stat.size === this.offset) return;

    this.reading = true;
    const stream = fs.createReadStream(this.currentFilePath, {
      start: this.offset,
      end: stat.size - 1,
      encoding: 'utf8',
    });

    let chunk = '';
    stream.on('data', (data) => {
      chunk += data;
    });
    stream.on('end', () => {
      this.offset = stat.size;
      this.reading = false;
      this._processChunk(chunk);
    });
    stream.on('error', (err) => {
      this.reading = false;
      this.emit('error', `Error reading log file: ${err.message}`);
    });
  }

  _processChunk(chunk) {
    const combined = this.lineBuffer + chunk;
    const lines = combined.split(/\r\n|\n/);
    // Last element is '' if the chunk ended cleanly on a newline, or a
    // partial line that hasn't been fully written yet - hold it for next poll.
    this.lineBuffer = lines.pop();
    for (const line of lines) {
      if (line.length > 0) {
        this.emit('line', line);
      }
    }
  }
}

module.exports = { LogWatcher };
