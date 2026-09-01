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

// The app feeds backfill the SINGLE live log the tailer is on, not a folder. This writes one file
// and returns its path, for pointing setCurrentFileFn at.
function liveLog(lines, name = 'eqlog_Baxa_rivervale.txt', eol = '\r\n') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-lockouts-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, lines.join(eol) + eol, 'utf8');
  return file;
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
// one task granted twice. Attribution is by the file the tailer is on, which switches as the
// player alt-tabs between characters.
test('two characters never share state', () => {
  const s = new LockoutService();
  let file = 'C:/eq/Logs/eqlog_Baxa_rivervale.txt';
  s.setCurrentFileFn(() => file);
  s.handleLine(ASSIGN('Lord Nagafen'));
  file = 'C:/eq/Logs/eqlog_Vaela_rivervale.txt';
  s.handleLine(ASSIGN('Lady Vox'));
  assert.deepEqual([...s.states.keys()].sort(), ['Baxa', 'Vaela']);
  const p = s.getProjection(civilNow(new Date(2026, 7, 12, 12, 0, 0)));
  const av = p.characters.find((c) => c.character === 'Baxa');
  const sh = p.characters.find((c) => c.character === 'Vaela');
  assert.ok(av.projection.bosses.some((b) => b.boss === 'Lord Nagafen'));
  assert.ok(!av.projection.bosses.some((b) => b.boss === 'Lady Vox'), "Baxa must not carry Vaela's task");
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
  s.setCurrentFileFn(() => 'C:/eq/Logs/eqlog_Baxa_rivervale.txt');
  s.handleLine(ASSIGN('Lord Nagafen'));
  assert.deepEqual([...s.states.keys()], ['Baxa']);
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
  s.setCurrentFileFn(() => 'eqlog_Baxa_rivervale.txt');
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

test('no live log file fails cleanly and says so', async () => {
  const s = new LockoutService();
  s.setCurrentFileFn(() => null);
  const r = await s.backfill();
  assert.equal(r.ok, false);
  assert.match(r.reason, /no live log/);
});

// ---------------------------------------------------------------------------
// Only the live log — not the folder, not Split/, not Archive/
// ---------------------------------------------------------------------------

// The grid answers "this lockout week", and the weekly archive keeps the live log scoped to
// exactly that. Reading dated Split/ files or the folder at large pulls in older weeks. The one
// file the tailer is on is the whole input.
test('only the live log is read, not the rest of the folder', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-lockouts-'));
  const live = path.join(dir, 'eqlog_Baxa_rivervale.txt');
  fs.writeFileSync(live, ASSIGN('Lord Nagafen') + '\r\n', 'utf8');
  // A dated file (as logSplitter.js would write) sitting right beside it, and a Split/ subfolder.
  fs.writeFileSync(path.join(dir, 'eqlog_Baxa_rivervale_2026-08-15.txt'), ASSIGN('Lady Vox') + '\r\n', 'utf8');
  fs.mkdirSync(path.join(dir, 'Split'));
  fs.writeFileSync(path.join(dir, 'Split', 'eqlog_Baxa_rivervale_2026-08-16.txt'), ASSIGN('Master Yael') + '\r\n', 'utf8');

  const s = new LockoutService();
  s.setLogsFolderFn(() => dir);
  s.setCurrentFileFn(() => live);
  const r = await s.backfill();
  assert.equal(r.files, 1, 'exactly one file - the live log');
  const bosses = s.getProjection(civilNow(new Date(2026, 7, 20, 12, 0, 0)))
    .characters[0].projection.bosses.map((b) => b.boss);
  assert.deepEqual(bosses, ['Lord Nagafen'], 'Lady Vox and Master Yael are in other files and must not appear');
});

// The reason the weekly archive can be OFF by default: backfill seeks to this lockout week's
// boundary in the live log instead of re-parsing a months-old file every launch.
test('backfill reads only the current week off a large multi-week live log', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-lockouts-big-'));
  const live = path.join(dir, 'eqlog_Baxa_rivervale.txt');

  // > 20 MB of last-year filler, so _weekStartOffset actually seeks rather than reading whole.
  const old = `[Mon Jan 01 12:00:00 2024] filler line that is a whole year before this lockout week\n`;
  const fd = fs.openSync(live, 'w');
  const block = Buffer.from(old.repeat(4000)); // ~320 KB
  for (let i = 0; i < 70; i++) fs.writeSync(fd, block); // ~22 MB
  fs.closeSync(fd);

  // One current-week task assignment at the very end.
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const stamp = `[${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][now.getDay()]} ` +
    `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][now.getMonth()]} ` +
    `${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}:${p(now.getSeconds())} ${now.getFullYear()}]`;
  fs.appendFileSync(live, `${stamp} You have been assigned the task 'Potential of the Void - Lord Nagafen - Weekly'.\n`);

  const s = new LockoutService();
  s.setCurrentFileFn(() => live);
  const r = await s.backfill();

  assert.ok(r.lines < 1000, `read only the current-week tail, not the whole file (got ${r.lines} lines of ~270k)`);
  const bosses = s.getProjection().characters[0].projection.bosses.map((b) => b.boss);
  assert.deepEqual(bosses, ['Lord Nagafen'], 'the current-week task at the end of the file was still picked up');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a live file whose name is not an eqlog is handled without a crash', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-lockouts-'));
  const odd = path.join(dir, 'dbg.txt');
  fs.writeFileSync(odd, ASSIGN('Lord Nagafen') + '\r\n', 'utf8');
  const s = new LockoutService();
  s.setCurrentFileFn(() => odd);
  const r = await s.backfill();
  assert.equal(r.ok, true);
  assert.equal(r.files, 0, 'no character could be parsed from the name, so nothing was read');
  assert.equal(s.states.size, 0);
});

// A backfill ALWAYS overlaps the live tailer, so this is load-bearing rather than a nicety.
//
// The claim being tested is D's exact one, not a stricter one I assumed: replaying the whole
// stream changes EXACTLY ONE key, `dropped.duplicate`, the counter recording how many repeats were
// rejected. That counter is supposed to move. My first version of this test asserted nothing moved
// at all and failed on precisely that counter, which is the test being wrong rather than the code.
test('scanning twice changes only the duplicate counter', async () => {
  const file = liveLog([ASSIGN('Lord Nagafen')]);
  const s = new LockoutService();
  s.setCurrentFileFn(() => file);
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
test('CRLF and LF live logs both parse', async () => {
  for (const [eol, name] of [['\r\n', 'eqlog_Crlf_rivervale.txt'], ['\n', 'eqlog_Lfonly_rivervale.txt']]) {
    const file = liveLog([ASSIGN('Lord Nagafen')], name, eol);
    const s = new LockoutService();
    s.setCurrentFileFn(() => file);
    await s.backfill();
    const e = s.getProjection(civilNow(new Date(2026, 7, 20, 12, 0, 0))).characters[0];
    assert.ok(e && e.projection.bosses.length === 1, `${name} produced no task`);
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
  s.setCurrentFileFn(() => 'eqlog_Baxa_rivervale.txt');
  const st = s._stateFor('Baxa');
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
  s.setCurrentFileFn(() => 'eqlog_Baxa_rivervale.txt');
  s._stateFor('Baxa');
  let fired = 0;
  s.on('changed', () => { fired += 1; });
  s.handleLine('[Mon Aug 31 09:26:00 2026] Baxa tells the guild, hello');
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

// The page's own "How this is read" blurb still has to carry the two facts that keep the grid
// honest: the reset day is only STATED (not measured), and the reset hour is not known - which is
// why a boundary-day kill reads "depends" and there is no countdown.
test('the how-this-is-read blurb states the reset is unmeasured', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'index.html'), 'utf8');
  const at = html.indexOf('How this is read');
  assert.ok(at > -1, 'the lockout explainer card is gone - this test needs rewriting');
  const card = html.slice(at, at + 800);
  assert.match(card, /reset/i, 'the blurb must mention the reset');
  assert.match(card, /hour isn't known|hour is not known|reset hour/i, 'the missing reset hour must be stated');
  assert.match(card, /no countdown/i, 'the absence of a countdown must be explained, not silent');
});

// The whole projection is a pure function of (state, now), so a grid rendered "now" and the same
// grid rendered from the same state later must not drift on their own.
test('the projection is a pure function of state and now', async () => {
  const file = liveLog([ASSIGN('Lord Nagafen')]);
  const s = new LockoutService();
  s.setCurrentFileFn(() => file);
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
  const file = liveLog([ASSIGN('Lord Nagafen')]);
  const s = new LockoutService();
  s.setCurrentFileFn(() => file);
  await s.backfill();
  const p = s.getProjection(civilNow(new Date(2026, 7, 20, 12, 0, 0)));
  assert.deepEqual(p, JSON.parse(JSON.stringify(p)), 'a Map, Set or Date has reached the payload');
});


// ---------------------------------------------------------------------------
// The page must not contradict itself
// ---------------------------------------------------------------------------

const RENDERER = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'),
  'utf8'
);
const SETUP_HTML = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'index.html'),
  'utf8'
);

// After a rotation the grid is every cell "not looked" and no "open" at all - which is the
// guaranteed state of this page for the first days after the weekly archive ships. The gap line
// read "N of them short enough that the cells above still read open" directly under a summary
// saying 0 open. On the page whose entire argument is that it never claims more than it knows,
// that is the worst possible sentence.
test('the tolerated-gap clause is not shown when there are no open cells', () => {
  const at = RENDERER.indexOf('const tolerated =');
  assert.ok(at > -1, 'the tolerated count is gone - this test needs rewriting');
  const line = RENDERER.slice(at, RENDERER.indexOf(';', at));
  assert.match(
    line,
    /openCount\s*>\s*0/,
    'the clause describing "open" cells is emitted regardless of whether any open cells exist'
  );
});

// The module's own `because` for an open cell says coverage spans the period. On the owner's live
// data that is false - 14 open cells while 68 of the period's 113 hours are unobserved across
// tolerated gaps - and the line below the grid says so with numbers. A tooltip that contradicts
// the sentence beneath it is worse than no tooltip.
test('the open cell does not claim the logs cover the whole period', () => {
  const at = RENDERER.indexOf('open: {');
  assert.ok(at > -1, 'the open state entry is gone - this test needs rewriting');
  const entry = RENDERER.slice(at, at + 400);
  assert.ok(
    !/cover the whole period/.test(entry),
    'the open tooltip still claims full coverage, which the gap line below it contradicts'
  );
  assert.ok(/see the note/.test(entry), 'the tooltip does not point at the gap line that qualifies it');
});

// The reset day/hour is ONE setting now. Both pages carry the same controls (bound to the same
// store key), so there is no contradiction to reconcile - but the Setup card still has to say
// where the default came from: the owner's own in-game reading, not the log.
test('the reset setting is on both pages and names where the default came from', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'index.html'), 'utf8');
  assert.ok(html.includes('id="lockout-reset-day"') && html.includes('id="lockout-reset-hour"'),
    'the Lockouts page must carry the reset controls');
  assert.ok(html.includes('id="setup-reset-day"') && html.includes('id="setup-reset-hour"'),
    'the Setup page must carry the same reset controls');
  // 1600, not 1200 - the rotation checkbox's own explanatory title (added when rotation went
  // opt-in for the public release) sits between the heading and the reset-day hint below it.
  const setup = SETUP_HTML.slice(SETUP_HTML.indexOf('Weekly archive at the raid reset'), SETUP_HTML.indexOf('Weekly archive at the raid reset') + 1600);
  assert.match(setup, /same value|changing it there/i, 'the Setup card must say it is the same setting as the Lockouts page');
  assert.match(setup, /your own\s+reading of the in-game|in-game lockout timer/i,
    'the default must be attributed to the owner\'s in-game reading, not the log');
});

// ---------------------------------------------------------------------------
// Log tools: change target, add files
// ---------------------------------------------------------------------------

test('setLogTarget points backfill at a different file', async () => {
  const other = liveLog([ASSIGN('Master Yael')], 'eqlog_Mule_rivervale.txt');
  const live = liveLog([ASSIGN('Lord Nagafen')]);
  const s = new LockoutService();
  s.setCurrentFileFn(() => live);
  s.setLogTarget(other);
  await s.backfill();
  assert.deepEqual([...s.states.keys()], ['Mule'], 'backfill read the target, not the tailed file');
  assert.equal(s.getStatus().logTarget, other);
});

test('addLogs feeds extra files into the grid without a full rebuild', async () => {
  const live = liveLog([ASSIGN('Lord Nagafen')]);
  const extra1 = liveLog([ASSIGN('Lady Vox')], 'eqlog_Baxa_rivervale_2026-08-15.txt');
  const extra2 = liveLog([ASSIGN('Master Yael')], 'eqlog_Baxa_rivervale_2026-08-16.txt');
  const s = new LockoutService();
  s.setCurrentFileFn(() => live);
  await s.backfill();
  let fired = 0;
  s.on('changed', () => { fired += 1; });
  const r = await s.addLogs([extra1, extra2, 'C:/does/not/exist.txt']);
  assert.equal(r.files, 2);
  assert.ok(fired >= 1, 'a change was emitted so the grid re-broadcasts');
  const bosses = s.getProjection(civilNow(new Date(2026, 7, 20, 12, 0, 0)))
    .characters[0].projection.bosses.map((b) => b.boss).sort();
  assert.deepEqual(bosses, ['Lady Vox', 'Lord Nagafen', 'Master Yael']);
});

test('addLogs marks the view as multi-file, and a rebuild clears that', async () => {
  const live = liveLog([ASSIGN('Lord Nagafen')]);
  const extra = liveLog([ASSIGN('Lady Vox')], 'eqlog_Baxa_rivervale_2026-08-15.txt');
  const s = new LockoutService();
  s.setCurrentFileFn(() => live);
  await s.backfill();
  assert.equal(s.getStatus().extraLogs, 0);
  await s.addLogs([extra]);
  assert.equal(s.getStatus().extraLogs, 1, 'the extra file is counted');
  await s.rebuild();
  assert.equal(s.getStatus().extraLogs, 0, 'a full rebuild forgets the stitched-in files');
});

test('the Trim offer is hidden once extra logs are stitched in', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const block = js.slice(js.indexOf('entry.spansPriorWeek'), js.indexOf('entry.spansPriorWeek') + 120);
  assert.ok(/multiLog/.test(block) && /!multiLog/.test(block),
    'the trim button condition must exclude the multi-file view');
});

test('Add split files pre-ticks only this week, not every split file', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const h = js.slice(js.indexOf("title: 'Add split files'") - 600, js.indexOf("title: 'Add split files'") + 200);
  assert.ok(/preselectPaths/.test(h), 'it passes explicit paths, not a whole group');
  assert.ok(!/preselectGroup:\s*'split'/.test(h), 'the old tick-everything path is gone');
});

test('a completed cell carries the kill date for the renderer', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  assert.ok(/lockout-killdate/.test(js) && /cell\.completedAt/.test(js),
    'lockoutCell must render cell.completedAt');
});

test('spansPriorWeek is set when the log reaches before this week', async () => {
  // A line from well before, plus one from this week.
  const live = liveLog([
    '[Sun Aug 24 20:00:00 2026] older',
    ASSIGN('Lord Nagafen').replace('Aug 10 17:14:49', 'Aug 27 21:00:00'),
  ]);
  const s = new LockoutService();
  s.setCurrentFileFn(() => live);
  s.setResetRule({ weekday: 2, hour: 11 });
  await s.backfill();
  const p = s.getProjection(civilNow(new Date(2026, 7, 29, 12, 0, 0)));
  assert.equal(p.characters[0].spansPriorWeek, true);
});

// The grid boundary must be resolved in US Eastern and handed to lockoutCore as pre-computed
// civil components - never left to lockoutCore's own weekday/hour math, which is only right on an
// Eastern machine. This pins that lockoutService always passes it.
test('getProjection always hands lockoutCore a pre-resolved boundaryCivil', async () => {
  const file = liveLog([ASSIGN('Lord Nagafen')]);
  const s = new LockoutService();
  s.setCurrentFileFn(() => file);
  s.setResetRule({ weekday: 2, hour: 11 });
  await s.backfill();
  const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'lockoutService.js'), 'utf8');
  const call = src.slice(src.indexOf('core.projectGrid('), src.indexOf('core.projectGrid(') + 250);
  assert.ok(/boundaryCivil/.test(call) && /periodEndCivil/.test(call),
    'projectGrid must be called with boundaryCivil / periodEndCivil');
});

test('rebuild() is single-flight - two concurrent calls do not interleave', async () => {
  const file = liveLog([ASSIGN('Lord Nagafen')]);
  const s = new LockoutService();
  s.setCurrentFileFn(() => file);
  const [a, b] = await Promise.all([s.rebuild(), s.rebuild()]);
  // Both resolve, and the state is exactly one clean read - not a doubled or half-cleared one.
  assert.equal(a.ok || b.ok, true);
  assert.deepEqual([...s.states.keys()], ['Baxa']);
  const bosses = s.getProjection(civilNow(new Date(2026, 7, 20, 12, 0, 0))).characters[0].projection.bosses;
  assert.equal(bosses.length, 1, 'the task was recorded exactly once');
});

test('a missing log target is dropped, and backfill falls back to the live log', async () => {
  const live = liveLog([ASSIGN('Lord Nagafen')]);
  const s = new LockoutService();
  s.setCurrentFileFn(() => live);
  s.setLogTarget('C:/gone/eqlog_Mule_rivervale.txt');
  const r = await s.backfill();
  assert.equal(r.targetCleared, true, 'backfill reports the dead target was dropped');
  assert.equal(s.getStatus().logTarget, null);
  assert.deepEqual([...s.states.keys()], ['Baxa'], 'it read the live log instead');
});

module.exports = () => report('lockouts');
if (require.main === module) report('lockouts').then((n) => process.exit(n ? 1 : 0));
