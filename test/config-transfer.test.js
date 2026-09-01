'use strict';
/**
 * Config export / import bundle - backlog #3c (the full version of #3).
 *
 * Offline, local files only. A bundle is a FOLDER under userData/exports/ holding the portable
 * config (all the .json except a machine-specific deny-list, plus customSounds/ and sounds/).
 * Import replaces the current config with a bundle after taking a safety backup, and the app
 * restarts. A bundle from "Back up now" (userData/backups/) can be imported too.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');
const ct = require('../src/main/configTransfer');

function makeUserData() {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-cfg-'));
  fs.writeFileSync(path.join(ud, 'widgets.json'), '["aura"]');
  fs.writeFileSync(path.join(ud, 'profiles.json'), '{"a":1}');
  fs.writeFileSync(path.join(ud, 'characterSettings.json'), '{"aa":3}');
  fs.writeFileSync(path.join(ud, 'config.json'), '{"eqFolder":"C:/this-machine"}'); // machine path
  fs.writeFileSync(path.join(ud, 'mainWindowBounds.json'), '{"x":10}');              // this screen
  fs.writeFileSync(path.join(ud, 'currentlyMemorized.json'), '[]');                  // live state
  fs.mkdirSync(path.join(ud, 'customSounds'));
  fs.writeFileSync(path.join(ud, 'customSounds', 'registry.json'), '{}');
  fs.mkdirSync(path.join(ud, 'modules'));
  fs.writeFileSync(path.join(ud, 'modules', 'pull-timer.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(ud, 'moduleSettings.json'), '{"pull-timer":{"seconds":20}}');
  fs.mkdirSync(path.join(ud, 'detection-logs'));
  fs.writeFileSync(path.join(ud, 'detection-logs', 'x.log'), 'x');
  return ud;
}

test('export carries the portable config, not machine-specific or live-state files', () => {
  const ud = makeUserData();
  try {
    const r = ct.exportConfig(ud);
    assert.equal(r.ok, true);
    const got = fs.readdirSync(r.path).sort();
    assert.ok(got.includes('widgets.json') && got.includes('profiles.json') && got.includes('characterSettings.json'));
    assert.ok(got.includes('customSounds'));
    assert.ok(got.includes('modules'), 'drop-in modules should travel with a config export');
    assert.ok(got.includes('moduleSettings.json'), 'module settings should travel');
    assert.ok(!got.includes('config.json'), 'the EQ install path leaked into the bundle');
    assert.ok(!got.includes('mainWindowBounds.json'), 'this screen\'s window bounds leaked');
    assert.ok(!got.includes('currentlyMemorized.json'), 'live gem state leaked');
    assert.ok(!got.includes('detection-logs'), 'the logs folder leaked');
    assert.ok(got.includes('eqls-bundle.json'), 'no bundle marker written');
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('listImportable finds export bundles and backup folders, newest first', () => {
  const ud = makeUserData();
  try {
    ct.exportConfig(ud);
    const backup = path.join(ud, 'backups', 'backup-old');
    fs.mkdirSync(backup, { recursive: true });
    fs.writeFileSync(path.join(backup, 'widgets.json'), '["from-backup"]');
    fs.mkdirSync(path.join(ud, 'backups', 'junk')); // no widgets/profiles -> not offered

    const list = ct.listImportable(ud);
    assert.ok(list.some((b) => b.group === 'export'));
    assert.ok(list.some((b) => b.group === 'backup' && b.name === 'backup-old'));
    assert.ok(!list.some((b) => b.name === 'junk'), 'an empty folder was offered');
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('import replaces the config, backs up the old one, and leaves machine files alone', () => {
  const ud = makeUserData();
  try {
    const bundle = ct.exportConfig(ud).path;
    // change the live config after exporting
    fs.writeFileSync(path.join(ud, 'widgets.json'), '["changed-since"]');
    fs.writeFileSync(path.join(ud, 'config.json'), '{"eqFolder":"C:/still-mine"}');

    const r = ct.importConfig(ud, bundle);
    assert.equal(r.ok, true);
    assert.equal(r.restart, true);
    assert.equal(fs.readFileSync(path.join(ud, 'widgets.json'), 'utf8'), '["aura"]', 'the bundle did not overwrite widgets');
    assert.equal(fs.readFileSync(path.join(ud, 'config.json'), 'utf8'), '{"eqFolder":"C:/still-mine"}', 'import touched the machine config');
    assert.ok(fs.existsSync(r.backedUpTo), 'no safety backup taken');
    assert.equal(fs.readFileSync(path.join(r.backedUpTo, 'widgets.json'), 'utf8'), '["changed-since"]', 'the safety backup did not capture the pre-import state');
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('import refuses a folder with no config in it', () => {
  const ud = makeUserData();
  try {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'empty-'));
    const r = ct.importConfig(ud, empty);
    assert.equal(r.ok, false);
    fs.rmSync(empty, { recursive: true, force: true });
  } finally { fs.rmSync(ud, { recursive: true, force: true }); }
});

test('it is wired end to end', () => {
  const read = (...p) => fs.readFileSync(path.join(__dirname, '..', ...p), 'utf8');
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('config:export'/);
  assert.match(read('src', 'main', 'main.js'), /ipcMain\.handle\('config:import'/);
  assert.match(read('src', 'preload', 'preload-main.js'), /exportConfig:/);
  assert.match(read('src', 'preload', 'preload-main.js'), /importConfig:/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="export-config-btn"/);
  assert.match(read('src', 'renderer', 'main-window', 'main-window.js'), /window\.eqTracker\.importConfig\(picked\[0\]\)/);
});

module.exports = () => report('config-transfer');
if (require.main === module) report('config-transfer').then((n) => process.exit(n ? 1 : 0));
