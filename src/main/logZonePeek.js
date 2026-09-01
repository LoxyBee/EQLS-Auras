'use strict';

const fs = require('fs');
const { matchZoneChange, matchOwnVoidlingDanger } = require('./buffParser');

// The most recent "You have entered <X>." in a log file, found by reading UPWARD from the end in
// 64 KB chunks - the same idiom logRotation.js's findWeekStartOffset uses, so a multi-gigabyte log
// costs only its tail. Returns { zone, viaVoidling } (zone with its instance suffix intact,
// exactly as matchZoneChange gives it), or null if no zone line is found within `maxBytes`.
//
// `viaVoidling` is true when the player's own raid-entry keyword - "You say, 'danger'" to the
// Voidling - appears in the ~256 KB immediately before that zone line (the same signal
// lockoutCore keys its weekly-attempt event on). The raid-named board needs it: the zone-name
// grammar does not reliably tell a raid instance from a group one.
//
// Why this exists: logWatcher starts at EOF and never replays history, so a restart mid-session
// leaves every zone consumer - the raid-named board, zone-gated aura visibility, the travel guide's
// current zone - blind until the next zone line. A zone line is unambiguous and the player is
// almost certainly still there, so unlike a buff landing it is safe to read back. This is
// deliberately the ONLY thing read back from history; see the never-replay note in logWatcher.js.

const CHUNK = 1 << 16; // 64 KB, matching findWeekStartOffset
// A zone line appears far sooner than this in any real log - even a long single-zone camp is well
// under it. The cap only bounds a pathological log that somehow never records a zone at all.
const DEFAULT_MAX_BYTES = 64 * 1024 * 1024;
// How far before the zone line to look for the hail/danger dialogue. It happens seconds before the
// zone change and the log is quiet during a zone, so this is generous.
const DANGER_LOOKBACK_BYTES = 256 * 1024;

/** Read [start, end) of an open fd as latin1 text (EQ logs are latin1/ASCII, 1 byte == 1 char). */
function readSpan(fd, start, end) {
  const len = Math.max(0, end - start);
  if (!len) return '';
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, start);
  return buf.toString('latin1');
}

// Did the player say "danger" to the Voidling anywhere in `text`?
function sawVoidlingEntry(text) {
  return text.split('\n').some((raw) => matchOwnVoidlingDanger(raw.replace(/\r$/, '')));
}

function readLastZoneEntry(filePath, maxBytes = DEFAULT_MAX_BYTES) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const floor = Math.max(0, size - maxBytes);
    let pos = size;
    let carry = ''; // partial leading line of the chunk just processed - continues into the earlier one

    while (pos > floor) {
      const readStart = Math.max(floor, pos - CHUNK);
      const segs = (readSpan(fd, readStart, pos) + carry).split('\n');
      // segs[0] still continues into an even earlier chunk unless this chunk starts at the floor.
      const judgeFrom = readStart === floor ? 0 : 1;
      // track each seg's file offset so a hit gives us where to look back for the dialogue
      let off = readStart;
      const offsets = segs.map((s) => { const at = off; off += s.length + 1; return at; });
      for (let k = segs.length - 1; k >= judgeFrom; k--) {
        const line = segs[k].replace(/\r$/, '');
        if (!line) continue;
        const zone = matchZoneChange(line);
        if (!zone) continue;
        const lineAt = offsets[k];
        const viaVoidling = sawVoidlingEntry(
          readSpan(fd, Math.max(0, lineAt - DANGER_LOOKBACK_BYTES), lineAt)
        );
        return { zone, viaVoidling };
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
