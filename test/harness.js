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
// Promises from async test(...) calls, awaited by report() before it counts anything. Without
// this, an `async () => {...}` test function returns a Promise immediately, test() saw no
// synchronous throw and reported "ok" on the spot, and the assertions inside - which only run
// after the first `await` - were never actually checked by anything. Confirmed as a real,
// currently-live gap: focus-game.test.js and foreground-watcher.test.js both use async test
// functions today, and every one of them was passing regardless of what was inside.
const pending = [];

function test(name, fn) {
  let result;
  try {
    result = fn();
  } catch (err) {
    results.push({ name, ok: false, err });
    console.log(`  FAIL ${name}`);
    for (const line of String(err && err.message).split('\n')) console.log(`       ${line}`);
    return;
  }
  if (result && typeof result.then === 'function') {
    // Reserve this test's place in `results` now (so ordering matches registration order even
    // though the console line for an async test prints later, once it actually settles), and
    // let report() know to wait for it.
    const entry = { name, ok: null };
    results.push(entry);
    pending.push(
      result.then(
        () => {
          entry.ok = true;
          console.log(`  ok   ${name}`);
        },
        (err) => {
          entry.ok = false;
          entry.err = err;
          console.log(`  FAIL ${name}`);
          for (const line of String(err && err.message).split('\n')) console.log(`       ${line}`);
        }
      )
    );
    return;
  }
  results.push({ name, ok: true });
  console.log(`  ok   ${name}`);
}

/** Skip with a visible reason, so a silently-absent test never reads as a passing one. */
function skip(name, why) {
  results.push({ name, skipped: true });
  console.log(`  skip ${name} - ${why}`);
}

// Async now (was sync) - every caller needs to await it (or .then it) rather than treating its
// return value as the failure count directly. See test/run.js's own convention: every suite's
// trailing `if (require.main === module) report(label).then((n) => process.exit(n ? 1 : 0));`.
async function report(label) {
  await Promise.all(pending);
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
