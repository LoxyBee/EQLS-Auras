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
  svc.characterBaseName = 'Vaela_rivervale';
  const known = svc.getExpectation();
  assert.equal(known.folder, 'C:/Games/EQ');
  assert.match(known.fileNamePattern, /^Vaela_rivervale-.*Spellbook\.txt$/,
    'the pattern has to be recognisable as a real filename, or it helps nobody');
});

test('QOL #14 - a manually entered character overrides the log-derived one', () => {
  const os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-sb-'));
  try {
    fs.writeFileSync(path.join(dir, 'Auto_bertox-WIZ-Spellbook.txt'), '1\tFire');
    fs.writeFileSync(path.join(dir, 'Manual_povar-SHM-Spellbook.txt'), '1\tHaste\n2\tRegen');
    const svc = new SpellbookService();
    svc.setInstallRoot(dir);
    svc.setCharacterBaseName('Auto_bertox');
    assert.ok(svc.getFilePath().endsWith('Auto_bertox-WIZ-Spellbook.txt'), 'the log-derived name should win when no override is set');
    assert.equal(svc.getExpectation().manualCharacter, false);

    svc.setCharacterOverride('Manual_povar');
    assert.ok(svc.getFilePath().endsWith('Manual_povar-SHM-Spellbook.txt'), 'the override must take priority');
    assert.equal(svc.getCount(), 2);
    assert.equal(svc.getExpectation().manualCharacter, true);

    svc.setCharacterOverride('');
    assert.ok(svc.getFilePath().endsWith('Auto_bertox-WIZ-Spellbook.txt'), 'clearing the override falls back to the log-derived name');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('QOL #14 - it is wired end to end', () => {
  assert.match(mainSrc, /ipcMain\.handle\('spellbook:setCharacter'/);
  assert.match(mainSrc, /spellbookService\.setCharacterOverride\(/);
  assert.match(mainSrc, /saveJson\('spellbookCharacter'/);
  assert.match(read('src', 'preload', 'preload-main.js'), /setSpellbookCharacter:/);
  assert.match(html, /id="spellbook-char-name"/);
  assert.match(rendererSrc, /setSpellbookCharacter\(spellbookCharNameEl\.value, spellbookCharServerEl\.value\)/);
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
  // The command row moved out from under a hidden-until-missing wrapper (it's always visible now,
  // see the next test) - the cost/action explanation lives in the static title= on the hint
  // paragraph that precedes it, plus the dynamic "worth fixing" wording set for the missing case.
  const block = html.match(/<p class="hint" id="spellbook-command-hint"[\s\S]*?<\/p>/);
  assert.ok(block, 'there is no explanation attached to the spellbook command');
  // The cost, or nobody acts on it.
  assert.match(block[0], /ignores them|thrown away/i, 'it does not say what is being lost');
  // The action, or knowing the cost is just bad news.
  assert.match(block[0], /does not write this file on its own/i, 'it does not say the file is manual');
  assert.match(rendererSrc, /This is worth fixing\.<\/strong> Run this in game to generate/,
    'the missing-file case no longer says it is worth fixing');
  // The command itself, named exactly, because "your client's output-file command" is the sort of
  // phrase that leaves someone still guessing. Vaela supplied it.
  assert.match(html, /<code id="spellbook-command">\/outputfile spellbook<\/code>/,
    'the exact command is not shown');
  assert.match(rendererSrc, /copySpellbookCommandBtn\.addEventListener/, 'there is no copy button');
  // Copied from the element, so the button cannot drift from what is on screen.
  assert.match(rendererSrc, /writeText\(spellbookCommandEl\.textContent\.trim\(\)\)/,
    'the button copies its own copy of the string rather than the one displayed');
  // And where, filled in at runtime from the real paths.
  assert.match(html, /id="spellbook-missing-where"/);
  assert.match(rendererSrc, /spellbookMissingWhereEl\.textContent = /);
});

test('the command stays reachable once the spellbook is found, not just while it is missing', () => {
  // Reported live: the copy button vanished entirely once detection succeeded, even though the
  // game does not write this file on its own and it goes stale on every new scribed spell - "A
  // permanent warning is a warning nobody reads" (this test's old title) argued for hiding it
  // outright, which threw out the command along with the warning styling. The fix keeps the
  // command always visible and only toggles the WARNING styling + wording.
  assert.doesNotMatch(html, /id="spellbook-command-hint"[^>]*style="display:none"/,
    'the command row is hidden again - it must stay reachable after detection succeeds');
  assert.doesNotMatch(html, /<div id="spellbook-missing-hint"/, 'the old hidden-until-missing wrapper is back');
  assert.match(rendererSrc, /spellbookCommandHintEl\.classList\.add\('warn-hint'\)/, 'the missing case never applies the warning style');
  assert.match(rendererSrc, /spellbookCommandHintEl\.classList\.remove\('warn-hint'\)/, 'the found case never clears the warning style');
  assert.match(rendererSrc, /Re-run this in game whenever you scribe a new spell/, 'the found case has no reason to run the command again');
  const fn = rendererSrc.match(/function renderSpellbookState\(state\) \{([\s\S]*?)\n  \}/);
  assert.ok(fn, 'the status renderer has been renamed or restructured');
  assert.ok(
    fn[1].indexOf('state.filePath') < fn[1].indexOf('Not found'),
    'the found case must be handled first, or the warning shows even when all is well'
  );
  // renderSpellbook = renderSpellbookState (status/hints) + renderSpellbookFilePicker (the P3
  // picker). The picker rebuild reads every spellbook file off disk, so it is deliberately NOT on
  // renderSpellbookState, which fires on each debounced keystroke in the Character fields.
  assert.match(rendererSrc, /getSpellbookState\(\)\.then\(renderSpellbook\)/);
  assert.match(rendererSrc, /setSpellbookCharacter\([^)]*\)\s*\.then\(renderSpellbookState\)/, 'typing a character name must not trigger the disk-scanning picker rebuild');
});

test('the status reads as a warning rather than as an error or as nothing', () => {
  assert.match(rendererSrc, /spellbookStatusEl\.classList\.add\('warn'\)/);
  assert.match(rendererSrc, /spellbookStatusEl\.classList\.remove\('warn'\)/, 'it never clears again');
  assert.match(css, /\.warn \{/, 'the class has no styling, so nothing looks different');
});

module.exports = () => report('spellbook-diagnostic');
if (require.main === module) report('spellbook-diagnostic').then((n) => process.exit(n ? 1 : 0));
