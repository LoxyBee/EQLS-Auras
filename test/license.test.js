'use strict';
/**
 * The app is distributed to other people, so it must state a license. MIT was chosen 1 Sep.
 * This guards against the three ways that silently regresses: the LICENSE file going missing,
 * package.json's `license` field drifting, and the two falling out of sync.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

test('a LICENSE file exists and is the MIT text with a copyright holder', () => {
  const p = path.join(ROOT, 'LICENSE');
  assert.ok(fs.existsSync(p), 'LICENSE file is missing - the app ships to other people');
  const text = fs.readFileSync(p, 'utf8');
  assert.match(text, /^MIT License/, 'LICENSE is not the MIT license');
  assert.match(text, /Copyright \(c\) \d{4} \S+/, 'MIT text needs a "Copyright (c) <year> <holder>" line');
  assert.match(text, /THE SOFTWARE IS PROVIDED "AS IS"/, 'the MIT warranty disclaimer is missing');
});

test('package.json declares the same license and ships the file in the installer', () => {
  assert.equal(pkg.license, 'MIT', 'package.json license field disagrees with the LICENSE file');
  assert.ok(typeof pkg.author === 'string' && pkg.author.trim(), 'package.json needs an author (installer metadata)');
  assert.ok(
    pkg.build.files.includes('LICENSE'),
    'LICENSE is not in build.files - the MIT text must ship with the app, "included in all copies"',
  );
});

module.exports = () => report('license');
if (require.main === module) report('license').then((n) => process.exit(n ? 1 : 0));
