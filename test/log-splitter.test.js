'use strict';
/**
 * The per-day log splitter.
 *
 * It had no suite at all. That is the finding worth keeping from all of this: a shipped module
 * with no tests, whose behaviour when it cannot read a line is to file that line under whatever day
 * it last recognised - quietly, and with nothing counting.
 *
 * That fall-through is CORRECT and it has to stay: EverQuest wraps long server broadcasts onto
 * continuation lines carrying no stamp of their own, and those do belong with the line above.
 * Measured on the owner's real log, it is also almost never used: 1,761,090 lines, TEN unstamped,
 * every one of them a continuation of "we must bring the servers down for a hotfix". Which is what
 * makes the RATE worth watching, and what the last tests here are about.
 *
 * ON THE DAY FORMAT, since these tests exercise it. EverQuest Legends writes "Aug 04" - zero-padded,
 * one space. Measured over every EQ log on this machine, deduplicated by content hash: 34 distinct
 * files, 9,026,690 stamped lines, 1,381,716 of them on days 1 to 9, and the original pattern read
 * every single one correctly. C's ctime() right-aligns instead ("Aug  4"); the two look almost
 * identical, and that resemblance produced a confident claim here that the first nine days of every
 * month were being misfiled. THEY WERE NOT.
 *
 * The pattern now accepts both because the tolerance is free, and the tests below say which of the
 * two they are exercising.
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
  const file = path.join(dir, 'eqlog_Baxa_rivervale.txt');
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
  if (opts.dayStartHour != null) s.setDayStartHour(opts.dayStartHour);
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

// THE FORMAT THIS CLIENT ACTUALLY WRITES. Byte-for-byte from a real log:
// "[Tue Aug 04 13:33:15 2026] Logging to 'eqlog.txt' is now *ON*." - the client's own line.
test('the zero-padded day EverQuest actually writes parses', () => {
  const ms = extractTimestampMs("[Tue Aug 04 13:33:15 2026] Logging to 'eqlog.txt' is now *ON*.");
  assert.notEqual(ms, null, 'the real format read as an unstamped line');
  assert.equal(new Date(ms).getDate(), 4);
  assert.equal(new Date(ms).getMonth(), 7);
});

// TOLERANCE, for a format this client does not emit. Kept because it is free, and because if the
// parser accepts the form it should be held to reading it correctly - not because it was ever seen.
test('the ctime-style space-padded day is also accepted', () => {
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

// The month boundary, in the format the client really writes. This is the behaviour that matters
// and it was never broken - but nothing tested it, which is how a claim that it WAS broken survived
// long enough to reach two documents and two commit messages.
test('the first of the month is filed under the first of the month', async () => {
  const { files, read } = await split(
    '[Mon Aug 31 23:00:00 2026] You have slain Lady Vox!\n' +
    '[Tue Sep 01 09:00:00 2026] You have slain Lord Nagafen!\n' +
    '[Tue Sep 01 10:00:00 2026] You have slain Master Yael!\n' +
    '[Wed Sep 02 09:00:00 2026] You have slain Cazic Thule!\n'
  );
  assert.deepEqual(files, [
    'eqlog_Baxa_rivervale_2026-08-31.txt',
    'eqlog_Baxa_rivervale_2026-09-01.txt',
    'eqlog_Baxa_rivervale_2026-09-02.txt',
  ], 'SEPTEMBER WAS FILED UNDER AUGUST');
  assert.ok(read('eqlog_Baxa_rivervale_2026-09-01.txt').includes('Nagafen'));
  assert.ok(read('eqlog_Baxa_rivervale_2026-09-01.txt').includes('Yael'));
  assert.ok(!read('eqlog_Baxa_rivervale_2026-08-31.txt').includes('Nagafen'));
});

test('every day of the first nine gets its own file', async () => {
  const lines = [];
  for (let d = 1; d <= 9; d += 1) lines.push(`[Tue Sep 0${d} 09:00:00 2026] Day ${d}`);
  const { files } = await split(lines.join('\n') + '\n');
  assert.equal(files.length, 9, 'the first nine days did not produce nine files');
});

// The same run in the ctime form, so the tolerance is exercised end to end rather than only at the
// parser. If EverQuest never writes this, nothing is lost; if some client does, this is the case.
test('a space-padded log would also file each day separately', async () => {
  const lines = [];
  for (let d = 1; d <= 9; d += 1) lines.push(`[Tue Sep  ${d} 09:00:00 2026] Day ${d}`);
  const { files } = await split(lines.join('\n') + '\n');
  assert.equal(files.length, 9, 'the space-padded days did not produce nine files');
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
  assert.deepEqual(files, ['eqlog_Baxa_rivervale_2026-09-15.txt']);
  const out = read(files[0]);
  assert.ok(out.includes('We apologize'), 'the continuation line was dropped');
  assert.ok(out.includes('approximately one hour'), 'the continuation line was dropped');
  assert.equal(out.trim().split('\n').length, 4, 'lines went missing or were duplicated');
});

// THE ALARM HAS TO WORK DURING PLAY, which the first version of it did not.
//
// A batch is one poll, one second. Measured on the owner's real log: a second holds a median of 6
// lines, 60 at the 99th percentile, and 182 at its outright peak across 177,399 seconds of play.
// The threshold needs 200 lines to judge a ratio - so requiring them within a single batch meant
// the alarm could only ever fire on a startup backfill. A format that broke mid-session was 100%
// unreadable and said nothing at all, which is the one case it exists for.
//
// The window therefore accumulates across batches. This feeds lines in at her real rate.
test('a format that breaks during play is noticed, not only one broken at startup', async () => {
  const { dir, file } = tempLog('[Tue Sep 15 09:00:00 2026] the log still reads normally\n');
  const s = new LogSplitter(store());
  const alarms = [];
  s.setOnFormatAlarm((a) => alarms.push(a));
  s.attachToFile(file);
  await settle(s);
  s.stop();

  // Now the format changes under it. Six lines a second - her median - in one-second batches,
  // none of which is anywhere near two hundred lines on its own.
  for (let second = 0; second < 60; second += 1) {
    let chunk = '';
    for (let i = 0; i < 6; i += 1) chunk += `<a format nobody has seen> ${second}.${i}\n`;
    fs.appendFileSync(file, chunk);
    s._processOnce();
    await settle(s);
    if (alarms.length) break;
  }
  s.stop();

  assert.equal(alarms.length, 1, 'A MID-SESSION FORMAT BREAK WENT UNANNOUNCED');
  assert.ok(alarms[0].total >= 200, 'it judged the ratio on too few lines');
  assert.ok(alarms[0].ratio > 0.9, 'the reported ratio does not describe what happened');
  fs.rmSync(dir, { recursive: true, force: true });
});

// The message is only worth having if it names the day those lines actually went to. It used to
// read this.lastDateKeySeen, which is assigned two statements later, so it reported the previous
// batch's day - or the word "null" on the first one.
test('the alarm names the day the unreadable lines were filed under', async () => {
  const lines = ['[Tue Sep 15 09:00:00 2026] a real line, so there is a day to fall back to'];
  for (let i = 0; i < 300; i += 1) lines.push(`<unreadable> ${i}`);
  const alarms = [];
  const { s } = await split(lines.join('\n') + '\n', { onAlarm: (a) => alarms.push(a) });
  assert.equal(alarms.length, 1);
  assert.equal(
    alarms[0].lastDateKeySeen,
    '2026-09-15',
    'the alarm cannot say which day the lines went into'
  );
  assert.equal(s.getStatus().formatAlarm.lastDateKeySeen, '2026-09-15');
});

// A counter nobody reads is not an improvement on not counting. The first version reached only a
// console.warn, which the owner has no way to open. It has to travel on the payload that already
// reaches the Setup page.
test('the alarm travels on the settings payload the UI already reads', async () => {
  const lines = [];
  for (let i = 0; i < 300; i += 1) lines.push(`<unreadable> ${i}`);
  const { s } = await split(
    '[Tue Sep 15 09:00:00 2026] one good line\n' + lines.join('\n') + '\n'
  );
  assert.ok(s.getSettings().formatAlarm, 'getSettings does not carry the alarm to the renderer');

  const renderer = fs.readFileSync(
    path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'),
    'utf8'
  );
  assert.ok(/formatAlarm/.test(renderer), 'nothing in the renderer reads the alarm');

  const main = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'main.js'), 'utf8');
  const start = main.indexOf('setOnFormatAlarm');
  assert.ok(start > -1, 'nothing in the host handles the alarm');
  const handler = main.slice(start, start + 900);
  assert.ok(/debugLog\(/.test(handler), 'the alarm never reaches the log file the owner can find');
});

// It must not fire twice for one broken format, and the window must not carry a stale sample
// forward once it has been judged and found fine.
test('a quiet window resets rather than accumulating forever', async () => {
  const { dir, file } = tempLog('[Tue Sep 15 09:00:00 2026] first\n');
  const s = new LogSplitter(store());
  const alarms = [];
  s.setOnFormatAlarm((a) => alarms.push(a));
  s.attachToFile(file);
  await settle(s);

  // Three unstamped lines spread across five hundred good ones, in small batches.
  for (let batch = 0; batch < 5; batch += 1) {
    let chunk = '';
    for (let i = 0; i < 100; i += 1) chunk += `[Tue Sep 15 10:00:00 2026] good ${batch}.${i}\n`;
    if (batch < 3) chunk += 'We apologize for the disruption in gameplay.\n';
    fs.appendFileSync(file, chunk);
    s._processOnce();
    await settle(s);
  }
  s.stop();
  assert.deepEqual(alarms, [], 'a normal log with a few broadcasts tripped the alarm');
  assert.equal(s.getStatus().formatAlarm, null);
  fs.rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Telling the rotation when it is safe to empty the log
// ---------------------------------------------------------------------------

// The weekly rotation empties the live log. Truncation resets this splitter to the start of a
// now-empty file, so whatever it had not yet read never reaches Split/ - safe in the archive, but
// a hole in the per-day folder. Measured with both real modules: a rotation fired against a
// 400,000-line backlog left every one of those lines out of Split/.
test('it reports how much of the log it has still to read', async () => {
  const lines = [];
  for (let i = 0; i < 300; i += 1) lines.push(`[Tue Sep 15 09:00:00 2026] line ${i}`);
  const body = lines.join('\n') + '\n';
  const { dir, file } = tempLog(body);
  const s = new LogSplitter(store());

  // Nothing attached yet: nothing to protect, so nothing to report.
  assert.equal(s.bytesBehind(), 0, 'an unattached splitter claimed a backlog');

  s.attachToFile(file);
  await settle(s);
  assert.equal(s.bytesBehind(), 0, 'it claims a backlog after reading everything');

  // The game writes more. Now it is behind by exactly that much.
  const more = '[Tue Sep 15 09:30:00 2026] You have slain Lady Vox!\n';
  fs.appendFileSync(file, more);
  assert.equal(s.bytesBehind(), more.length, 'the backlog is not the size of what is unread');

  s.stop();
  fs.rmSync(dir, { recursive: true, force: true });
});

// Splitting off means there is no per-day folder to put a hole in, so the rotation must not be
// held up by a splitter that is not doing anything.
test('a splitter that is turned off never holds up the rotation', async () => {
  const { dir, file } = tempLog('[Tue Sep 15 09:00:00 2026] x\n'.repeat(50));
  const s = new LogSplitter(store());
  s.attachToFile(file);
  await settle(s);
  fs.appendFileSync(file, '[Tue Sep 15 10:00:00 2026] plenty more to read\n'.repeat(200));
  assert.ok(s.bytesBehind() > 0, 'the fixture did not create a backlog');
  s.setEnabled(false);
  assert.equal(s.bytesBehind(), 0, 'a disabled splitter still claims a backlog');
  s.stop();
  fs.rmSync(dir, { recursive: true, force: true });
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

// ---------------------------------------------------------------------------
// Re-splitting from byte 0 must not double the day files
// ---------------------------------------------------------------------------
//
// splitProgress.json is the only thing standing between "restart the app" and
// "read the whole log again". If it is lost, reset, or a crash left it
// half-written, the splitter resumes from offset 0 - and every line this week
// is already in Logs/Split/. Appending it again doubles it.

test('a re-split from offset 0 does not re-append lines already in the day file', async () => {
  const body =
    '[Tue Sep 15 09:00:00 2026] You have slain Lady Vox!\n' +
    '[Tue Sep 15 09:00:05 2026] You have slain Lord Nagafen!\n' +
    '[Tue Sep 15 09:00:10 2026] a server broadcast\n';
  const { dir, file } = tempLog(body);

  const first = new LogSplitter(store());
  first.attachToFile(file);
  await settle(first);
  first.stop();

  const outDir = path.join(dir, 'Split');
  const dayFile = fs.readdirSync(outDir)[0];
  const afterFirst = fs.readFileSync(path.join(outDir, dayFile), 'utf8');
  assert.equal(afterFirst.match(/Lady Vox/g).length, 1);

  // Fresh splitter, empty progress -> starts at offset 0, same log, same day file.
  const second = new LogSplitter(store());
  second.attachToFile(file);
  await settle(second);
  second.stop();

  const afterSecond = fs.readFileSync(path.join(outDir, dayFile), 'utf8');
  assert.equal(afterSecond, afterFirst, 'the second pass changed the day file');
  assert.equal(afterSecond.match(/Lady Vox/g).length, 1);
  assert.equal(afterSecond.match(/Lord Nagafen/g).length, 1);
});

test('a re-split still appends genuinely new lines past the day file tail', async () => {
  const body =
    '[Tue Sep 15 09:00:00 2026] You have slain Lady Vox!\n' +
    '[Tue Sep 15 09:00:05 2026] You have slain Lord Nagafen!\n';
  const { dir, file } = tempLog(body);

  const first = new LogSplitter(store());
  first.attachToFile(file);
  await settle(first);
  first.stop();

  fs.appendFileSync(file, '[Tue Sep 15 09:30:00 2026] You have slain Cazic-Thule!\n', 'utf8');

  const second = new LogSplitter(store());
  second.attachToFile(file);
  await settle(second);
  second.stop();

  const outDir = path.join(dir, 'Split');
  const dayFile = fs.readdirSync(outDir)[0];
  const out = fs.readFileSync(path.join(outDir, dayFile), 'utf8');
  assert.equal(out.match(/Lady Vox/g).length, 1);
  assert.equal(out.match(/Cazic-Thule/g).length, 1);
});

// ---------------------------------------------------------------------------
// QOL #23 - user-set hour for the per-day file rollover
// ---------------------------------------------------------------------------

test('with the default (midnight) the boundary is unchanged - byte-identical filing', async () => {
  const { files } = await split(
    '[Sun Aug 30 23:30:00 2026] You have slain Lord Nagafen!\n' +
    '[Mon Aug 31 00:30:00 2026] You have slain Lady Vox!\n'
  );
  assert.deepEqual(files, [
    'eqlog_Baxa_rivervale_2026-08-30.txt',
    'eqlog_Baxa_rivervale_2026-08-31.txt',
  ]);
});

test('a 6 AM rollover keeps a past-midnight raid in one file, dated for the night it started', async () => {
  const { files, read } = await split(
    '[Sun Aug 30 20:00:00 2026] You have slain Lord Nagafen!\n' +
    '[Sun Aug 30 23:59:00 2026] You have slain Master Yael!\n' +
    '[Mon Aug 31 01:30:00 2026] You have slain Lady Vox!\n' +      // still "Sunday night"
    '[Mon Aug 31 05:59:00 2026] You have slain Cazic-Thule!\n' +   // still "Sunday night"
    '[Mon Aug 31 08:00:00 2026] You have slain Phinigel Autropos!\n', // now Monday
    { dayStartHour: 6 }
  );
  assert.deepEqual(files, [
    'eqlog_Baxa_rivervale_2026-08-30.txt',
    'eqlog_Baxa_rivervale_2026-08-31.txt',
  ]);
  const night = read('eqlog_Baxa_rivervale_2026-08-30.txt');
  assert.ok(night.includes('Nagafen') && night.includes('Yael') && night.includes('Vox') && night.includes('Cazic-Thule'));
  assert.ok(!night.includes('Phinigel'), 'the 8 AM kill belongs to the next day');
  assert.ok(read('eqlog_Baxa_rivervale_2026-08-31.txt').includes('Phinigel'));
});

test('the hour setting is clamped to 0..23 and persisted', () => {
  const saved = {};
  const st = { loadJson: (k, d) => (k in saved ? saved[k] : d), saveJson: (k, v) => { saved[k] = v; } };
  const s = new LogSplitter(st);
  assert.equal(s.setDayStartHour(6), 6);
  assert.equal(saved.splitSettings.splitDayStartHour, 6);
  assert.equal(s.setDayStartHour(99), 0, 'out of range falls back to midnight');
  assert.equal(s.setDayStartHour('nonsense'), 0);
  // reloads from settings
  saved.splitSettings.splitDayStartHour = 4;
  assert.equal(new LogSplitter(st).dayStartHour, 4);
});

module.exports = () => report('log-splitter');
if (require.main === module) report('log-splitter').then((n) => process.exit(n ? 1 : 0));
