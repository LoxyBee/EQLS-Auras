'use strict';
/**
 * The eqicon:// and eqsound:// custom protocol handlers build a filesystem path from a URL a
 * renderer fully controls (an <img>/<audio> src). Before the guards below, a "../.." in the icon
 * set name walked out of the cache folder (an arbitrary .png write), and a poisoned registry.json
 * from an imported config bundle could point eqsound:// at any file (a read).
 *
 * Checked as source text - protocol.handle needs Electron, and a check that runs on every commit
 * in plain Node is worth more than a richer one that never runs. The shapes asserted here are the
 * exact lines that close each hole; removing one fails this.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');

const read = (...p) => fs.readFileSync(path.join(__dirname, '..', 'src', 'main', ...p), 'utf8');

test('eqicon:// constrains the icon set to the known list and the id to digits', () => {
  const src = read('iconService.js');
  const handler = src.slice(src.indexOf("protocol.handle('eqicon'"), src.indexOf('registerProtocol') + 4000);
  // the set must be a member of ICON_SETS, not sanitised
  assert.match(handler, /ICON_SETS\.includes\(iconSet\)/, 'the icon set is not checked against the known list');
  assert.match(handler, /\/\^\[0-9\]\+\$\/\.test\(iconId\)/, 'the icon id is not constrained to digits');
  // and a resolved-path assertion as the backstop
  assert.match(handler, /path\.resolve\(cachedPath\) !== path\.join\(path\.resolve\(this\.cacheDir\)/, 'no resolved-path containment check');
  // a rejection is a 404, not a throw or a sanitise-and-continue
  assert.match(handler, /return new Response\(null, \{ status: 404 \}\);/);
});

test('eqsound:// rejects a non-uuid id and a fileName that is not a plain basename', () => {
  const src = read('soundService.js');
  const handler = src.slice(src.indexOf("protocol.handle('eqsound'"), src.indexOf("protocol.handle('eqsound'") + 3000);
  assert.match(handler, /\/\^\[a-fA-F0-9-\]\+\$\/\.test\(id\)/, 'the id is used as a registry key without a shape check');
  assert.match(handler, /info\.fileName !== path\.basename\(info\.fileName\)/, 'a traversal fileName from a poisoned registry is not rejected');
  assert.match(handler, /path\.resolve\(filePath\) !== path\.join\(path\.resolve\(soundsDir\(\)\)/, 'no resolved-path containment check');
});

test('the icon set list is the single source of truth, imported not re-listed', () => {
  const src = read('iconService.js');
  assert.match(src, /ICON_SETS[^=]*\} = require\('\.\/iconExtractor'\)/, 'ICON_SETS should come from iconExtractor, not be a second copy that can drift');
});

module.exports = () => report('protocol-path-safety');
if (require.main === module) report('protocol-path-safety').then((n) => process.exit(n ? 1 : 0));
