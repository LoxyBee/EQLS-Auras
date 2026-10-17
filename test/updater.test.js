'use strict';
/**
 * Opt-in auto-update (owner, 16 Oct) - src/main/updater.js. Off by default; when on it checks once
 * shortly after launch and ASKS before downloading; a downloaded update installs on quit or from
 * "Restart to update". Never runs in a dev build or the test bench's test copy.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { test, report } = require('./harness');
const { Updater, ENABLED_KEY, FIRST_CHECK_DELAY_MS } = require('../src/main/updater');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

function fakeAutoUpdater() {
  const u = new EventEmitter();
  u.calls = [];
  u.checkForUpdates = () => { u.calls.push('check'); return Promise.resolve(); };
  u.downloadUpdate = () => { u.calls.push('download'); return Promise.resolve(); };
  u.quitAndInstall = () => { u.calls.push('install'); };
  return u;
}

function make({ enabled = false, supported = true } = {}) {
  const data = enabled ? { [ENABLED_KEY]: true } : {};
  const store = { loadJson: (k, f) => (k in data ? data[k] : f), saveJson: (k, v) => { data[k] = v; } };
  const autoUpdater = fakeAutoUpdater();
  const timers = [];
  const updater = new Updater({
    autoUpdater, store, supported, currentVersion: '1.1.40',
    setTimeoutFn: (fn, ms) => timers.push({ fn, ms }),
  });
  return { updater, autoUpdater, data, timers };
}
const tick = () => new Promise((r) => setImmediate(r));

test('off by default: nothing is checked at launch unless the player opted in', () => {
  const { updater, autoUpdater, timers } = make();
  updater.init();
  assert.equal(updater.getState().enabled, false);
  assert.equal(timers.length, 0, 'no launch check scheduled');
  assert.deepEqual(autoUpdater.calls, []);
  assert.equal(autoUpdater.autoDownload, false, 'never downloads by itself');
  assert.equal(autoUpdater.autoInstallOnAppQuit, true);
});

test('opted in: one check shortly after launch', async () => {
  const { updater, autoUpdater, timers } = make({ enabled: true });
  updater.init();
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, FIRST_CHECK_DELAY_MS);
  timers[0].fn();
  await tick();
  assert.deepEqual(autoUpdater.calls, ['check']);
});

test('ask before downloading: "available" waits; download only when asked; install only when ready', async () => {
  const { updater, autoUpdater } = make({ enabled: true });
  updater.init();
  autoUpdater.emit('update-available', { version: '1.1.41' });
  assert.equal(updater.getState().status, 'available');
  assert.equal(updater.getState().version, '1.1.41');
  assert.deepEqual(autoUpdater.calls, [], 'nothing downloaded on its own');
  updater.install();
  assert.deepEqual(autoUpdater.calls, [], 'cannot install what is not downloaded');
  updater.download();
  await tick();
  assert.deepEqual(autoUpdater.calls, ['download']);
  autoUpdater.emit('download-progress', { percent: 41.6 });
  assert.equal(updater.getState().percent, 42);
  autoUpdater.emit('update-downloaded', { version: '1.1.41' });
  assert.equal(updater.getState().status, 'downloaded');
  updater.install();
  assert.deepEqual(autoUpdater.calls, ['download', 'install']);
});

test('turning it on saves the choice and checks straight away; "Check now" works even when off', async () => {
  const { updater, autoUpdater, data } = make();
  updater.init();
  updater.check();
  await tick();
  assert.deepEqual(autoUpdater.calls, ['check'], 'a manual check is the player asking');
  autoUpdater.emit('update-not-available');
  updater.setEnabled(true);
  assert.equal(data[ENABLED_KEY], true);
});

test('a failed check is reported, not thrown', async () => {
  const { updater, autoUpdater } = make();
  autoUpdater.checkForUpdates = () => Promise.reject(new Error('offline'));
  updater.init();
  updater.check();
  await tick();
  await tick();
  assert.equal(updater.getState().status, 'error');
  assert.equal(updater.getState().error, 'offline');
});

test('unsupported (dev build / test copy): every action is a no-op', async () => {
  const { updater, autoUpdater, timers } = make({ enabled: true, supported: false });
  updater.init();
  updater.check();
  updater.download();
  updater.install();
  await tick();
  assert.equal(updater.getState().status, 'unsupported');
  assert.deepEqual(autoUpdater.calls, []);
  assert.equal(timers.length, 0);
});

test('wiring: GitHub releases, a versioned release per build, dev/test copy excluded, ask-first UI', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(pkg.build.publish, [{ provider: 'github', owner: 'LoxyBee', repo: 'EQLS-Auras' }]);
  assert.ok(pkg.dependencies['electron-updater'], 'electron-updater must ship (a runtime dependency)');
  assert.match(pkg.scripts.dist, /--publish never/, 'electron-builder itself never publishes - the workflow does');
  const wf = read('.github', 'workflows', 'build-installer.yml');
  assert.match(wf, /VERSION=\$\(node -p "require\('\.\/package\.json'\)\.version"\)/, 'the release uses the version IN package.json');
  assert.match(wf, /gh release view "v\$VERSION"[\s\S]*?exit 1/, 'refuses to publish a version that is already released');
  assert.match(wf, /tag_name: v\$\{\{ env\.VERSION \}\}/);
  assert.match(wf, /dist\/latest\.yml/, 'the updater reads latest.yml from the release');
  assert.match(wf, /tag_name: latest-dev[\s\S]*make_latest: 'false'/, 'the fixed link never steals "latest"');
  const mainSrc = read('src', 'main', 'main.js');
  assert.ok(mainSrc.includes('const updaterSupported = app.isPackaged && !TEST_BENCH_MODE;'));
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(renderer, /if \(status === 'available'\) \{[\s\S]*?appConfirm\(\{[\s\S]*?okLabel: 'Download'/, 'asks before downloading');
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="auto-update-checkbox"/);
});

// MANDATORY version bump (owner, 16 Oct: "this is mandatory every single time").
test('the version-bump check: only a strictly higher MAJOR.MINOR.PATCH passes, and PRs run it', () => {
  const { isHigher } = require('../tools/check-version-bump');
  assert.equal(isHigher('1.2.0', '1.1.0'), true);
  assert.equal(isHigher('1.1.1', '1.1.0'), true);
  assert.equal(isHigher('2.0.0', '1.9.9'), true);
  assert.equal(isHigher('1.1.10', '1.1.9'), true, 'numeric, not string, comparison');
  assert.equal(isHigher('1.1.0', '1.1.0'), false, 'unchanged fails');
  assert.equal(isHigher('1.0.9', '1.1.0'), false, 'lower fails');
  assert.equal(isHigher('1.2', '1.1.0'), false, 'malformed fails');
  const tests = read('.github', 'workflows', 'test.yml');
  assert.ok(tests.includes("version-bump:\n    if: github.event_name == 'pull_request'"), 'the PR check job exists');
  assert.ok(tests.includes('run: node tools/check-version-bump.js origin/${{ github.base_ref }}'), 'and runs the check');
});

module.exports = () => report('updater');
if (require.main === module) report('updater').then((n) => process.exit(n ? 1 : 0));
