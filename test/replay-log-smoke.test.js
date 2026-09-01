'use strict';
/**
 * tools/replay-log.js is the regression instrument for every detection change ("measure against
 * real logs before and after"). It needs the owner's own logs so it can't do a real run in the
 * suite - but its PLUMBING can be smoke-tested against a synthetic log, and wasn't. That gap is
 * how it shipped reading whole files with fs.readFileSync (a live un-rotated eqlog_*.txt runs past
 * V8's 512 MB string limit -> "Cannot create a string longer than..." -> the crash the owner hit).
 * It now streams line by line; this pins that it still works and returns the documented shape.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const { replay } = require('../tools/replay-log');

process.env.REPLAY_DRAIN_MS = '30'; // the header anticipates this - keep the drain wait short

const roster = (() => {
  const r = require('../src/shared/data/buffs.json');
  return r.buffs || r;
})();

// A buff whose landing text is unique in the roster and whose name has no rank suffix - the
// cleanest possible "named cast then its landing text" detection.
const pick = roster.find(
  (e) => e.landingText && (e.landingTextSharedBy || 1) <= 1 && !/\s[IVXLC]+$/.test(e.name),
);

function writeLog(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-replay-'));
  const p = path.join(dir, 'eqlog_Tester_rivervale.txt');
  fs.writeFileSync(p, lines.join('\n') + '\n', 'utf8');
  return p;
}

test('replay() streams a log, counts lines, and returns the documented result shape', async () => {
  assert.ok(pick, 'no unambiguous roster entry to build the fixture from');
  const stamp = '[Mon Sep 01 12:00:0';
  const file = writeLog([
    `${stamp}0 2026] Welcome to EverQuest!`,
    `${stamp}1 2026] You begin casting ${pick.name}.`,
    `${stamp}2 2026] ${pick.landingText}`,
    `${stamp}5 2026] a rat hits you for 1 point of damage.`,
    '', // blank line - must be skipped, not counted
  ]);

  const result = await replay([file]);

  assert.equal(result.lineCount, 4, 'the blank line should not be counted');
  for (const k of ['distinctBuffsLanded', 'totalLandings', 'ambiguousPrompts', 'unknownTexts']) {
    assert.ok(k in result.totals, `totals.${k} missing from the result`);
  }
  assert.ok(pick.name in result.landed, `${pick.name} was cast and landed but is not in result.landed`);
  assert.ok(result.landed[pick.name] >= 1);
});

test('replay() handles a multi-megabyte log without reading it whole into a string', async () => {
  // ~4 MB of filler + one real detection at the end. The point is not the size itself but that a
  // streamed read never materialises the whole file - fs.readFileSync here would be fine, but the
  // same code path on a 600 MB live log is what used to throw.
  const stamp = '[Mon Sep 01 13:00:00 2026]';
  const filler = new Array(40000).fill(`${stamp} a rat hits you for 1 point of damage.`);
  const file = writeLog([
    ...filler,
    `${stamp} You begin casting ${pick.name}.`,
    `[Mon Sep 01 13:00:01 2026] ${pick.landingText}`,
  ]);
  assert.ok(fs.statSync(file).size > 2 * 1024 * 1024, 'fixture is not actually large');

  const result = await replay([file]);
  assert.equal(result.lineCount, 40002);
  assert.ok(pick.name in result.landed);
});

module.exports = () => report('replay-log-smoke');
if (require.main === module) report('replay-log-smoke').then((n) => process.exit(n ? 1 : 0));
