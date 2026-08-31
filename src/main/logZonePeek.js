'use strict';

const fs = require('fs');
const { matchZoneChange } = require('./buffParser');

// The most recent "You have entered <X>." in a log file, found by reading UPWARD from the end in
// 64 KB chunks - the same idiom logRotation.js's findWeekStartOffset uses, so a multi-gigabyte log
// costs only its tail. Returns the zone name (instance suffix and all, exactly as matchZoneChange
// gives it), or null if none is found within `maxBytes` of the end.
//
// Why this exists: logWatcher never replays history, so a restart mid-session leaves every zone
// consumer - the raid-named board, zone-gated aura visibility, the travel guide's "current zone" -
// blind until the next zone line. A zone line is unambiguous and the player is almost certainly
// still there, so unlike a buff landing it is safe to recover this one fact on startup. This is
// deliberately the ONLY thing read back from history; see the never-replay note in logWatcher.js.

const CHUNK = 1 << 16; // 64 KB, matching findWeekStartOffset
// A zone line appears far sooner than this in any real log - even a long single-zone camp is well
// under it. The cap only bounds a pathological log that somehow never records a zone at all.
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;

function readLastZoneEntry(filePath, maxBytes = DEFAULT_MAX_BYTES) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const floor = Math.max(0, size - maxBytes);
    let pos = size;
    let carry = ''; // partial leading line of the chunk just processed - continues into the earlier one
    const chunk = Buffer.alloc(CHUNK);

    while (pos > floor) {
      const readStart = Math.max(floor, pos - CHUNK);
      const want = pos - readStart;
      fs.readSync(fd, chunk, 0, want, readStart);
      // EQ logs are latin1/ASCII, 1 byte == 1 char. Append the carried partial so a line split
      // across the chunk boundary is whole again.
      const segs = (chunk.slice(0, want).toString('latin1') + carry).split('\n');
      // segs[0] still continues into an even earlier chunk unless this chunk starts at the floor.
      const judgeFrom = readStart === floor ? 0 : 1;
      for (let k = segs.length - 1; k >= judgeFrom; k--) {
        const line = segs[k].replace(/\r$/, '');
        if (!line) continue;
        const zone = matchZoneChange(line);
        if (zone) return zone;
      }
      carry = segs[0];
      pos = readStart;
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { readLastZoneEntry };
