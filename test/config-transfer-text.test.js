'use strict';
/**
 * Copy/paste config as text - the clipboard counterpart to Export/Import config. Same portable
 * scope as exportConfig/importConfig, but JSON-only (no sounds/customSounds - those are files,
 * not text) and inlined as one string instead of a folder, so it can go on the clipboard and
 * paste straight into another running copy of the app with no file picker involved.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const ct = require('../src/main/configTransfer');

function makeUserData() {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-cfg-text-'));
  fs.writeFileSync(path.join(ud, 'widgets.json'), '["aura"]');
  fs.writeFileSync(path.join(ud, 'profiles.json'), '{"a":1}');
  fs.writeFileSync(path.join(ud, 'config.json'), '{"eqFolder":"C:/this-machine"}'); // machine path
  fs.mkdirSync(path.join(ud, 'customSounds'));
  fs.writeFileSync(path.join(ud, 'customSounds', 'registry.json'), '{}');
  return ud;
}

test('exportConfigText carries the portable JSON, not machine files or sound folders', () => {
  const ud = makeUserData();
  try {
    const r = ct.exportConfigText(ud);
    assert.equal(r.ok, true);
    const bundle = JSON.parse(r.text);
    assert.equal(bundle.kind, 'eqls-config-text');
    assert.deepEqual(bundle.data['widgets.json'], ['aura']);
    assert.deepEqual(bundle.data['profiles.json'], { a: 1 });
    assert.ok(!('config.json' in bundle.data), 'the EQ install path leaked into the text bundle');
    assert.ok(!('customSounds' in bundle.data), 'a folder ended up in the JSON-only text bundle');
    assert.equal(r.items, 2);
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('importConfigText replaces the config and takes a safety backup first', () => {
  const ud = makeUserData();
  try {
    const text = ct.exportConfigText(ud).text;
    fs.writeFileSync(path.join(ud, 'widgets.json'), '["changed-since"]');
    fs.writeFileSync(path.join(ud, 'config.json'), '{"eqFolder":"C:/still-mine"}');

    const r = ct.importConfigText(ud, text);
    assert.equal(r.ok, true);
    assert.equal(r.restart, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ud, 'widgets.json'), 'utf8')), ['aura']);
    assert.equal(fs.readFileSync(path.join(ud, 'config.json'), 'utf8'), '{"eqFolder":"C:/still-mine"}', 'import touched the machine config');
    assert.ok(fs.existsSync(r.backedUpTo), 'no safety backup taken');
    assert.equal(fs.readFileSync(path.join(r.backedUpTo, 'widgets.json'), 'utf8'), '["changed-since"]');
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('importConfigText refuses garbage text', () => {
  const ud = makeUserData();
  try {
    assert.equal(ct.importConfigText(ud, 'not json').ok, false);
    assert.equal(ct.importConfigText(ud, '{"kind":"something-else","data":{}}').ok, false);
    assert.equal(ct.importConfigText(ud, '{"kind":"eqls-config-text","data":{}}').ok, false, 'empty data should be refused');
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('importConfigText will not write an excluded machine-specific file even if present in the text', () => {
  const ud = makeUserData();
  try {
    const bundle = { kind: 'eqls-config-text', data: { 'widgets.json': ['from-text'], 'config.json': { eqFolder: 'C:/attacker' } } };
    const r = ct.importConfigText(ud, JSON.stringify(bundle));
    assert.equal(r.ok, true);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(ud, 'widgets.json'), 'utf8')), ['from-text']);
    assert.equal(fs.readFileSync(path.join(ud, 'config.json'), 'utf8'), '{"eqFolder":"C:/this-machine"}', 'an excluded file was overwritten from pasted text');
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('importConfigText ignores path-escaping and wrong-case names from pasted text', () => {
  const ud = makeUserData();
  const outside = path.join(path.dirname(ud), `eq-escape-${path.basename(ud)}.json`);
  try {
    const bundle = {
      kind: 'eqls-config-text',
      data: {
        'widgets.json': ['ok'],
        [`..${path.sep}${path.basename(outside)}`]: { pwned: true },
        '../escape2.json': { pwned: true },
        'Config.json': { eqFolder: 'C:/attacker' },
      },
    };
    const r = ct.importConfigText(ud, JSON.stringify(bundle));
    assert.equal(r.ok, true);
    assert.equal(r.items, 1, 'only the one safe file should have been written');
    assert.ok(!fs.existsSync(outside), 'a pasted key wrote a file outside userData');
    assert.equal(fs.readFileSync(path.join(ud, 'config.json'), 'utf8'), '{"eqFolder":"C:/this-machine"}', 'deny-list was bypassed by letter case');
  } finally {
    fs.rmSync(ud, { recursive: true, force: true });
    fs.rmSync(outside, { force: true });
  }
});

test('it is wired end to end', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('config:exportText'/);
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('config:importText'/);
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('config:openBackupsFolder'/);
  assert.match(read('src', 'preload', 'preload-main.js'), /exportConfigText:/);
  assert.match(read('src', 'preload', 'preload-main.js'), /importConfigText:/);
  assert.match(read('src', 'preload', 'preload-main.js'), /openBackupsFolder:/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="copy-config-text-btn"/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="paste-config-text-btn"/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="open-backups-folder-btn"/);
  assert.match(read('src', 'renderer', 'main-window', 'main-window.js'), /window\.eqTracker\.exportConfigText\(\)/);
  assert.match(read('src', 'renderer', 'main-window', 'main-window.js'), /window\.eqTracker\.importConfigText\(text\)/);
});

module.exports = () => report('config-transfer-text');
if (require.main === module) report('config-transfer-text').then((n) => process.exit(n ? 1 : 0));
