'use strict';
/**
 * The Add Aura list - the built premades and the "Not built yet" roadmap below them.
 *
 * These are two separate arrays in the renderer, and building a premade means adding an entry to
 * one and remembering to remove it from the other. That was forgotten twice: "Buff timer" sat in
 * both lists from the day it was built, and "Debuff on an enemy" joined it. The Add Aura list
 * showed each of them twice - once working, once greyed out as unbuilt - which reads as the app
 * being broken rather than as a bookkeeping slip.
 *
 * renderPremadeList now filters the planned list by what has been built, so the app is right
 * either way. This suite is what stops the filter being deleted as redundant.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
// Line endings normalised on the way in. The repo is CRLF, and a pattern written with \n that
// silently never matches is the worst kind of test: it passes, and it proves nothing.
const rendererSrc = fs
  .readFileSync(path.join(ROOT, 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8')
  .replace(/\r\n/g, '\n');

// Pulls the name: strings out of one array literal without executing the renderer, which needs a
// DOM and an Electron bridge that do not exist here.
function namesIn(arrayName) {
  const start = rendererSrc.indexOf(`const ${arrayName} = [`);
  assert.notEqual(start, -1, `${arrayName} has been renamed or restructured`);
  // Scan to the matching close bracket rather than regex-ing to the first "];", which would stop
  // at any nested array inside an entry.
  let depth = 0;
  let end = -1;
  for (let i = rendererSrc.indexOf('[', start); i < rendererSrc.length; i += 1) {
    const c = rendererSrc[i];
    if (c === '[') depth += 1;
    else if (c === ']') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.notEqual(end, -1, `could not find the end of ${arrayName}`);
  const body = rendererSrc.slice(start, end);
  return [...body.matchAll(/^\s*name: '([^']+)',$/gm)].map((m) => m[1]);
}

// The text of each entry in one array literal, using the same bracket scan.
function entriesIn(arrayName) {
  const start = rendererSrc.indexOf(`const ${arrayName} = [`);
  assert.notEqual(start, -1, `${arrayName} has been renamed or restructured`);
  let depth = 0;
  let end = -1;
  for (let i = rendererSrc.indexOf('[', start); i < rendererSrc.length; i += 1) {
    if (rendererSrc[i] === '[') depth += 1;
    else if (rendererSrc[i] === ']') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  // Split on an entry-opening brace at the array's own indent, so a nested object inside an entry
  // does not read as a new entry.
  return rendererSrc.slice(start, end).split(/\n {4}\{\n/).slice(1);
}

test('both lists are found and neither is empty', () => {
  // If either lookup silently returned nothing, every check below would pass vacuously. namesIn
  // already asserts the array itself was found, so this is guarding against a bracket scan that
  // finds the array and then extracts no names from it.
  assert.ok(namesIn('PREMADE_WIDGETS').length >= 4, 'no built premades found');
  // Deliberately 1 and not a larger floor. The roadmap SHRINKS as things get built - Damage parser
  // and Travel guide both left it on 23 August, taking it from five entries to three - so any
  // number above one is a countdown to a test that fails for the good reason that the work got
  // done. If it ever reaches zero, delete this line rather than raising the floor: an empty
  // roadmap is a real state, and the vacuous-pass risk it guards is handled by namesIn's own
  // assertion that the array exists.
  assert.ok(namesIn('PLANNED_PREMADE_WIDGETS').length >= 1, 'no planned premades found');
});

test('nothing appears in both the built list and the roadmap', () => {
  const built = new Set(namesIn('PREMADE_WIDGETS'));
  const overlap = namesIn('PLANNED_PREMADE_WIDGETS').filter((n) => built.has(n));
  assert.deepEqual(
    overlap,
    [],
    `these are offered twice in Add Aura - once working, once as "Not built yet": ${overlap.join(', ')}`
  );
});

test('the roadmap is filtered by what has been built', () => {
  // Belt and braces for the check above: even if someone adds an overlapping entry without
  // running the tests, the list on screen must not show it twice.
  assert.match(rendererSrc, /const builtNames = new Set\(PREMADE_WIDGETS\.map\(\(p\) => p\.name\)\);/);
  assert.match(rendererSrc, /PLANNED_PREMADE_WIDGETS\.filter\(\(p\) => !builtNames\.has\(p\.name\)\)/);
});

test('no premade name is duplicated within its own list', () => {
  for (const arrayName of ['PREMADE_WIDGETS', 'PLANNED_PREMADE_WIDGETS']) {
    const names = namesIn(arrayName);
    const dupes = names.filter((n, i) => names.indexOf(n) !== i);
    assert.deepEqual(dupes, [], `${arrayName} lists ${dupes.join(', ')} more than once`);
  }
});

test('every roadmap entry says it is not built', () => {
  // The greyed-out styling carries the meaning on screen; the words have to carry it too, or a
  // roadmap entry reads as a feature that is simply not working.
  const entries = entriesIn('PLANNED_PREMADE_WIDGETS');
  // Same reasoning as the floor above - the roadmap shrinks as the roadmap gets built.
  assert.ok(entries.length >= 1, `only split the roadmap into ${entries.length} entries`);
  assert.equal(
    entries.length,
    namesIn('PLANNED_PREMADE_WIDGETS').length,
    'the split does not line up with the names - one entry per name, or this proves nothing'
  );
  for (const entry of entries) {
    const name = (entry.match(/name: '([^']+)'/) || [])[1] || '(unnamed)';
    assert.match(entry, /not built yet|Not built yet/, `roadmap entry "${name}" does not say it is unbuilt`);
  }
});

module.exports = () => report('premade-list');
if (require.main === module) process.exit(report('premade-list') ? 1 : 0);
