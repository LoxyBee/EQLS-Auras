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
  assert.ok(PATTERN.test(strip('[Wed Aug 19 20:15:02 2026] Avenrae is interested in making a trade.')));
  assert.ok(PATTERN.test('Shara is interested in making a trade.'));
});

test('it captures who asked', () => {
  assert.equal('Avenrae is interested in making a trade.'.match(PATTERN)[1], 'Avenrae');
});

test('it does NOT fire on the other trade lines', () => {
  // All present in the owner's logs. Only the REQUEST should ping - the rest are after the fact
  // and would turn one trade into a burst of sounds.
  for (const line of [
    'You complete the trade with Avenrae.',
    'Avenrae has cancelled the trade.',
    'You have cancelled the trade.',
    'You are too far away from Avenrae to trade.',
  ]) {
    assert.ok(!PATTERN.test(strip(line)), `should not have matched: ${line}`);
  }
});

test('it does NOT fire on someone quoting it in chat', () => {
  // The anchors are what stop this. A player saying the sentence produces a wrapped line, and
  // the leading ^ rejects it.
  for (const line of [
    'Avenrae says, \'Avenrae is interested in making a trade.\'',
    'Avenrae tells you, \'is interested in making a trade.\'',
    'Avenrae shouts, \'Shara is interested in making a trade.\'',
  ]) {
    assert.ok(!PATTERN.test(strip(line)), `should not have matched: ${line}`);
  }
  // Honest limit, recorded rather than claimed away: /emote prints "Name <text>" with no wrapper,
  // so `/em is interested in making a trade.` is indistinguishable from the system line. The
  // anchors are for precision, not for spoof-proofing, and the worst case is one stray ping.
});

test('it does not match a partial or run-on line', () => {
  assert.ok(!PATTERN.test('Avenrae is interested in making a trade'), 'missing full stop should not match');
  assert.ok(!PATTERN.test('Avenrae is interested in making a trade. And a duel.'), 'trailing text should not match');
});

test('it fires against the owner real logs, and only on request lines', () => {
  // Cross-check against the real thing where available: every line that matches must be a
  // request, and the count must be non-zero on a log known to contain them.
  const candidates = [
    'C:/Users/Lindsey/Desktop/eqlog_Shara_rivervale_2026-08-19.txt',
    'C:/Users/Lindsey/Desktop/EQL Source/eqlog_Shara_rivervale.txt',
  ].filter((p) => fs.existsSync(p));
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
  assert.ok(matched > 0, 'no trade requests matched in a log known to contain them');
});

module.exports = () => report('trade-ping');
if (require.main === module) process.exit(report('trade-ping') ? 1 : 0);
