'use strict';
/**
 * The spellbook status message.
 *
 * This is a small change guarding an expensive discovery. The app's strongest tool for deciding
 * whether an ambiguous buff message belongs to the player is their own spellbook file - EverQuest
 * reuses the same wording across many spells, and knowing which of them this character actually
 * has is usually what separates "yours" from "a groupmate's". When that file is absent the app
 * cannot narrow anything, so it ignores those landings.
 *
 * On the machine this was written on the file has never existed, across eight logged sessions and
 * 1.6 million lines. Replaying one session showed over 700 ambiguous landings discarded with
 * "not your spellbook". And the settings window said, reassuringly and wrongly, that it would
 * "pick it up automatically once detected" - a sentence that guarantees nobody ever goes looking,
 * because it promises the problem is already solving itself.
 *
 * The lesson generalises past this one message, which is why it is worth a test rather than just
 * a fix: a diagnostic that says a missing thing will appear on its own is worse than one that
 * says nothing, because it converts a fixable problem into a wait.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test, report } = require('./harness');
const { SpellbookService } = require('../src/main/spellbookService');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');

const mainSrc = read('src', 'main', 'main.js');
const rendererSrc = read('src', 'renderer', 'main-window', 'main-window.js');
const html = read('src', 'renderer', 'main-window', 'index.html');
const css = read('src', 'renderer', 'main-window', 'main-window.css');

test('the service can say where it looked and what for', () => {
  const svc = new SpellbookService();
  const blank = svc.getExpectation();
  assert.equal(blank.folder, null, 'with no install root there is nowhere to point at');
  assert.equal(blank.fileNamePattern, null);

  svc.installRoot = 'C:/Games/EQ';
  svc.characterBaseName = 'Shara_rivervale';
  const known = svc.getExpectation();
  assert.equal(known.folder, 'C:/Games/EQ');
  assert.match(known.fileNamePattern, /^Shara_rivervale-.*Spellbook\.txt$/,
    'the pattern has to be recognisable as a real filename, or it helps nobody');
});

test('the expectation reaches the settings window', () => {
  assert.match(mainSrc, /\.\.\.spellbookService\.getExpectation\(\)/,
    'the state the window receives no longer carries where to look');
});

test('the missing message no longer promises the file will appear on its own', () => {
  // Comments stripped first: the code carries a note explaining WHY that sentence was removed, and
  // quoting it there is the opposite of shipping it. Same trick the drag-region test needed.
  const code = rendererSrc.replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(
    code, /pick it up automatically/,
    'this sentence is the whole reason the problem went unnoticed - it promises a wait, not a fix'
  );
  assert.doesNotMatch(html, /Auto-detected from your EQ install folder/,
    'the surrounding hint made the same promise');
});

test('the missing state says what to do about it, and what it costs', () => {
  const block = html.match(/<div id="spellbook-missing-hint"[\s\S]*?<\/div>/);
  assert.ok(block, 'there is no explanation shown when the file is missing');
  // The cost, or nobody acts on it.
  assert.match(block[0], /ignores them|thrown away/i, 'it does not say what is being lost');
  // The action, or knowing the cost is just bad news.
  assert.match(block[0], /does not write this file on its own/i, 'it does not say the file is manual');
  assert.match(block[0], /output-file command/i, 'it does not say how to create it');
  // And where, filled in at runtime from the real paths.
  assert.match(html, /id="spellbook-missing-where"/);
  assert.match(rendererSrc, /spellbookMissingWhereEl\.textContent = /);
});

test('the explanation is shown ONLY when the file is missing', () => {
  // A permanent warning is a warning nobody reads.
  assert.match(html, /id="spellbook-missing-hint" style="display:none"/, 'it starts visible');
  assert.match(rendererSrc, /spellbookMissingHintEl\.style\.display = 'none';/, 'it is never hidden again');
  assert.match(rendererSrc, /spellbookMissingHintEl\.style\.display = '';/, 'it is never shown');
  const fn = rendererSrc.match(/getSpellbookState\(\)\.then\(\(state\) => \{([\s\S]*?)\n  \}\);/);
  assert.ok(fn, 'the status handler has been restructured');
  assert.ok(
    fn[1].indexOf('state.filePath') < fn[1].indexOf('Not found'),
    'the found case must be handled first, or the warning shows even when all is well'
  );
});

test('the status reads as a warning rather than as an error or as nothing', () => {
  assert.match(rendererSrc, /spellbookStatusEl\.classList\.add\('warn'\)/);
  assert.match(rendererSrc, /spellbookStatusEl\.classList\.remove\('warn'\)/, 'it never clears again');
  assert.match(css, /\.warn \{/, 'the class has no styling, so nothing looks different');
});

module.exports = () => report('spellbook-diagnostic');
if (require.main === module) process.exit(report('spellbook-diagnostic') ? 1 : 0);
