'use strict';
/**
 * Runs every *.test.js under test/ and tools/ in one go:  npm test
 *
 * Each suite runs in its own child process so one crashing suite cannot take the rest with it,
 * and so a suite that leaves module-level state behind cannot poison its neighbours.
 */

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const SEARCH = [path.join(ROOT, 'test'), path.join(ROOT, 'tools')];

function findSuites(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) findSuites(p, out);
    else if (e.name.endsWith('.test.js')) out.push(p);
  }
  return out;
}

const suites = SEARCH.flatMap((d) => findSuites(d)).sort();
if (!suites.length) {
  console.log('no test suites found');
  process.exit(0);
}

let failed = 0;
for (const suite of suites) {
  const rel = path.relative(ROOT, suite).replace(/\\/g, '/');
  console.log(`\n=== ${rel} ===`);
  const r = spawnSync(process.execPath, [suite], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log('\n' + '='.repeat(60));
if (failed) {
  console.log(`${failed} of ${suites.length} suites FAILED`);
  console.log('Nothing here needs a framework - read the failure text, it says what broke and why.');
  process.exit(1);
}
console.log(`all ${suites.length} suites passed`);
