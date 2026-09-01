'use strict';
/**
 * SpellbookService: multi-file union (a multiclass character has one spellbook file per class it
 * has run `/outputfile spellbook` on) + the explicit file override ("Change spellbook file...").
 *
 * The class segment in the filename is never used to find or filter - the owner flagged not
 * knowing their class / wanting an auto-check-all approach; the match was already a wildcard, and
 * this makes it read every matching file rather than whichever readdirSync returned first.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const { SpellbookService } = require('../src/main/spellbookService');

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-sb-'));
  fs.writeFileSync(path.join(dir, 'Vaela_rivervale-SHM-Spellbook.txt'), '1\tTorpor\n2\tSpirit of Wolf\n3\tRegrowth');
  fs.writeFileSync(path.join(dir, 'Vaela_rivervale-CLR-Spellbook.txt'), '1\tComplete Heal\n2\tAegolism\n3\tTorpor');
  fs.writeFileSync(path.join(dir, 'Someone_else-WIZ-Spellbook.txt'), '1\tLure of Ice');
  return dir;
}

test('a name match reads EVERY <base>-*-Spellbook.txt and unions the spell lists', () => {
  const dir = fixture();
  try {
    const s = new SpellbookService();
    s.setInstallRoot(dir);
    s.setCharacterBaseName('Vaela_rivervale');
    // 3 SHM + 3 CLR, Torpor shared -> 5 unique
    assert.equal(s.getCount(), 5);
    assert.ok(s.has('Torpor') && s.has('Complete Heal') && s.has('Spirit of Wolf'));
    assert.ok(!s.has('Lure of Ice'), 'another character\'s spellbook must not leak in');
    assert.equal(s.getLoadedFiles().length, 2);
    assert.deepEqual(s.getLoadedFiles().map((f) => f.className).sort(), ['CLR', 'SHM']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('getExpectation reports mode and the loaded files, and drops the class from the pattern', () => {
  const dir = fixture();
  try {
    const s = new SpellbookService();
    s.setInstallRoot(dir);
    s.setCharacterBaseName('Vaela_rivervale');
    const e = s.getExpectation();
    assert.equal(e.mode, 'auto');
    assert.equal(e.files.length, 2);
    assert.doesNotMatch(e.fileNamePattern, /<CLASS>/, 'the uppercase <CLASS> token that reads as "you must know your class" is gone');
    assert.match(e.fileNamePattern, /^Vaela_rivervale-.*-Spellbook\.txt$/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a file override beats the typed name which beats the log-derived name', () => {
  const dir = fixture();
  try {
    const s = new SpellbookService();
    s.setInstallRoot(dir);
    s.setCharacterBaseName('Vaela_rivervale');   // auto
    assert.equal(s.getExpectation().mode, 'auto');

    s.setCharacterOverride('Someone_else');       // manual beats auto
    assert.equal(s.getExpectation().mode, 'manual');
    assert.ok(s.has('Lure of Ice') && !s.has('Torpor'));

    const clrOnly = path.join(dir, 'Vaela_rivervale-CLR-Spellbook.txt');
    s.setFileOverride(clrOnly);                    // file beats both
    assert.equal(s.getExpectation().mode, 'file');
    assert.equal(s.getLoadedFiles().length, 1);
    assert.ok(s.has('Complete Heal') && !s.has('Spirit of Wolf'), 'only the pinned CLR file should be loaded');

    s.setFileOverride(null);                       // cleared -> back to the manual name
    assert.equal(s.getExpectation().mode, 'manual');
    assert.ok(s.has('Lure of Ice'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a transient reload failure keeps the last known good spellbook, does not blank it', () => {
  // 31 Aug incident: the spellbook went dead after a restart and stayed dead all session because
  // the 30s poll re-read nothing (readdir under an AV lock) and _load blanked the set every time.
  const dir = fixture();
  try {
    const s = new SpellbookService();
    s.setInstallRoot(dir);
    s.setCharacterBaseName('Vaela_rivervale');
    assert.equal(s.getCount(), 5, 'loaded to start');

    // simulate what the periodic poll does when _findFiles() transiently returns nothing
    s._load([]);
    assert.equal(s.getCount(), 5, 'a poll that read nothing must not blank the loaded book');

    // simulate an unreadable file (AV lock) - _readOne returns null for it
    s._load([path.join(dir, 'Vaela_rivervale-SHM-Spellbook.txt', 'not-a-real-path')]);
    assert.equal(s.getCount(), 5, 'an unreadable file must not blank the loaded book either');

    // once the poll reads a real file again, the book updates normally
    fs.writeFileSync(path.join(dir, 'Vaela_rivervale-SHM-Spellbook.txt'), '1\tTorpor\n2\tNew Spell');
    s._load(s._findFiles());
    assert.ok(s.has('New Spell'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a deliberate target change to nothing IS allowed to clear the spellbook', () => {
  const dir = fixture();
  try {
    const s = new SpellbookService();
    s.setInstallRoot(dir);
    s.setCharacterBaseName('Vaela_rivervale');
    assert.equal(s.getCount(), 5);
    // pinning a file that doesn't exist is a real choice - it must not fall back to the old book
    s.setFileOverride(path.join(dir, 'gone.txt'));
    assert.equal(s.getCount(), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the reload poll runs even when the first load came up empty (self-heals)', () => {
  const dir = fixture();
  try {
    const s = new SpellbookService();
    s.setInstallRoot(dir);
    s.setCharacterBaseName('Nobody_here'); // no matching file -> first load empty
    assert.equal(s.getCount(), 0);
    assert.ok(s.timer, 'the 30s reload timer must be running even after an empty first load');
    clearInterval(s.timer);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a file override pointing at a missing file loads nothing rather than silently falling back', () => {
  const dir = fixture();
  try {
    const s = new SpellbookService();
    s.setInstallRoot(dir);
    s.setCharacterBaseName('Vaela_rivervale');
    s.setFileOverride(path.join(dir, 'gone.txt'));
    assert.equal(s.getCount(), 0);
    assert.equal(s.getExpectation().mode, 'file');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('listCandidates enumerates every *-Spellbook.txt in the root with character + class + count', () => {
  const dir = fixture();
  try {
    const s = new SpellbookService();
    s.setInstallRoot(dir);
    const c = s.listCandidates();
    assert.equal(c.length, 3);
    const shm = c.find((x) => x.className === 'SHM');
    assert.equal(shm.character, 'Vaela_rivervale');
    assert.equal(shm.count, 3);
    assert.ok(c.some((x) => x.character === 'Someone_else' && x.className === 'WIZ'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('it is wired IPC -> preload', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('spellbook:listCandidates'/);
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('spellbook:setFileOverride'/);
  assert.match(read('src', 'main', 'main.js'), /loadJson\('spellbookFileOverride'/);
  assert.match(read('src', 'preload', 'preload-main.js'), /listSpellbookCandidates:/);
  assert.match(read('src', 'preload', 'preload-main.js'), /setSpellbookFileOverride:/);
});

test('P3 - the Setup card has an always-available file picker wired to the override IPC', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  const html = read('src', 'renderer', 'main-window', 'index.html');
  const js = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(html, /id="spellbook-file-select"/);
  assert.match(html, /id="spellbook-file-reset"/);
  // populated from the candidate list, its change pins the file, reset clears the pin
  assert.match(js, /listSpellbookCandidates\(\)\.then/);
  assert.match(js, /setSpellbookFileOverride\(spellbookFileSelectEl\.value\)/);
  assert.match(js, /setSpellbookFileOverride\(''\)/);
  // hidden only when there are genuinely no spellbook files at all
  assert.match(js, /if \(!candidates\.length\) \{[\s\S]{0,80}spellbookFileRowEl\.style\.display = 'none'/);
});

test('a pinned file that has gone missing is called out, not routed to the /outputfile hint', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const fn = js.match(/function renderSpellbookState\(state\) \{[\s\S]*?\n  \}/)[0];
  // the missing-pin branch fires on mode 'file' with no resolved filePath, and returns before the
  // generic "Not found - run /outputfile spellbook" block
  assert.match(fn, /state\.mode === 'file' && !state\.filePath/);
  const branchAt = fn.indexOf("state.mode === 'file' && !state.filePath");
  assert.ok(branchAt < fn.indexOf('Not found'), 'the missing-pin check must come before the generic not-found path');
  assert.ok(fn.slice(branchAt, fn.indexOf('Not found')).includes('return'), 'it must return, not fall through to the /outputfile hint');
  assert.match(fn, /pinned spellbook file is missing/i);
});

test('P1 - the hint never shows a bare "<class>" placeholder the user cannot fill in', () => {
  const js = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'main-window', 'main-window.js'), 'utf8');
  const code = js.replace(/^\s*\/\/.*$/gm, '');
  // the wildcard segment is softened before display
  assert.match(code, /replace\('-<class>-', '-\(any class\)-'\)/);
  assert.doesNotMatch(code, /Looking for: \$\{state\.fileNamePattern\}/, 'the raw pattern with <class> was shown verbatim');
});

module.exports = () => report('spellbook-multi-file');
if (require.main === module) report('spellbook-multi-file').then((n) => process.exit(n ? 1 : 0));
