'use strict';
/**
 * The smallest thing that can be called a test runner.
 *
 * No framework, on purpose. This project has no runtime dependencies and no dev dependencies
 * beyond electron and electron-builder, and a test runner is not worth being the first crack in
 * that. Node's own `assert` plus twenty lines of bookkeeping does everything needed here.
 *
 * Every test file requires this, registers cases with test(), and ends with report().
 */

const results = [];

function test(name, fn) {
  try {
    fn();
    results.push({ name, ok: true });
    console.log(`  ok   ${name}`);
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  FAIL ${name}`);
    for (const line of String(err && err.message).split('\n')) console.log(`       ${line}`);
  }
}

/** Skip with a visible reason, so a silently-absent test never reads as a passing one. */
function skip(name, why) {
  results.push({ name, skipped: true });
  console.log(`  skip ${name} - ${why}`);
}

function report(label) {
  const failed = results.filter((r) => !r.ok && !r.skipped);
  const skipped = results.filter((r) => r.skipped);
  const passed = results.filter((r) => r.ok);
  console.log(
    `\n${label}: ${passed.length} passed` +
    (failed.length ? `, ${failed.length} FAILED` : '') +
    (skipped.length ? `, ${skipped.length} skipped` : '')
  );
  return failed.length;
}

module.exports = { test, skip, report };
