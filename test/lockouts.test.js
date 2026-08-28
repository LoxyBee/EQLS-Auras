'use strict';
/**
 * Raid lockouts — the integration, not the parser.
 *
 * Session D's `lockoutCore.js` is vendored verbatim and has its own 93 tests in its own repo. This
 * suite covers the parts that are OURS: routing lines to the right character, reading the folder
 * rather than the newest file, never throwing into a shared line bus, and — most of all — that the
 * uncertainty survives all the way to the screen.
 *
 * THE PROPERTY THIS FILE EXISTS FOR: `not_looked` must never reach a user as `open`. "I have no log
 * covering that week" and "you have not killed it" are different facts, and the whole reason this
 * feature is worth shipping rather than copying the kill-inference tools that already exist is that
 * it refuses to collapse the first into the second.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const core = require('../src/main/lockoutCore');
const { LockoutService, civilNow } = require('../src/main/lockoutService');

const T = (s) => `[Mon Aug 10 17:14:49 2026] ${s}`;
const ASSIGN = (boss) => T(`You have been assigned the task 'Potential of the Void - ${boss} - Weekly'.`);

function tempLogs(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-lockouts-'));
  for (const [name, lines] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), lines.join('\r\n'), 'utf8');
  }
  return dir;
}

// ---------------------------------------------------------------------------
// The vendored core is not edited
// ---------------------------------------------------------------------------

// It is theirs. If someone "fixes" it here, the next version from upstream silently reverts the
// fix and nobody finds out. Changes belong in their repo.
test('the vendored core stays pure — no requires, no clock, no filesystem', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'lockoutCore.js'), 'utf8');
  assert.equal(src.match(/^\s*(const|let|var).*=\s*require\(/gm), null, 'the core must require nothing');
  // Argument-LESS new Date() is a clock read. `new Date(value)` is calendar arithmetic on a number
  // we supplied, which is deterministic and fine - the module uses it that way in three places.
  const codeOnly = src.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  assert.equal(codeOnly.match(/new Date\(\s*\)/g), null, 'the core must not read the wall clock');
  assert.equal(codeOnly.match(/Date\.now\(/g), null, 'the core must not read the wall clock');
  assert.equal(codeOnly.match(/require\(['"]fs['"]\)/g), null, 'the core must not touch the filesystem');
});

// ---------------------------------------------------------------------------
// Routing, which is ours
// ---------------------------------------------------------------------------

// Sharing one state between characters is what produced a four-second reset bracket when Session D
// first ran the corpus: two people's grants, four seconds apart because they were grouped, read as
// one task granted twice.
test('two characters never share state', async () => {
  const dir = tempLogs({
    'eqlog_Avenrae_rivervale.txt': [ASSIGN('Lord Nagafen')],
    'eqlog_Shara_rivervale.txt': [ASSIGN('Lady Vox')],
  });
  const s = new LockoutService();
  s.setLogsFolderFn(() => dir);
  await s.backfill();
  assert.deepEqual([...s.states.keys()].sort(), ['Avenrae', 'Shara']);
  const p = s.getProjection(civilNow(new Date(2026, 7, 12, 12, 0, 0)));
  const av = p.characters.find((c) => c.character === 'Avenrae');
  const sh = p.characters.find((c) => c.character === 'Shara');
  assert.ok(av.projection.bosses.some((b) => b.boss === 'Lord Nagafen'));
  assert.ok(!av.projection.bosses.some((b) => b.boss === 'Lady Vox'), "Avenrae must not carry Shara's task");
  assert.ok(sh.projection.bosses.some((b) => b.boss === 'Lady Vox'));
});

// The 'line' event carries only the string, so a live line is attributed from the file the tailer
// is on. With no file, the only honest thing is to drop it - guessing the character is the same
// class of error as sharing state.
test('a live line with no known file is dropped, not guessed at', () => {
  const s = new LockoutService();
  s.setCurrentFileFn(() => null);
  s.handleLine(ASSIGN('Lord Nagafen'));
  assert.equal(s.states.size, 0);
  assert.equal(s.errors, 0, 'dropping is not an error');
});

test('a live line is routed by the file the tailer is currently on', () => {
  const s = new LockoutService();
  s.setCurrentFileFn(() => 'C:/eq/Logs/eqlog_Avenrae_rivervale.txt');
  s.handleLine(ASSIGN('Lord Nagafen'));
  assert.deepEqual([...s.states.keys()], ['Avenrae']);
});

// ---------------------------------------------------------------------------
// It must not take the app down with it
// ---------------------------------------------------------------------------

// Six listeners share the 'line' bus - buffs, custom timers, damage, zone, share codes, travel.
// A throw here reaches all of them. The app is published and people have installed it; a lockout
// grid that stops updating is a disappointment, a buff overlay that stops updating is not
// acceptable.
test('handleLine never throws, whatever it is given', () => {
  const s = new LockoutService();
  s.setCurrentFileFn(() => 'eqlog_Avenrae_rivervale.txt');
  for (const bad of [null, undefined, 42, '', '\u0000', 'x'.repeat(200000), {}, []]) {
    assert.doesNotThrow(() => s.handleLine(bad), `threw on ${typeof bad}`);
  }
});

test('a broken injected function is counted, not thrown', () => {
  const s = new LockoutService();
  s.setCurrentFileFn(() => { throw new Error('watcher exploded'); });
  assert.doesNotThrow(() => s.handleLine(ASSIGN('Lord Nagafen')));
  assert.equal(s.errors, 1);
  assert.match(s.lastError, /watcher exploded/);
});

test('a missing logs folder fails cleanly and says so', async () => {
  const s = new LockoutService();
  s.setLogsFolderFn(() => null);
  const r = await s.backfill();
  assert.equal(r.ok, false);
  assert.match(r.reason, /no logs folder/);
});

// ---------------------------------------------------------------------------
// The folder, not the newest file
// ---------------------------------------------------------------------------

// Measured by Session D: the two halves of the only reset measurement they have live in DIFFERENT
// files. And it lands twice over here, because logSplitter.js writes per-day files by design - the
// split is manufactured continuously rather than merely risked.
test('the whole folder is read, not just the newest file', async () => {
  const dir = tempLogs({
    'eqlog_Avenrae_rivervale.txt': [ASSIGN('Lord Nagafen')],
    'eqlog_Avenrae_rivervale_2026-08-15.txt': [ASSIGN('Lady Vox')],
    'eqlog_Avenrae_rivervale_2026-08-16.txt': [ASSIGN('Master Yael')],
  });
  const s = new LockoutService();
  s.setLogsFolderFn(() => dir);
  const r = await s.backfill();
  assert.equal(r.files, 3, 'all three files must be read');
  const bosses = s.getProjection(civilNow(new Date(2026, 7, 20, 12, 0, 0)))
    .characters[0].projection.bosses.map((b) => b.boss).sort();
  assert.deepEqual(bosses, ['Lady Vox', 'Lord Nagafen', 'Master Yael']);
});

test('files that are not logs are ignored', async () => {
  const dir = tempLogs({
    'eqlog_Avenrae_rivervale.txt': [ASSIGN('Lord Nagafen')],
    'dbg.txt': ['not a log'],
    'Sky.txt': ['also not a log'],
  });
  const s = new LockoutService();
  s.setLogsFolderFn(() => dir);
  const r = await s.backfill();
  assert.equal(r.files, 1);
});

// A backfill ALWAYS overlaps the live tailer, so this is load-bearing rather than a nicety.
//
// The claim being tested is D's exact one, not a stricter one I assumed: replaying the whole
// stream changes EXACTLY ONE key, `dropped.duplicate`, the counter recording how many repeats were
// rejected. That counter is supposed to move. My first version of this test asserted nothing moved
// at all and failed on precisely that counter, which is the test being wrong rather than the code.
test('scanning twice changes only the duplicate counter', async () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': [ASSIGN('Lord Nagafen')] });
  const s = new LockoutService();
  s.setLogsFolderFn(() => dir);
  const at = civilNow(new Date(2026, 7, 20, 12, 0, 0));

  await s.backfill();
  const once = s.getProjection(at).characters[0];
  const firstDupes = once.projection.dropped.duplicate;

  await s.backfill();
  const twice = s.getProjection(at).characters[0];

  assert.ok(twice.projection.dropped.duplicate > firstDupes, 'repeats must be counted, not applied');

  // Everything else, byte for byte. Blanking the one key that is allowed to move is what makes
  // this an assertion about the rest of the state rather than about that counter.
  const blank = (x) => {
    const c = JSON.parse(JSON.stringify(x));
    c.projection.dropped.duplicate = 0;
    return JSON.stringify(c);
  };
  assert.equal(blank(once), blank(twice), 'a second scan changed something other than the counter');
});

// Mixed line endings, measured: 11 CRLF files and 4 LF-only. Session D generalised from an
// all-CRLF sample and was wrong, so both are tested rather than assumed.
test('CRLF and LF files both parse', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-eol-'));
  fs.writeFileSync(path.join(dir, 'eqlog_Crlf_rivervale.txt'), ASSIGN('Lord Nagafen') + '\r\n', 'utf8');
  fs.writeFileSync(path.join(dir, 'eqlog_Lfonly_rivervale.txt'), ASSIGN('Lady Vox') + '\n', 'utf8');
  const s = new LockoutService();
  s.setLogsFolderFn(() => dir);
  await s.backfill();
  const p = s.getProjection(civilNow(new Date(2026, 7, 20, 12, 0, 0)));
  for (const ch of ['Crlf', 'Lfonly']) {
    const e = p.characters.find((c) => c.character === ch);
    assert.ok(e && e.projection.bosses.length === 1, `${ch} produced no task`);
  }
});

/**
 * THE ONE THAT WOULD HAVE SHIPPED SILENTLY.
 *
 * `state.events` is capped at 5,000 and trimmed push-then-shift, so once it is full its length
 * NEVER CHANGES AGAIN - and a backfill of the owner's own corpus fills it. Change detection written
 * as `events.length !== before` therefore goes permanently dead at exactly the moment the app
 * finishes loading, and the live grid would never update again for the rest of the session.
 *
 * That is what this service did until an adversarial audit caught it. Session D's optional
 * `lockoutEngine.js` adapter has the same shape at its lines 55-61.
 */
test('change detection still fires after the event cap is reached', () => {
  const s = new LockoutService();
  s.setCurrentFileFn(() => 'eqlog_Avenrae_rivervale.txt');
  const st = s._stateFor('Avenrae');
  // Saturate the cap directly - this is about what happens AT the cap, not about how it got there.
  st.events = new Array(5000).fill({ key: 'x', kind: 'noop', civil: 0, at: '' });
  assert.equal(st.events.length, 5000);

  let fired = 0;
  s.on('changed', () => { fired += 1; });
  s.handleLine("[Mon Aug 31 09:20:00 2026] You have been assigned the task 'Potential of the Void - Lady Vox - Weekly'.");
  assert.equal(st.events.length, 5000, 'the cap must still be holding, or this proves nothing');
  assert.ok(fired > 0, 'a real change produced no event - the grid would be frozen');
});

test('irrelevant lines do not fire a redraw', () => {
  const s = new LockoutService();
  s.setCurrentFileFn(() => 'eqlog_Avenrae_rivervale.txt');
  s._stateFor('Avenrae');
  let fired = 0;
  s.on('changed', () => { fired += 1; });
  s.handleLine('[Mon Aug 31 09:26:00 2026] Avenrae tells the guild, hello');
  assert.equal(fired, 0);
});

// ---------------------------------------------------------------------------
// THE UNCERTAINTY, all the way to the screen
// ---------------------------------------------------------------------------

// The defining requirement. Two different words, two different CSS classes, and a title that says
// outright they are not the same thing.
test('not_looked and open are rendered as different things', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const block = js.slice(js.indexOf('LOCKOUT_STATES = {'), js.indexOf('function lockoutCell'));
  assert.ok(block.includes('not_looked'), 'not_looked must be mapped explicitly');
  const notLooked = block.slice(block.indexOf('not_looked'));
  assert.ok(/not looked/i.test(notLooked), 'not_looked must not read as any other state');
  assert.ok(/NOT the same as open/i.test(notLooked), 'the difference has to be said, not implied');
  const css = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.css'), 'utf8');
  const open = css.match(/\.lockout-open\s*\{([^}]*)\}/);
  const nl = css.match(/\.lockout-not_looked\s*\{([^}]*)\}/);
  assert.ok(open && nl, 'both states need their own rule');
  assert.notEqual(open[1].trim(), nl[1].trim(), 'they must not look the same');
});

// If the core ever emits a state the renderer has not mapped, the cell falls back to printing the
// raw key - which is how "an unmapped name renders as a MISSING lockout" happens, the failure this
// tool is named for arriving sideways.
test('every state the core can emit is mapped in the renderer', () => {
  const coreSrc = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'lockoutCore.js'), 'utf8');
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const mapped = new Set(
    [...js.slice(js.indexOf('LOCKOUT_STATES = {'), js.indexOf('function lockoutCell'))
      .matchAll(/^\s{4}(\w+):/gm)].map((m) => m[1])
  );
  // The states the core actually assigns to a cell.
  const emitted = new Set([
    ...[...coreSrc.matchAll(/cellState = '(\w+)'/g)].map((m) => m[1]),
    ...[...coreSrc.matchAll(/return \{ s: '(\w+)'/g)].map((m) => m[1]),
  ]);
  assert.ok(emitted.size >= 3, 'the state scan found nothing - the core has been restructured');
  const unmapped = [...emitted].filter((s) => !mapped.has(s));
  assert.deepEqual(unmapped, [], `states the UI would print raw: ${unmapped.join(', ')}`);
});

// The module tolerates a coverage hole under 24 h and lets the cell read `open` anyway - a
// documented judgement, and a reasonable one, but it means an `open` can sit on a 23-hour hole.
// Their own page renders `coverageHoles`, which excludes exactly those. Ours must not.
test('tolerated coverage gaps are shown, not just the intolerable ones', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  // Comments stripped, for the same reason as the countdown test below: this block's own
  // commentary explains why coverageHoles is the wrong source, and naming it there is not using it.
  const block = js
    .slice(js.indexOf('Raid lockouts (Session D'), js.indexOf('function renderMasterButtons'))
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  assert.ok(block.includes('coverageGaps'), 'the UI must read coverageGaps, which includes tolerated holes');
  assert.ok(!/coverageHoles/.test(block), 'coverageHoles omits the tolerated gaps and must not be the source');
  assert.ok(/not in the grid/.test(block), 'the consequence of a gap has to be stated');
});

// A countdown needs the reset hour. The reset hour has never been measured. If one appears, it was
// invented, and inventing it is the one thing that would make this a worse copy of tools that
// already exist.
test('there is no countdown anywhere in the lockout UI', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  // Comments stripped first: the block's own commentary explains that there is deliberately no
  // countdown, and an earlier version of this test failed on the word inside that explanation.
  const block = js
    .slice(js.indexOf('Raid lockouts (Session D'), js.indexOf('function renderMasterButtons'))
    .split('\n')
    .filter((l) => !l.trim().startsWith('//'))
    .join('\n');
  for (const banned of [/setInterval/, /requestAnimationFrame/, /remaining/i, /countdown/i, /timeLeft/i]) {
    assert.equal(banned.test(block), false, `the lockout UI must not contain ${banned}`);
  }
});

// The reset DAY came from the owner saying so; the reset HOUR has never been measured. Both facts
// have to reach the screen, or the grid looks more certain than it is.
test('the reset rule reaches the UI with its provenance and its null hour', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const block = js.slice(js.indexOf('Raid lockouts (Session D'), js.indexOf('function renderMasterButtons'));
  assert.ok(block.includes('resetRule.provenance'), 'the reset day must show where it came from');
  assert.ok(/never measured/.test(block), 'the missing reset hour must be stated, not omitted');
  assert.ok(block.includes('period.provenance'), 'the period must show its provenance');
  assert.ok(/floor and not a value/.test(block), 'the period is a floor and must say so');
});

// The whole projection is a pure function of (state, now), so a grid rendered "now" and the same
// grid rendered from the same state later must not drift on their own.
test('the projection is a pure function of state and now', async () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': [ASSIGN('Lord Nagafen')] });
  const s = new LockoutService();
  s.setLogsFolderFn(() => dir);
  await s.backfill();
  const at = civilNow(new Date(2026, 7, 20, 12, 0, 0));
  assert.equal(
    JSON.stringify(s.getProjection(at)),
    JSON.stringify(s.getProjection(at)),
    'two projections at the same instant must be identical'
  );
});

// Clause 4, at the boundary that matters: this crosses IPC to the renderer.
test('the projection survives the trip over IPC', async () => {
  const dir = tempLogs({ 'eqlog_Avenrae_rivervale.txt': [ASSIGN('Lord Nagafen')] });
  const s = new LockoutService();
  s.setLogsFolderFn(() => dir);
  await s.backfill();
  const p = s.getProjection(civilNow(new Date(2026, 7, 20, 12, 0, 0)));
  assert.deepEqual(p, JSON.parse(JSON.stringify(p)), 'a Map, Set or Date has reached the payload');
});

module.exports = () => report('lockouts');
if (require.main === module) report('lockouts').then((n) => process.exit(n ? 1 : 0));
