'use strict';

// Opt-in auto-update (owner, 16 Oct): OFF by default - nothing contacts GitHub unless the player
// ticks "Check for updates" on the Setup page. When on, the app checks once shortly after launch;
// it ASKS before downloading (the owner's choice), and a downloaded update installs when the app
// quits, or straight away from the "Restart to update" button.
//
// Built on electron-updater's GitHub provider: each CI build publishes its own versioned release
// with a latest.yml (see .github/workflows/build-installer.yml). Never runs in a dev build (no
// release to compare against) or in the test bench's test copy (main.js passes disabled).
//
// The electron-updater object is injected, so the tests drive this with a fake.

const { EventEmitter } = require('events');

const ENABLED_KEY = 'autoUpdateEnabled';
const FIRST_CHECK_DELAY_MS = 10 * 1000; // let startup finish before touching the network

class Updater extends EventEmitter {
  /**
   * deps:
   *   autoUpdater   electron-updater's autoUpdater (or a fake): checkForUpdates, downloadUpdate,
   *                 quitAndInstall, on(event, fn), autoDownload, autoInstallOnAppQuit, logger
   *   store         { loadJson, saveJson }
   *   supported     false in a dev build or the test copy - every action then does nothing
   *   currentVersion the running app's version
   *   log           (message) => void
   *   setTimeoutFn  injectable for tests
   */
  constructor(deps) {
    super();
    this.d = { setTimeoutFn: setTimeout, log: () => {}, ...deps };
    this.state = {
      status: this.d.supported ? 'idle' : 'unsupported',
      currentVersion: this.d.currentVersion || null,
      version: null,
      percent: null,
      error: null,
    };
  }

  isEnabled() {
    return this.d.store.loadJson(ENABLED_KEY, false) === true;
  }

  getState() {
    return { ...this.state, enabled: this.isEnabled(), supported: !!this.d.supported };
  }

  _set(patch) {
    this.state = { ...this.state, ...patch };
    this.emit('changed', this.getState());
  }

  init() {
    if (!this.d.supported) return;
    const u = this.d.autoUpdater;
    u.autoDownload = false; // ask first
    u.autoInstallOnAppQuit = true;
    u.logger = { info: (m) => this.d.log(`UPDATER: ${m}`), warn: (m) => this.d.log(`UPDATER: ${m}`), error: (m) => this.d.log(`UPDATER ERROR: ${m}`), debug: () => {} };
    u.on('checking-for-update', () => this._set({ status: 'checking', error: null }));
    u.on('update-available', (info) => this._set({ status: 'available', version: (info && info.version) || null }));
    u.on('update-not-available', () => this._set({ status: 'none', version: null }));
    u.on('download-progress', (p) => this._set({ status: 'downloading', percent: Math.round((p && p.percent) || 0) }));
    u.on('update-downloaded', (info) => this._set({ status: 'downloaded', version: (info && info.version) || this.state.version, percent: 100 }));
    u.on('error', (err) => this._set({ status: 'error', error: (err && err.message) || String(err) }));
    if (this.isEnabled()) this.d.setTimeoutFn(() => this.check(), FIRST_CHECK_DELAY_MS);
  }

  setEnabled(on) {
    this.d.store.saveJson(ENABLED_KEY, !!on);
    this.emit('changed', this.getState());
    if (on && this.state.status === 'idle') this.check();
    return this.getState();
  }

  // A manual "Check now" works whether or not automatic checking is on - the player asked.
  check() {
    if (!this.d.supported) return this.getState();
    if (this.state.status === 'checking' || this.state.status === 'downloading') return this.getState();
    this._set({ status: 'checking', error: null });
    Promise.resolve()
      .then(() => this.d.autoUpdater.checkForUpdates())
      .catch((err) => this._set({ status: 'error', error: (err && err.message) || String(err) }));
    return this.getState();
  }

  download() {
    if (!this.d.supported || this.state.status !== 'available') return this.getState();
    this._set({ status: 'downloading', percent: 0 });
    Promise.resolve()
      .then(() => this.d.autoUpdater.downloadUpdate())
      .catch((err) => this._set({ status: 'error', error: (err && err.message) || String(err) }));
    return this.getState();
  }

  install() {
    if (!this.d.supported || this.state.status !== 'downloaded') return this.getState();
    this.d.autoUpdater.quitAndInstall();
    return this.getState();
  }
}

module.exports = { Updater, ENABLED_KEY, FIRST_CHECK_DELAY_MS };
