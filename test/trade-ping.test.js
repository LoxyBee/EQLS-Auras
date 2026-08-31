'use strict';
/**
 * The trade-request line pattern.
 *
 * Detection here is exact-text matching, exactly like the buff engine, so the pattern is the whole
 * feature - if it is loose it fires on chat, and if it is tight it never fires at all. Both fail
 * silently: the only symptom is a sound that comes at the wrong time or not at all.
 *
 * The pattern is extracted from the renderer by reading the source, because main-window.js needs a
 * DOM and cannot be required in a plain Node process. That is a real limitation and worth naming:
 * this tests the regex, not the wiring around it. The wiring is covered structurally in
 * renderer-wiring.test.js, and hearing the sound is on the live checklist.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const js = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'),
  'utf8'
);

const m = js.match(/const TRADE_REQUEST_PATTERN = (\/.+\/);/);
let PATTERN = null;
test('the trade request pattern is defined and extractable', () => {
  assert.ok(m, 'TRADE_REQUEST_PATTERN not found in the renderer');
  // eslint-disable-next-line no-eval
  PATTERN = eval(m[1]);
  assert.ok(PATTERN instanceof RegExp);
});

/** Strips a log timestamp the same way the renderer does before matching. */
const strip = (l) => l.replace(/^\[[^\]]+\]\s*/, '').trim();

test('it matches a real trade request, timestamp and all', () => {
  // Wording taken from the owner's own logs, where it appears 9 times.
  assert.ok(PATTERN.test(strip('[Wed Aug 19 20:15:02 2026] Baxa is interested in making a trade.')));
  assert.ok(PATTERN.test('Vaela is interested in making a trade.'));
});

test('it captures who asked', () => {
  assert.equal('Baxa is interested in making a trade.'.match(PATTERN)[1], 'Baxa');
});

test('it does NOT fire on the other trade lines', () => {
  // All present in the owner's logs. Only the REQUEST should ping - the rest are after the fact
  // and would turn one trade into a burst of sounds.
  for (const line of [
    'You complete the trade with Baxa.',
    'Baxa has cancelled the trade.',
    'You have cancelled the trade.',
    'You are too far away from Baxa to trade.',
  ]) {
    assert.ok(!PATTERN.test(strip(line)), `should not have matched: ${line}`);
  }
});

test('it does NOT fire on someone quoting it in chat', () => {
  // The anchors are what stop this. A player saying the sentence produces a wrapped line, and
  // the leading ^ rejects it.
  for (const line of [
    'Baxa says, \'Baxa is interested in making a trade.\'',
    'Baxa tells you, \'is interested in making a trade.\'',
    'Baxa shouts, \'Vaela is interested in making a trade.\'',
  ]) {
    assert.ok(!PATTERN.test(strip(line)), `should not have matched: ${line}`);
  }
  // Honest limit, recorded rather than claimed away: /emote prints "Name <text>" with no wrapper,
  // so `/em is interested in making a trade.` is indistinguishable from the system line. The
  // anchors are for precision, not for spoof-proofing, and the worst case is one stray ping.
});

test('it does not match a partial or run-on line', () => {
  assert.ok(!PATTERN.test('Baxa is interested in making a trade'), 'missing full stop should not match');
  assert.ok(!PATTERN.test('Baxa is interested in making a trade. And a duel.'), 'trailing text should not match');
});

test('it fires against the owner real logs, and only on request lines', () => {
  // Cross-check against the real thing where available: every line that matches must be a
  // request, and the count must be non-zero on a log known to contain them.
  const { findOwnerLogs } = require('../tools/lib/owner-logs');
  const candidates = findOwnerLogs();
  if (!candidates.length) {
    console.log('       (no real log available here - skipped)');
    return;
  }
  let matched = 0;
  for (const p of candidates) {
    for (const raw of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const line = strip(raw);
      if (!line) continue;
      if (PATTERN.test(line)) {
        matched++;
        assert.match(line, /is interested in making a trade\.$/, `matched a non-request line: ${line}`);
      }
    }
  }
  // Every match that WAS made must be a real request (the assert in the loop). Whether there are
  // any at all depends on what the owner did during the days this machine still has - a soft
  // cross-check, so no requests is a skip, not a failure.
  if (!matched) console.log('       (no trade requests in the available logs - cross-check skipped)');
});

// ---------------------------------------------------------------------------
// The tell-ping cooldown
// ---------------------------------------------------------------------------

// Reported live: a burst of tells machine-gunned the ping sound. tellShouldPing is the pure
// decision function pulled out of initTradePing's closure specifically so it can be tested here
// rather than only structurally.
const fnMatch = js.match(/function tellShouldPing\(now, lastPingAt, cooldownMs\) \{[\s\S]*?\n\}/);
let tellShouldPing = null;
test('tellShouldPing is defined and extractable', () => {
  assert.ok(fnMatch, 'tellShouldPing not found in the renderer');
  // eslint-disable-next-line no-eval
  tellShouldPing = eval(`(${fnMatch[0]})`);
  assert.equal(typeof tellShouldPing, 'function');
});

test('the very first tell of the session always pings', () => {
  // lastTellPingAt starts at 0 in the renderer, and Date.now() is always a real, large epoch
  // timestamp far past 0 - so "never pinged yet" reliably clears any real cooldown.
  assert.equal(tellShouldPing(Date.now(), 0, 3000), true);
});

test('a second tell inside the cooldown window is silenced', () => {
  assert.equal(tellShouldPing(2000, 1000, 3000), false, 'only 1s after the last ping, cooldown is 3s');
});

test('a second tell after the cooldown window has passed pings again', () => {
  assert.equal(tellShouldPing(4001, 1000, 3000), true, 'just over 3s later - should ping');
  assert.equal(tellShouldPing(4000, 1000, 3000), true, 'exactly on the boundary counts as elapsed');
});

test('cooldown 0 means off - every tell pings regardless of how recent the last one was', () => {
  assert.equal(tellShouldPing(1001, 1000, 0), true, '1ms after the previous ping, but cooldown is off');
});

module.exports = () => report('trade-ping');
if (require.main === module) report('trade-ping').then((n) => process.exit(n ? 1 : 0));
