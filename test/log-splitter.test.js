'use strict';
/**
 * The per-day log splitter.
 *
 * It had no suite at all, which is how the bug below survived: EverQuest's stamp comes from C's
 * ctime(), which right-aligns the day in two columns, so the 1st to the 9th of any month are
 * written "Sep  1" and not "Sep 01". The pattern required exactly one space, so those lines read
 * as having no timestamp - and an unstamped line is filed under the day of the line before it.
 *
 * That fall-through is CORRECT and it has to stay: EverQuest wraps long server broadcasts onto
 * continuation lines carrying no stamp of their own, and those do belong with the line above.
 * Measured on the owner's real log, it is also almost never used: 1,761,090 lines, TEN unstamped,
 * every one of them a continuation of "we must bring the servers down for a hotfix".
 *
 * Which is what makes the RATE worth watching, and what the last tests here are about.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const { LogSplitter, extractTimestampMs } = require('../src/main/logSplitter');

const store = () => {
  const saved = {};
  return { loadJson: (k, d) => (k in saved ? saved[k] : d), saveJson: (k, v) => { saved[k] = v; } };
};

function tempLog(body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-split-'));
  const file = path.join(dir, 'eqlog_Avenrae_rivervale.txt');
  fs.writeFileSync(file, body, 'utf8');
  return { dir, file };
}

// _processOnce streams asynchronously, so wait for it to put itself down.
async function settle(splitter) {
  for (let i = 0; i < 400 && splitter.processing; i += 1) {
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.equal(splitter.processing, false, 'the splitter never finished a batch');
}

async function split(body, opts = {}) {
  const { dir, file } = tempLog(body);
  const s = new LogSplitter(store());
  if (opts.onAlarm) s.setOnFormatAlarm(opts.onAlarm);
  s.attachToFile(file);
  await settle(s);
  s.stop();
  const outDir = path.join(dir, 'Split');
  const files = fs.existsSync(outDir) ? fs.readdirSync(outDir).sort() : [];
  const read = (n) => fs.readFileSync(path.join(outDir, n), 'utf8');
  return { s, dir, files, read };
}

// ---------------------------------------------------------------------------
// The stamp EverQuest actually writes
// ---------------------------------------------------------------------------

test('both spellings of a single-digit day are the same instant', () => {
  const padded = extractTimestampMs('[Tue Sep  1 12:00:00 2026] You have slain Lady Vox!');
  const zeroed = extractTimestampMs('[Tue Sep 01 12:00:00 2026] You have slain Lady Vox!');
  assert.notEqual(padded, null, 'the space-padded form reads as an unstamped line');
  assert.equal(padded, zeroed, 'the two spellings of one instant disagree');
});

test('a two-digit day still parses, and rubbish still does not', () => {
  assert.notEqual(extractTimestampMs('[Tue Sep 15 12:00:00 2026] x'), null);
  assert.equal(extractTimestampMs('You have slain Lady Vox!'), null);
  assert.equal(extractTimestampMs('[not a stamp] x'), null);
});

// THE REGRESSION. Before the pattern was widened, every line of the 1st to the 9th was filed into
// the last day of the previous month - nine days in thirty, silently, in a shipped feature.
test('the first of the month is filed under the first of the month', async () => {
  const { files, read } = await split(
    '[Mon Aug 31 23:00:00 2026] You have slain Lady Vox!\n' +
    '[Tue Sep  1 09:00:00 2026] You have slain Lord Nagafen!\n' +
    '[Tue Sep  1 10:00:00 2026] You have slain Master Yael!\n' +
    '[Wed Sep  2 09:00:00 2026] You have slain Cazic Thule!\n'
  );
  assert.deepEqual(files, [
    'eqlog_Avenrae_rivervale_2026-08-31.txt',
    'eqlog_Avenrae_rivervale_2026-09-01.txt',
    'eqlog_Avenrae_rivervale_2026-09-02.txt',
  ], 'SEPTEMBER WAS FILED UNDER AUGUST');
  assert.ok(read('eqlog_Avenrae_rivervale_2026-09-01.txt').includes('Nagafen'));
  assert.ok(read('eqlog_Avenrae_rivervale_2026-09-01.txt').includes('Yael'));
  assert.ok(!read('eqlog_Avenrae_rivervale_2026-08-31.txt').includes('Nagafen'));
});

test('every day of the first nine gets its own file', async () => {
  const lines = [];
  for (let d = 1; d <= 9; d += 1) lines.push(`[Tue Sep  ${d} 09:00:00 2026] Day ${d}`);
  const { files } = await split(lines.join('\n') + '\n');
  assert.equal(files.length, 9, 'the first nine days did not produce nine files');
});

// ---------------------------------------------------------------------------
// The fall-through, which is correct and must stay
// ---------------------------------------------------------------------------

// Ten lines in 1,761,090 of the owner's real log have no stamp, and all ten are continuations of a
// wrapped server broadcast. Filing them under the day of the line above is the right answer, and a
// "refuse to file what you cannot read" fix would silently drop them.
test('a wrapped broadcast stays with the line it belongs to', async () => {
  const { files, read } = await split(
    '[Tue Sep 15 09:00:00 2026] Server message: We must bring the servers down for a hotfix.\n' +
    'We apologize for the disruption in gameplay.\n' +
    'Downtime will be approximately one hour.\n' +
    '[Tue Sep 15 09:00:05 2026] You have slain Lady Vox!\n'
  );
  assert.deepEqual(files, ['eqlog_Avenrae_rivervale_2026-09-15.txt']);
  const out = read(files[0]);
  assert.ok(out.includes('We apologize'), 'the continuation line was dropped');
  assert.ok(out.includes('approximately one hour'), 'the continuation line was dropped');
  assert.equal(out.trim().split('\n').length, 4, 'lines went missing or were duplicated');
});

// ---------------------------------------------------------------------------
// Noticing that it can no longer read the log
// ---------------------------------------------------------------------------

// The bug that prompted all of this was invisible because nothing counted. A parser that stops
// matching the format does not degrade gently - it fails on essentially every line at once.
test('a log it can no longer read raises an alarm, once', async () => {
  const alarms = [];
  const lines = [];
  for (let i = 0; i < 300; i += 1) lines.push(`<some format we have never seen> line ${i}`);
  const { s } = await split(
    '[Tue Sep 15 09:00:00 2026] You have slain Lady Vox!\n' + lines.join('\n') + '\n',
    { onAlarm: (a) => alarms.push(a) }
  );
  assert.equal(alarms.length, 1, 'the alarm did not fire exactly once');
  assert.ok(alarms[0].ratio > 0.9, 'the reported ratio does not describe what happened');
  assert.ok(s.getStatus().formatAlarm, 'the alarm did not stick around to be found later');
  assert.ok(alarms[0].sample.includes('never seen'), 'the alarm does not show what it choked on');
});

// The real baseline is 0.0006%. An alarm that fires on a normal log is worse than none, because
// the next real one gets ignored.
test('a normal log with a wrapped broadcast in it raises nothing', async () => {
  const alarms = [];
  const lines = [];
  for (let i = 0; i < 500; i += 1) lines.push(`[Tue Sep 15 09:${String(i % 60).padStart(2, '0')}:00 2026] line ${i}`);
  // Three unstamped continuation lines, which is already far above the measured rate.
  lines.splice(100, 0, 'We apologize for the disruption in gameplay.');
  lines.splice(200, 0, 'Downtime will be approximately one hour.');
  lines.splice(300, 0, 'Please visit https://everquestlegends.com for more information.');
  const { s } = await split(lines.join('\n') + '\n', { onAlarm: (a) => alarms.push(a) });
  assert.deepEqual(alarms, [], 'it cried wolf on an ordinary log');
  assert.equal(s.getStatus().formatAlarm, null);
  assert.ok(s.getStatus().unstampedRatio < 0.01);
});

// A handful of broadcast lines in a very quiet batch is not evidence of anything.
test('a tiny batch is not enough to accuse the parser', async () => {
  const alarms = [];
  await split(
    'We apologize for the disruption in gameplay.\n' +
    '[Tue Sep 15 09:00:00 2026] You have slain Lady Vox!\n',
    { onAlarm: (a) => alarms.push(a) }
  );
  assert.deepEqual(alarms, [], 'two lines were treated as a format change');
});

test('it reports how much of the log it could actually read', async () => {
  const lines = [];
  for (let i = 0; i < 50; i += 1) lines.push(`[Tue Sep 15 09:00:00 2026] line ${i}`);
  const { s } = await split(lines.join('\n') + '\n');
  const st = s.getStatus();
  assert.equal(st.stampedLines, 50);
  assert.equal(st.unstampedLines, 0);
  assert.equal(st.unstampedRatio, 0);
});

module.exports = () => report('log-splitter');
if (require.main === module) report('log-splitter').then((n) => process.exit(n ? 1 : 0));
