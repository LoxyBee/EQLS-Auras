'use strict';
/**
 * Recovery from a real renderer crash (main.js's render-process-gone handler), added 14 Sep.
 *
 * Confirmed from the real debug log: three overlay windows (Damage parser, Zone timer, Travel
 * guide - the highest-churn "standalone" list auras, resized far more often than an ordinary buff
 * tile as their content grows/shrinks every tick) crash repeatedly with real native exit codes
 * (STATUS_ACCESS_VIOLATION / STATUS_BREAKPOINT), not a JS exception anywhere in this app's own
 * code. Electron does NOT close a BrowserWindow just because its renderer died - the shell sits
 * there blank forever, and createWidgetWindow's own `if (windows.has(id)) return` guard means
 * nothing would ever touch it again short of restarting the whole app. That is the "aura
 * disappeared mid-play" symptom. widgetManager.recreateCrashedWindow is the fix: tear the dead
 * shell down and rebuild it, same as if the aura had just been unlocked.
 *
 * Uses the same fake-Electron pattern as visibility.test.js - proves this app's own recovery
 * logic, not real BrowserWindow/renderer behaviour.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-crash-recovery-test-'));

class FakeWindow {
  constructor(opts) {
    this.opts = opts;
    this.shown = false;
    this.destroyed = false;
    this.handlers = {};
  }
  setAlwaysOnTop() {}
  setOpacity() {}
  loadFile() {}
  setBounds() {}
  setPosition() {}
  close() { this.destroyed = true; }
  destroy() { this.destroyed = true; }
  getPosition() { return [0, 0]; }
  getSize() { return [this.opts.width || 220, this.opts.height || 300]; }
  isDestroyed() { return this.destroyed; }
  showInactive() { this.shown = true; }
  hide() { this.shown = false; }
  setIgnoreMouseEvents() {}
  once(event, fn) { this.handlers[event] = fn; }
  on(event, fn) { this.handlers[event] = fn; }
  get webContents() {
    return { send: () => {} };
  }
  ready() { if (this.handlers['ready-to-show']) this.handlers['ready-to-show'](); }
}

const created = [];
const fakeElectron = {
  app: { getPath: () => USER_DATA },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  BrowserWindow: class {
    constructor(opts) {
      const win = new FakeWindow(opts);
      created.push(win);
      return win;
    }
  },
};
const electronId = require.resolve('electron');
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: fakeElectron, children: [], paths: [] };

const wm = require('../src/main/widgetManager');

test('a crashed aura window is torn down and rebuilt, not left blank forever', () => {
  const config = wm.createCustomWidget('Damage parser');
  const firstWindow = created[created.length - 1];
  firstWindow.ready();
  assert.equal(firstWindow.shown, true, 'sanity check: the aura is on screen before the crash');
  assert.equal(firstWindow.destroyed, false);

  wm.recreateCrashedWindow(config.id);

  assert.equal(firstWindow.destroyed, true, 'the dead shell must be torn down, not left blank');
  const secondWindow = created[created.length - 1];
  assert.notEqual(secondWindow, firstWindow, 'a fresh window must be built to replace it');
  secondWindow.ready();
  assert.equal(secondWindow.shown, true, 'the rebuilt aura must come back on screen');
});

test('recreateCrashedWindow on an aura the current profile has hidden does not resurrect it', () => {
  // The crash-recovery path must respect the same on/off rule as everything else (note 10) -
  // otherwise a crash while switched to a profile that hides this aura would force it back.
  const PROFILE_B = 'profile-b';
  const config = wm.createCustomWidget('Zone timer');
  config.activeProfileIds = ['default'];
  let activeProfile = 'default';
  wm.setActiveProfileIdFn(() => activeProfile);
  activeProfile = PROFILE_B;

  const before = created.length;
  wm.recreateCrashedWindow(config.id);
  assert.equal(created.length, before, 'must not build a new window for an aura hidden on this profile');

  activeProfile = 'default';
});

test('recreateCrashedWindow on an unknown/already-deleted widget id is a no-op, not a throw', () => {
  assert.doesNotThrow(() => wm.recreateCrashedWindow('not-a-real-id'));
});

report();
