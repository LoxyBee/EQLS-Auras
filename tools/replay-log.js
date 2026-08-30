'use strict';
/**
 * Replays real EverQuest logs through the detection engine and records what it detected.
 *
 * WHY THIS EXISTS. Detection is the code that fails silently: when it goes wrong nobody sees an
 * error, a timer the player relied on simply stops appearing. The owner's constraint on this work
 * is "if any functionality is lost during this process that is to be considered a failure", and
 * the only way to hold to that on a change to the engine is to measure it against real logs
 * before and after. This is that measurement.
 *
 *   node tools/replay-log.js --out before.json          # capture, using every log it can find
 *   ...make the change...
 *   node tools/replay-log.js --out after.json
 *   node tools/replay-log.js --diff before.json after.json
 *
 * The diff is the answer. Anything that was detected before and is not detected after is a
 * regression, whatever else improved.
 *
 * NOT A TEST. It needs the owner's own logs, which are not in the repository, so it cannot run in
 * the suite. It is a measuring instrument for a human to point at a change.
 *
 * THE SPELLBOOK IS A VARIABLE, AND BY DEFAULT IT IS EMPTY. The engine's strongest tool for
 * deciding whether an ambiguous buff message is the player's own is their spellbook file, and
 * without one it cannot narrow anything. Pass --spellbook <path> to replay WITH one; leave it off
 * to replay without.
 *
 * Leaving it off is not a shortcut - it is the owner's actual situation. That file has never
 * existed on her machine, so a replay without one is what her sessions really looked like. It is
 * also why the numbers are so lopsided: across 1.6 million lines, 14,650 ambiguous landings were
 * discarded outright as "not your spellbook" and about 11,000 more became prompts for the same
 * reason. Compare the two modes before concluding anything about the ambiguity tiers.
 *
 * TWO DELIBERATE DEPARTURES FROM REAL TIME, both so the same input always gives the same output:
 *
 *   1. The one-second tick is stopped. Replaying hours of play in a second means almost nothing
 *      would expire anyway, and leaving a wall-clock timer running would make the result depend
 *      on how fast the machine happened to be.
 *   2. After the last line, it waits out the pending-cast fallback window before snapshotting, so
 *      casts waiting on that timer are counted rather than cut off mid-flight.
 */

const fs = require('node:fs');
const path = require('node:path');
const { BuffStore } = require('../src/main/buffStore');
const { BuffEngine } = require('../src/main/buffEngine');
const { FALLBACK_CONFIRM_WINDOW_MS } = require('../src/main/buffParser');
const { SpellbookService } = require('../src/main/spellbookService');

// With no paths given, replay every log tools/lib/owner-logs.js can find on this machine - it
// reads the app's own configured EQ folder and takes the per-day Split/ files (continuous, no
// overlap between days). This replaced a hardcoded list of C:/Users/Lindsey/... paths, which was
// a different Windows account than any machine this has run on since, so it always found nothing.
//
// The documented baseline in the header (129 buffs, 211,546 landings, ...) was captured from that
// original file set; a run over a different machine's logs will not match those absolute numbers.
// The --diff of a before/after over the SAME set is the regression check, and that is unaffected.
const { findOwnerLogs } = require('./lib/owner-logs');
const DEFAULT_LOGS = findOwnerLogs();

/** In-memory stand-in for src/main/store.js. */
function memoryStore(initial = {}) {
  const data = JSON.parse(JSON.stringify(initial));
  return {
    loadJson: (name, fallback) => (name in data ? JSON.parse(JSON.stringify(data[name])) : fallback),
    saveJson: (name, value) => { data[name] = JSON.parse(JSON.stringify(value)); },
  };
}

/**
 * Replays one log and returns what the engine did with it.
 *
 * Recorded by wrapping the engine's own landing methods rather than by listening to events:
 * buffsChanged fires on every tick and every expiry too, so counting those would drown the signal
 * in noise. These four are the actual decisions.
 */
async function replay(files, spellbookPath = null, enemyNames = null) {
  const store = memoryStore();
  const buffStore = new BuffStore(store);
  const engine = new BuffEngine(buffStore, store);
  engine.stop(); // see the header - determinism

  // Reaches past the service's own file-finding, which needs an install root and a character name
  // it has no way to know here. _load is the only internal touched, and only by this tool.
  if (spellbookPath) {
    const svc = new SpellbookService();
    svc.filePath = spellbookPath;
    svc._load();
    engine.setSpellbookCheckFn((name) => svc.has(name));
    console.log(`  with spellbook: ${svc.getCount()} spells from ${spellbookPath}`);
  }
  // Stands in for widgetManager.getEnemyDebuffNames() - the spells some aura has asked to watch
  // on things you are fighting. Without it the recipient check stays strict and mob names are
  // rejected, which is exactly the state to measure the relaxed one against.
  if (enemyNames && enemyNames.length) {
    const set = new Set(enemyNames.map((n) => n.toLowerCase()));
    engine.setEnemyDebuffNamesFn(() => set);
    console.log(`  watching on enemies: ${enemyNames.join(', ')}`);
  }

  // WHICH CHECK DECIDED, and how often. The engine narrates every decision through _debugLog with
  // a distinct sentence per check, so tallying those sentences - with the spell names and quoted
  // log text stripped out - gives a histogram of which tier is actually carrying the work.
  //
  // This is the number to look at before reordering two checks: if a tier decides nothing across
  // 800,000 real lines, moving it changes nothing, and the reasoning for moving it is about a
  // situation that does not arise. It is evidence instead of an argument.
  const tiers = new Map();
  engine.setDebugLogFn((msg) => {
    const reason = String(msg)
      .replace(/"[^"]*"/g, '"..."')       // spell names and quoted log lines
      .replace(/\b\d+\b/g, 'N')            // counts
      .trim();
    tiers.set(reason, (tiers.get(reason) || 0) + 1);
  });

  const landed = new Map();     // buff name -> times landed on the player
  const allyLanded = new Map(); // "buff|ally" -> times
  const ambiguous = new Map();  // landing text -> the candidate names it offered
  const unknown = new Set();    // landing-shaped text the roster does not know

  // Counted AFTER the call, and only if the buff is really in the active map.
  //
  // An earlier version counted the call itself, which quietly turned this instrument into a liar:
  // _land can decline (a blocked name, or a roster entry with no duration), so a spell that was
  // attempted a hundred times and landed none of them still appeared in the results as if it had.
  // The whole question this tool answers is "did anything stop being detected", and counting
  // attempts answers a different one.
  const origLand = engine._land.bind(engine);
  engine._land = (known) => {
    const result = origLand(known);
    if (engine.activeBuffs.has(known.name.toLowerCase())) {
      landed.set(known.name, (landed.get(known.name) || 0) + 1);
    }
    return result;
  };
  const origAlly = engine._landOnAlly.bind(engine);
  engine._landOnAlly = (known, allyName) => {
    const result = origAlly(known, allyName);
    if (engine.allyBuffs.has(`${allyName.toLowerCase()}::${known.name.toLowerCase()}`)) {
      const key = `${known.name}|${allyName}`;
      allyLanded.set(key, (allyLanded.get(key) || 0) + 1);
    }
    return result;
  };
  const origAmbiguous = engine._queueAmbiguousCast.bind(engine);
  engine._queueAmbiguousCast = (text, candidates, isSelf) => {
    // Sorted, because the candidate ORDER is not part of what is being measured and would
    // otherwise make two identical outcomes look different.
    if (!ambiguous.has(text)) ambiguous.set(text, [...candidates].sort());
    return origAmbiguous(text, candidates, isSelf);
  };
  const origUnknown = engine._onBuffLanded.bind(engine);
  engine._onBuffLanded = (name) => {
    unknown.add(name);
    return origUnknown(name);
  };

  let lineCount = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line.trim()) continue;
      lineCount++;
      engine.handleLine(line);
    }
  }

  // Let the pending-cast fallback timers finish before taking the picture - see the header.
  // Overridable only to keep the tool's own smoke test quick; leave it alone for a real capture.
  const drainMs = Number(process.env.REPLAY_DRAIN_MS) || FALLBACK_CONFIRM_WINDOW_MS + 500;
  await new Promise((resolve) => setTimeout(resolve, drainMs));

  const sorted = (m) => Object.fromEntries([...m.entries()].sort(([a], [b]) => a.localeCompare(b)));
  return {
    files,
    spellbookPath,
    enemyNames: enemyNames || [],
    lineCount,
    landed: sorted(landed),
    allyLanded: sorted(allyLanded),
    ambiguous: sorted(ambiguous),
    unknown: [...unknown].sort(),
    // Sorted by how often each fired, because the question this answers is "which checks matter".
    tiers: Object.fromEntries([...tiers.entries()].sort((a, b) => b[1] - a[1])),
    totals: {
      distinctBuffsLanded: landed.size,
      totalLandings: [...landed.values()].reduce((a, b) => a + b, 0),
      distinctAllyLandings: allyLanded.size,
      ambiguousPrompts: ambiguous.size,
      unknownTexts: unknown.size,
    },
  };
}

/** Prints what changed between two captures, loudest first. */
function diff(beforePath, afterPath) {
  const before = JSON.parse(fs.readFileSync(beforePath, 'utf8'));
  const after = JSON.parse(fs.readFileSync(afterPath, 'utf8'));

  if (before.lineCount !== after.lineCount) {
    console.log(`WARNING: different line counts (${before.lineCount} vs ${after.lineCount}) - not comparable`);
  }
  if ((before.spellbookPath || null) !== (after.spellbookPath || null)) {
    console.log(
      `WARNING: one side had a spellbook and the other did not (${before.spellbookPath} vs ` +
      `${after.spellbookPath}). That changes the ambiguity tiers enormously - this is a comparison ` +
      `of two different situations, not of a code change.`
    );
  }

  let regressions = 0;
  const section = (title, beforeObj, afterObj, lossIsRegression) => {
    const keys = [...new Set([...Object.keys(beforeObj), ...Object.keys(afterObj)])].sort();
    const gone = keys.filter((k) => k in beforeObj && !(k in afterObj));
    const added = keys.filter((k) => !(k in beforeObj) && k in afterObj);
    const changed = keys.filter(
      (k) => k in beforeObj && k in afterObj && JSON.stringify(beforeObj[k]) !== JSON.stringify(afterObj[k])
    );
    console.log(`\n${title}`);
    if (!gone.length && !added.length && !changed.length) {
      console.log('  identical');
      return;
    }
    for (const k of gone) {
      console.log(`  ${lossIsRegression ? 'LOST      ' : 'gone      '} ${k} (was ${JSON.stringify(beforeObj[k])})`);
      if (lossIsRegression) regressions++;
    }
    for (const k of added) console.log(`  gained     ${k} (${JSON.stringify(afterObj[k])})`);
    for (const k of changed) {
      console.log(`  changed    ${k}: ${JSON.stringify(beforeObj[k])} -> ${JSON.stringify(afterObj[k])}`);
    }
  };

  section('Buffs landed on you', before.landed, after.landed, true);
  section('Buffs landed on allies', before.allyLanded, after.allyLanded, true);
  section('Ambiguous prompts', before.ambiguous, after.ambiguous, false);
  section('Which check decided', before.tiers || {}, after.tiers || {}, false);

  const goneUnknown = before.unknown.filter((u) => !after.unknown.includes(u));
  const newUnknown = after.unknown.filter((u) => !before.unknown.includes(u));
  console.log('\nUnrecognised landing text');
  if (!goneUnknown.length && !newUnknown.length) console.log('  identical');
  // Fewer unknowns is an IMPROVEMENT - it means something that was unrecognised is now known.
  for (const u of goneUnknown) console.log(`  now recognised  ${u}`);
  for (const u of newUnknown) console.log(`  newly unknown   ${u}`);

  console.log('\nTotals');
  for (const k of Object.keys(before.totals)) {
    const b = before.totals[k];
    const a = after.totals[k];
    console.log(`  ${k.padEnd(24)} ${String(b).padStart(6)} -> ${String(a).padStart(6)}${b === a ? '' : '  *'}`);
  }

  console.log(
    regressions
      ? `\n${regressions} REGRESSION(S): something detected before is not detected now.`
      : '\nNo regressions: everything detected before is still detected.'
  );
  return regressions;
}

async function main() {
  const args = process.argv.slice(2);
  const diffAt = args.indexOf('--diff');
  if (diffAt >= 0) {
    process.exit(diff(args[diffAt + 1], args[diffAt + 2]) ? 1 : 0);
  }

  const outAt = args.indexOf('--out');
  const out = outAt >= 0 ? args[outAt + 1] : null;
  const bookAt = args.indexOf('--spellbook');
  const spellbook = bookAt >= 0 ? args[bookAt + 1] : null;
  const enemyAt = args.indexOf('--enemy');
  const enemyNames = enemyAt >= 0 ? String(args[enemyAt + 1] || '').split(',').map((s) => s.trim()).filter(Boolean) : null;
  // Skip the flag AND its value; everything else left over is a log path. The earlier version
  // compared against outAt + 1 even when there was no --out at all, which made outAt + 1 zero and
  // silently threw away the first path given.
  const given = args.filter(
    (a, i) =>
      !a.startsWith('--') &&
      !(outAt >= 0 && i === outAt + 1) &&
      !(bookAt >= 0 && i === bookAt + 1) &&
      !(enemyAt >= 0 && i === enemyAt + 1)
  );
  const files = (given.length ? given : DEFAULT_LOGS).filter((f) => {
    if (fs.existsSync(f)) return true;
    console.log(`skipping (not found): ${f}`);
    return false;
  });
  if (!files.length) {
    console.error(
      'No logs to replay. Pass paths explicitly, or point the app at your EQ Logs folder ' +
      '(Setup page) so owner-logs.js can find them.'
    );
    process.exit(2);
  }

  console.log(`Replaying ${files.length} log(s)...`);
  const result = await replay(files, spellbook, enemyNames);
  console.log(`\n${result.lineCount} lines`);
  for (const [k, v] of Object.entries(result.totals)) console.log(`  ${k.padEnd(24)} ${v}`);

  console.log('\nWhich check decided:');
  for (const [reason, count] of Object.entries(result.tiers)) {
    console.log(`  ${String(count).padStart(7)}  ${reason}`);
  }

  if (out) {
    fs.writeFileSync(out, JSON.stringify(result, null, 1));
    console.log(`\nwritten to ${path.resolve(out)}`);
  }
}

if (require.main === module) main();
module.exports = { replay, diff };
