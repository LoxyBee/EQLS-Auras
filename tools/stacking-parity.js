'use strict';
/**
 * 100%-parity gate for the ported stacking engine (src/shared/spellStackingEngine.js).
 *
 * Runs our port and the ORIGINAL reference engine (the published client-side EQL stacking engine
 * this was ported from, as ESM) over every ordered pair of the 1061 EQL spells and asserts
 * identical verdicts. This is the centrepiece test for the port - "port every branch" only means
 * something if it matches.
 *
 * NOT a unit test (needs the reference engine + the 1061-spell data file, neither in the repo -
 * same reason replay-log.js can't be). A measuring instrument for a human.
 *
 *   node tools/stacking-parity.js --ref <dir> --data <spells.json> [--levels]
 *
 *   --ref    a directory holding the reference `stacking.mjs` / `data.mjs` / `stacking_rules.mjs`
 *            (ESM copies of the reference engine's stacking.js / data.js / stacking_rules.js).
 *   --data   the spells JSON: either a `{ spells: [...] }` wrapper or a bare array.
 *   --levels also check L1/10/25/32/40/50 (default: L50 only).
 *
 * Exit 0 = 100% parity. Exit 1 = mismatches (first 40 printed). Exit 2 = setup problem.
 *
 * LAST RUN: 2026-09-03, reference @ its commit of that date, spells.json md5
 * fee399f2bd318acc9575471d4e2681db - 6,754,326 verdicts across 6 levels, 0 mismatches.
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

async function main() {
  const refDir = arg('--ref');
  const dataPath = arg('--data');
  if (!refDir || !dataPath) {
    console.error('need --ref <dir with stacking.mjs> and --data <spells.json>. See the header.');
    process.exit(2);
  }
  const refUrl = pathToFileURL(path.join(refDir, 'stacking.mjs')).href;
  let ref;
  try {
    ref = await import(refUrl);
  } catch (e) {
    console.error(`could not import the reference engine at ${refUrl}:\n  ${e.message}`);
    process.exit(2);
  }
  const port = require('../src/shared/spellStackingEngine');

  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
  } catch (e) {
    console.error(`could not read ${dataPath}: ${e.message}`);
    process.exit(2);
  }
  const spells = Array.isArray(raw) ? raw : raw.spells;
  if (!Array.isArray(spells) || !spells.length) {
    console.error('no spells array in the data file');
    process.exit(2);
  }

  const levels = process.argv.includes('--levels') ? [1, 10, 25, 32, 40, 50] : [50];
  const refViews = spells.map((s) => ref.spellView(s));
  const portViews = spells.map((s) => port.spellView(s));

  let checked = 0;
  const mismatches = [];
  for (let a = 0; a < spells.length; a++) {
    for (let b = 0; b < spells.length; b++) {
      for (const L of levels) {
        const r = ref.checkStackConflict(refViews[a], refViews[b], L, L);
        const p = port.checkStackConflict(portViews[a], portViews[b], L, L);
        checked++;
        if (r !== p) {
          mismatches.push({ a: spells[a].name, b: spells[b].name, L, ref: r, port: p });
        }
      }
    }
  }

  console.log(`checked ${checked.toLocaleString()} verdicts across ${levels.length} level(s)`);
  console.log(`mismatches: ${mismatches.length}`);
  for (const m of mismatches.slice(0, 40)) {
    console.log(`  L${m.L}  worn "${m.a}"  cast "${m.b}"  ref=${m.ref} port=${m.port}`);
  }
  if (mismatches.length > 40) console.log(`  ... and ${mismatches.length - 40} more`);
  process.exit(mismatches.length ? 1 : 0);
}

main();
