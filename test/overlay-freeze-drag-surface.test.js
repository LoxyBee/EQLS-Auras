'use strict';
/**
 * Fix 5 (31 Aug bug pass) - "the aura move box shifts under the cursor".
 *
 * While an aura is unlocked for repositioning, the blue drag box IS the window's real bounds. Buffs
 * land and expire the whole time, and every content change ran fitToContent, which resized the
 * window out from under the cursor mid-drag. The fix: freeze the window size while unlocked, and
 * apply the settled size once - re-centred on the box the user just positioned - on re-lock (the
 * owner's choice, 31 Aug: centre stays fixed).
 *
 * HOW THIS RUNS. widgetManager.js requires Electron at module load; a fake is installed before the
 * require. The FakeWindow here is stateful (setBounds updates what getSize/getPosition return) so
 * the centre-preservation maths can actually be asserted.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-freeze-test-'));

class FakeWindow {
  constructor(opts) {
    this.opts = opts;
    this.x = 500;
    this.y = 400;
    this.w = opts.width || 220;
    this.h = opts.height || 300;
    this.destroyed = false;
    this.handlers = {};
  }
  setAlwaysOnTop() {}
  setOpacity() {}
  loadFile() {}
  setBounds(b) {
    if (b.x != null) this.x = b.x;
    if (b.y != null) this.y = b.y;
    if (b.width != null) this.w = b.width;
    if (b.height != null) this.h = b.height;
  }
  setPosition(x, y) { this.x = x; this.y = y; }
  close() { this.destroyed = true; }
  getPosition() { return [this.x, this.y]; }
  getSize() { return [this.w, this.h]; }
  getBounds() { return { x: this.x, y: this.y, width: this.w, height: this.h }; }
  isDestroyed() { return this.destroyed; }
  showInactive() {}
  hide() {}
  setIgnoreMouseEvents() {}
  once(event, fn) { this.handlers[event] = fn; }
  on(event, fn) { this.handlers[event] = fn; }
  get webContents() { return { send: () => {} }; }
}

const created = [];
const fakeElectron = {
  app: { getPath: () => USER_DATA },
  screen: { getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }) },
  BrowserWindow: class {
    constructor(opts) { const w = new FakeWindow(opts); created.push(w); return w; }
  },
};
const electronId = require.resolve('electron');
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: fakeElectron, children: [], paths: [] };

const wm = require('../src/main/widgetManager');
wm.setActiveProfileIdFn(() => 'default');

function makeAura(name) {
  const before = created.length;
  const config = wm.createCustomWidget(name);
  const win = created[before] || created[created.length - 1];
  return { config, win };
}

test('fitToContent does nothing to the window while the aura is unlocked', () => {
  const { config, win } = makeAura('Frozen');
  wm.setLocked(config.id, true);
  const before = win.getBounds();

  wm.setLocked(config.id, false); // unlock for moving
  wm.fitToContent(config.id, 900, 700); // a big burst of buffs lands
  wm.fitToContent(config.id, 120, 60); // they all expire again

  assert.deepEqual(win.getBounds(), before, 'the window moved or resized while it was being dragged');
});

test('re-locking applies the settled size and keeps the box centre fixed', () => {
  const { config, win } = makeAura('Recentre');
  wm.setLocked(config.id, true);
  wm.setLocked(config.id, false);

  const b0 = win.getBounds();
  const centreX0 = b0.x + b0.width / 2;
  const centreY0 = b0.y + b0.height / 2;

  wm.fitToContent(config.id, 600, 500); // content grew while unlocked
  assert.deepEqual(win.getBounds(), b0, 'still frozen while unlocked');

  wm.setLocked(config.id, true); // re-lock -> apply, re-centred

  const b1 = win.getBounds();
  assert.notEqual(b1.width, b0.width, 'the settled size was never applied');
  assert.ok(Math.abs((b1.x + b1.width / 2) - centreX0) <= 1, 'centre X moved');
  assert.ok(Math.abs((b1.y + b1.height / 2) - centreY0) <= 1, 'centre Y moved');
});

test('re-locking with no content change since unlock leaves the window alone', () => {
  const { config, win } = makeAura('Untouched');
  wm.setLocked(config.id, true);
  wm.setLocked(config.id, false);
  const before = win.getBounds();
  wm.setLocked(config.id, true);
  assert.deepEqual(win.getBounds(), before, 're-lock resized a window nothing had changed');
});

test('while locked, fitToContent still resizes normally (existing anchor behaviour kept)', () => {
  const { config, win } = makeAura('Locked');
  wm.setLocked(config.id, true);
  const beforeW = win.getSize()[0];
  wm.fitToContent(config.id, 777, 200);
  assert.notEqual(win.getSize()[0], beforeW, 'a locked aura must still fit its content');
});

module.exports = () => report('overlay-freeze-drag-surface');
if (require.main === module) report('overlay-freeze-drag-surface').then((n) => process.exit(n ? 1 : 0));
