'use strict';
/**
 * The raid reset is a US Eastern wall-clock time and has to be right whatever zone the player's
 * computer is on, and across the daylight-saving change. Node on Windows ignores TZ, so these
 * tests do not fake a zone - they check the ABSOLUTE INSTANTS the helper returns, which is what
 * every consumer actually compares against.
 */

const assert = require('node:assert/strict');
const { test, report } = require('./harness');
const {
  easternResetBefore,
  easternResetAfter,
  easternDailyResetBefore,
  easternDailyResetAfter,
  easternOffsetMs,
} = require('../src/shared/easternReset');

const iso = (ms) => new Date(ms).toISOString();

test('Tuesday 11:00 Eastern in summer is 15:00 UTC (EDT, -4)', () => {
  // A Saturday in August 2026.
  const b = easternResetBefore(Date.UTC(2026, 7, 29, 18, 0, 0), 2, 11);
  assert.equal(iso(b), '2026-08-25T15:00:00.000Z');
  assert.equal(easternOffsetMs(b) / 3600000, -4);
});

test('Tuesday 11:00 Eastern in winter is 16:00 UTC (EST, -5)', () => {
  // Mid-December 2026.
  const b = easternResetBefore(Date.UTC(2026, 11, 20, 12, 0, 0), 2, 11);
  assert.equal(iso(b), '2026-12-15T16:00:00.000Z');
  assert.equal(easternOffsetMs(b) / 3600000, -5);
});

test('the boundary shifts by an hour across the November fall-back, staying at 11:00 wall clock', () => {
  // Fall-back is Sunday 1 November 2026. `now` = the Monday after.
  const now = Date.UTC(2026, 10, 2, 12, 0, 0);
  const before = easternResetBefore(now, 2, 11); // Tue 27 Oct, still EDT
  const after = easternResetAfter(now, 2, 11);   // Tue 3 Nov, now EST
  assert.equal(iso(before), '2026-10-27T15:00:00.000Z', 'the week that opened before the change: 11:00 EDT');
  assert.equal(iso(after), '2026-11-03T16:00:00.000Z', 'the next reset: 11:00 EST, an hour later in UTC');
  // Both are 11:00 as the Eastern clock reads.
  assert.equal(easternOffsetMs(before) / 3600000, -4);
  assert.equal(easternOffsetMs(after) / 3600000, -5);
});

test('a Tuesday before 11:00 Eastern still belongs to last week', () => {
  const beforeReset = easternResetBefore(Date.UTC(2026, 8, 1, 14, 0, 0), 2, 11); // 10:00 EDT
  const afterReset = easternResetBefore(Date.UTC(2026, 8, 1, 15, 30, 0), 2, 11); // 11:30 EDT
  assert.equal(iso(beforeReset), '2026-08-25T15:00:00.000Z', 'before the hour = the old period');
  assert.equal(iso(afterReset), '2026-09-01T15:00:00.000Z', 'after the hour = the new period');
});

test('exactly 11:00:00 Eastern belongs to the new week', () => {
  const at = easternResetBefore(Date.UTC(2026, 8, 1, 15, 0, 0), 2, 11); // 11:00:00 EDT exactly
  assert.equal(iso(at), '2026-09-01T15:00:00.000Z');
});

test('the day and hour are honoured, and clamped', () => {
  // Friday 06:00 Eastern.
  const fri = easternResetBefore(Date.UTC(2026, 8, 5, 18, 0, 0), 5, 6);
  assert.equal(new Date(fri).toISOString().slice(0, 10), '2026-09-04');
  assert.equal(easternOffsetMs(fri) / 3600000, -4); // still EDT
  // out-of-range inputs do not throw
  assert.doesNotThrow(() => easternResetBefore(Date.now(), 99, 99));
});

test('easternResetAfter is exactly one Eastern week after the start', () => {
  const now = Date.UTC(2026, 7, 29, 18, 0, 0);
  const start = easternResetBefore(now, 2, 11);
  const end = easternResetAfter(now, 2, 11);
  // No DST change in this window, so it is a clean 7 * 24h.
  assert.equal(end - start, 7 * 86400000);
});

// --- the DAILY variants (Lockouts page "Daily" tab) ---------------------------

test('easternDailyResetBefore: the most recent HH:00 Eastern today, or yesterday if before it', () => {
  // 2026-09-05 is a Saturday, EDT (-4). 11:00 EDT = 15:00 UTC.
  const afterHour = easternDailyResetBefore(Date.UTC(2026, 8, 5, 18, 0, 0), 11); // 14:00 EDT
  assert.equal(iso(afterHour), '2026-09-05T15:00:00.000Z', 'past 11:00 -> today 11:00');
  const beforeHour = easternDailyResetBefore(Date.UTC(2026, 8, 5, 13, 0, 0), 11); // 09:00 EDT
  assert.equal(iso(beforeHour), '2026-09-04T15:00:00.000Z', 'before 11:00 -> yesterday 11:00');
});

test('easternDailyResetAfter is one Eastern day later', () => {
  const now = Date.UTC(2026, 8, 5, 18, 0, 0);
  const start = easternDailyResetBefore(now, 11);
  const end = easternDailyResetAfter(now, 11);
  assert.equal(end - start, 86400000, 'clean 24h with no DST change in the window');
});

test('the daily reset rides the fall-back like the weekly one, staying at wall-clock 11:00', () => {
  // Fall-back Sunday 1 Nov 2026. Monday the 2nd, afternoon.
  const now = Date.UTC(2026, 10, 2, 18, 0, 0);
  const start = easternDailyResetBefore(now, 11);
  assert.equal(iso(start), '2026-11-02T16:00:00.000Z', '11:00 EST');
  assert.equal(easternOffsetMs(start) / 3600000, -5);
});

test('daily hour is clamped and does not throw on junk', () => {
  assert.doesNotThrow(() => easternDailyResetBefore(Date.now(), 99));
  assert.doesNotThrow(() => easternDailyResetAfter(Date.now(), -3));
});

module.exports = () => report('eastern-reset');
if (require.main === module) report('eastern-reset').then((n) => process.exit(n ? 1 : 0));
