'use strict';

// The raid reset is a wall-clock time in ONE zone - US Eastern - and it moves itself across the
// daylight-saving change. A player whose computer is on Pacific, or on London time, still needs the
// same instant. So the reset day/hour the user sets are EASTERN, and this turns them into an
// absolute instant that any other clock can be compared against.
//
// EverQuest log stamps are the client's local wall clock (`[Tue Aug 25 08:00:00 2026]`), which
// logSplitter parses as a local `Date` - an absolute instant. `easternResetBefore` returns an
// absolute instant too, so `stampMs >= boundaryMs` is a correct comparison whatever zone the
// machine is in.
//
// Pure: no clock read of its own, `now` is passed in. Uses `Intl` (present in Node and Electron)
// for the zone maths - the runtime's own IANA database handles the DST rules and their changes.

const EASTERN = 'America/New_York';
const DAY_MS = 86400000;

// Eastern wall-clock minus UTC, in ms, at the instant `ms`. EDT is -4h, EST is -5h.
function easternOffsetMs(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  const asIfUtc = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second);
  return asIfUtc - ms;
}

// The absolute instant whose Eastern wall clock is exactly y-mo-d h:00:00.
// Two passes: guess with the offset at the naive instant, then correct if the guess landed on the
// other side of a DST boundary. (The 02:00-03:00 spring-forward hour does not exist; a reset set
// inside it resolves to the same instant as 03:00, which is the sane answer.)
function easternWallToInstant(y, mo, d, hour) {
  const naive = Date.UTC(y, mo - 1, d, hour, 0, 0);
  let instant = naive - easternOffsetMs(naive);
  const off2 = easternOffsetMs(instant);
  const corrected = naive - off2;
  if (corrected !== instant) instant = corrected;
  return instant;
}

// Eastern calendar parts of an instant, plus its weekday (0 = Sunday).
function easternParts(ms) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EASTERN,
    hourCycle: 'h23',
    weekday: 'short',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(ms));
  const m = {};
  for (const p of parts) m[p.type] = p.value;
  const weekday = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[m.weekday];
  return { year: +m.year, month: +m.month, day: +m.day, weekday };
}

/**
 * The most recent `<weekday> <hour>:00 US Eastern` at or before `now`, as an absolute instant (ms).
 *
 * `now` may be a Date or an epoch ms. `weekday` is 0-6 (Sunday = 0), `hour` is 0-23. Both are
 * Eastern - that is the whole point.
 */
function easternResetBefore(now, weekday, hour) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  const w = Number.isInteger(weekday) ? ((weekday % 7) + 7) % 7 : 2;
  const h = Number.isInteger(hour) ? Math.min(23, Math.max(0, hour)) : 11;

  const p = easternParts(nowMs);
  const back = (p.weekday - w + 7) % 7;
  // The Eastern DATE `back` days ago. Walk the civil date, not the instant, so a DST hour in
  // between cannot shift which day we land on.
  const civ = new Date(Date.UTC(p.year, p.month - 1, p.day) - back * DAY_MS);
  let instant = easternWallToInstant(civ.getUTCFullYear(), civ.getUTCMonth() + 1, civ.getUTCDate(), h);
  if (instant > nowMs) {
    const civPrev = new Date(civ.getTime() - 7 * DAY_MS);
    instant = easternWallToInstant(civPrev.getUTCFullYear(), civPrev.getUTCMonth() + 1, civPrev.getUTCDate(), h);
  }
  return instant;
}

// The next reset after `now` - the current period's end. One Eastern week later, resolved through
// the zone again so a DST change inside the week is handled.
function easternResetAfter(now, weekday, hour) {
  const start = easternResetBefore(now, weekday, hour);
  const p = easternParts(start);
  const civNext = new Date(Date.UTC(p.year, p.month - 1, p.day) + 7 * DAY_MS);
  const h = Number.isInteger(hour) ? Math.min(23, Math.max(0, hour)) : 11;
  return easternWallToInstant(civNext.getUTCFullYear(), civNext.getUTCMonth() + 1, civNext.getUTCDate(), h);
}

module.exports = { easternResetBefore, easternResetAfter, easternParts, easternOffsetMs, EASTERN };
