'use strict';

const fs = require('fs');
const {
  matchGroupMemberJoined,
  matchGroupMemberLeft,
  matchGroupJoinAccepted,
  isPartyChangeLine,
  stripTimestamp,
} = require('./buffParser');

// Rebuild "who is in the player's group" by reading UPWARD from the end of the live log - the same
// 64 KB-chunk idiom logZonePeek / logRotation.findWeekStartOffset use, so a multi-gigabyte log
// costs only its tail. Returns { members, admitted } (both lowercased, matching groupRoster's own
// storage) or null if nothing group-related is found.
//
// Why this exists: logWatcher starts at EOF and never replays history, so a restart mid-session
// leaves groupRoster empty until the next join line - and the damage meter's "group" scope then
// silently falls back to the whole fight, or (worse, once the friend/enemy bootstrap has to
// re-learn everyone from scratch) drops groupmates off the current fight entirely. A group's
// membership is stable and recoverable: every "<Name> has joined the group." and every
// "<Name> tells the group, '...'" names a member, and "You have joined/been removed from the
// group." is the hard boundary where a *different* group's roster ends. Same "safe to read back
// because it is unambiguous and still true" reasoning as logZonePeek - see the never-replay note
// in logWatcher.js.

const CHUNK = 1 << 16; // 64 KB
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024; // a group forms far sooner than this; the cap only bounds a pathological log

// "You have joined the group." / "You have been removed from the group." - the player's OWN
// membership changing, which wipes the roster (a new group is a new roster). Kept local rather than
// imported because groupRoster keeps its own copies for the same reason.
const SELF_BOUNDARY = /^You (?:have joined the group|have been removed from the group)\.$/;
// "<Name> tells the group, '...'" / "tells the raid," - a member talking. Not a party-change line,
// so isPartyChangeLine (and groupRoster.handleLine) ignore it; here it is a strong "this name is a
// current member" signal. A single alphabetic word before the phrase, so quoted chat about the
// group ("he tells the group stuff") cannot seed a name.
const GROUP_TELL = /^([A-Za-z]+) tells the (?:group|raid|party), /;

/** Read [start, end) of an open fd as latin1 text (EQ logs are latin1/ASCII, 1 byte == 1 char). */
function readSpan(fd, start, end) {
  const len = Math.max(0, end - start);
  if (!len) return '';
  const buf = Buffer.alloc(len);
  fs.readSync(fd, buf, 0, len, start);
  return buf.toString('latin1');
}

// Is this line one this peek cares about? (party change, join-accepted, or a group tell.)
function isRelevant(stripped) {
  return (
    SELF_BOUNDARY.test(stripped) ||
    GROUP_TELL.test(stripped) ||
    matchGroupJoinAccepted(stripped) != null ||
    isPartyChangeLine(stripped)
  );
}

// Fold the collected lines (chronological order) into { members, admitted }. Mirrors
// groupRoster.handleLine's own logic: a self-boundary wipes both; a join / accept / group-tell adds
// to both; a leave removes from members only (their earlier damage still counts, and a rejoin
// shouldn't have made them vanish in between).
function foldLines(lines) {
  const members = new Set();
  const admitted = new Set();
  const add = (name) => {
    if (!name) return;
    const key = String(name).toLowerCase();
    members.add(key);
    admitted.add(key);
  };
  for (const raw of lines) {
    const stripped = stripTimestamp(raw);
    if (SELF_BOUNDARY.test(stripped)) {
      members.clear();
      admitted.clear();
      continue;
    }
    const accepted = matchGroupJoinAccepted(raw);
    if (accepted) { add(accepted); continue; }
    const tell = GROUP_TELL.exec(stripped);
    if (tell) { add(tell[1]); continue; }
    if (!isPartyChangeLine(raw)) continue;
    const joined = matchGroupMemberJoined(raw);
    if (joined) { add(joined); continue; }
    const left = matchGroupMemberLeft(raw);
    if (left) { members.delete(String(left).toLowerCase()); continue; }
  }
  return { members: [...members], admitted: [...admitted] };
}

function readRecentGroup(filePath, maxBytes = DEFAULT_MAX_BYTES) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const size = fs.fstatSync(fd).size;
    const floor = Math.max(0, size - maxBytes);
    let pos = size;
    let carry = '';
    const collected = []; // relevant lines, newest-first while scanning; reversed at the end
    let hitBoundary = false;

    while (pos > floor && !hitBoundary) {
      const readStart = Math.max(floor, pos - CHUNK);
      const segs = (readSpan(fd, readStart, pos) + carry).split('\n');
      const judgeFrom = readStart === floor ? 0 : 1;
      for (let k = segs.length - 1; k >= judgeFrom; k--) {
        const line = segs[k].replace(/\r$/, '');
        if (!line) continue;
        const stripped = stripTimestamp(line);
        if (!isRelevant(stripped)) continue;
        collected.push(line);
        // The player's own join/remove is the boundary: a roster before it belongs to a different
        // group. Stop here - this line and everything after it is the current roster.
        if (SELF_BOUNDARY.test(stripped)) { hitBoundary = true; break; }
      }
      carry = segs[0];
      pos = readStart;
    }

    if (!collected.length) return null;
    const result = foldLines(collected.reverse());
    if (!result.members.length && !result.admitted.length) return null;
    return result;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

module.exports = { readRecentGroup };
