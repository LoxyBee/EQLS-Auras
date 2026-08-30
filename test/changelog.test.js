'use strict';
/**
 * The in-app changelog - backlog #18.
 *
 * A data file (src/shared/data/changelog.js) the Documentation session maintains, rendered on the
 * About page. Newest entry first; each entry is { version, date, new[], fixes[] }.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { CHANGELOG } = require('../src/shared/data/changelog');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

test('every entry has the expected shape', () => {
  assert.ok(Array.isArray(CHANGELOG) && CHANGELOG.length >= 1, 'the changelog is empty');
  for (const e of CHANGELOG) {
    assert.equal(typeof e.version, 'string');
    assert.ok(e.version.length > 0);
    assert.ok(e.date === null || /^\d{4}-\d{2}-\d{2}$/.test(e.date), `bad date on ${e.version}`);
    assert.ok(Array.isArray(e.new) && Array.isArray(e.fixes), `${e.version} is missing new/fixes`);
    for (const line of [...e.new, ...e.fixes]) {
      assert.equal(typeof line, 'string');
      assert.ok(line.trim().length > 0, 'blank changelog line');
    }
  }
});

test('at most one Unreleased entry, and it is at the top', () => {
  const idx = CHANGELOG.map((e) => e.version).indexOf('Unreleased');
  const count = CHANGELOG.filter((e) => e.version === 'Unreleased').length;
  assert.ok(count <= 1, 'more than one Unreleased entry');
  if (count === 1) assert.equal(idx, 0, 'Unreleased must be first');
});

test('it is wired end to end', () => {
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('app:getChangelog'/);
  assert.match(read('src', 'preload', 'preload-main.js'), /getChangelog:/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="changelog-body"/);
  const js = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(js, /function initChangelog\(\)/);
  assert.match(js, /initChangelog\(\);/);
  // Rendered via textContent, never innerHTML - a changelog line is plain text.
  const fn = js.slice(js.indexOf('function initChangelog()'), js.indexOf('function initChangelog()') + 1400);
  assert.doesNotMatch(fn, /innerHTML/, 'the changelog renderer uses innerHTML');
});

module.exports = () => report('changelog');
if (require.main === module) report('changelog').then((n) => process.exit(n ? 1 : 0));
