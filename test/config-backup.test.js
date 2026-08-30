'use strict';
/**
 * "Back up now" - QOL #3b (the middle stepping stone of #3).
 *
 * Copies the userData folder into a dated subfolder of itself, so there is a snapshot to fall
 * back to before an update or a big change. Skips the Electron/Chromium cache dirs, the detection
 * logs, and the backups folder itself. Walks the top-level children one at a time rather than
 * fs.cpSync on the whole tree, specifically so the destination being inside the source is never a
 * problem.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');
const mainSrc = read('src', 'main', 'main.js');

// The handler body, pulled out so the copy walk can be exercised against a fake userData tree.
function loadBackupWalk() {
  const m = mainSrc.match(/ipcMain\.handle\('app:backupConfig', \(\) => \{([\s\S]*?)\n\}\);/);
  assert.ok(m, 'the app:backupConfig handler has been renamed or restructured');
  const body = m[1].replace(/app\.getPath\('userData'\)/g, 'USERDATA');
  // eslint-disable-next-line no-new-func
  const fn = new Function('USERDATA', 'fs', 'path', body);
  return (userdata) => fn(userdata, fs, path);
}

test('the backup copies config, skips caches and logs, and does not recurse into itself', () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'ud-'));
  try {
    fs.writeFileSync(path.join(ud, 'widgets.json'), '[]');
    fs.writeFileSync(path.join(ud, 'profiles.json'), '{}');
    fs.mkdirSync(path.join(ud, 'customSounds'));
    fs.writeFileSync(path.join(ud, 'customSounds', 'registry.json'), '{}');
    fs.mkdirSync(path.join(ud, 'detection-logs'));
    fs.writeFileSync(path.join(ud, 'detection-logs', 'x.log'), 'x'.repeat(500));
    fs.mkdirSync(path.join(ud, 'Cache'));
    fs.mkdirSync(path.join(ud, 'backups'));
    fs.writeFileSync(path.join(ud, 'backups', 'old.txt'), 'prior backup');

    const run = loadBackupWalk();
    const r = run(ud);

    assert.equal(r.ok, true);
    assert.ok(r.path.includes('backups'), 'the backup did not land under backups/');
    const got = fs.readdirSync(r.path).sort();
    assert.deepEqual(got, ['customSounds', 'profiles.json', 'widgets.json'],
      'wrong set copied (caches / logs / backups should all be skipped)');
    assert.deepEqual(fs.readdirSync(path.join(r.path, 'customSounds')), ['registry.json']);
    assert.equal(r.items, 3);

    // A second run must not blow up on the first backup now sitting in backups/ (the walk skips
    // 'backups' entirely, so the copy never sees itself).
    const r2 = run(ud);
    assert.equal(r2.ok, true);
  } finally {
    fs.rmSync(ud, { recursive: true, force: true });
  }
});

test('it is wired end to end', () => {
  assert.match(mainSrc, /ipcMain\.handle\('app:backupConfig'/);
  assert.match(read('src', 'preload', 'preload-main.js'), /backupConfig:/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="backup-config-btn"/);
  assert.match(read('src', 'renderer', 'main-window', 'main-window.js'), /window\.eqTracker\.backupConfig\(\)/);
});

module.exports = () => report('config-backup');
if (require.main === module) report('config-backup').then((n) => process.exit(n ? 1 : 0));
