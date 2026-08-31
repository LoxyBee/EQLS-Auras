'use strict';
/**
 * The aura move HUD (moveHudWindow.js) + widgetManager's nudge/bounds plumbing behind it.
 *
 * The HUD window and its renderer can only really be judged with the app running (docs/TESTING.md
 * covers that). What IS checkable here: the panel clamps itself back on screen, and a nudge
 * actually moves the aura window, persists the canonical anchor, snaps to the grid, and tells
 * whoever is listening.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, report } = require('./harness');

const USER_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'eqls-move-hud-'));

class FakeWindow {
  constructor(opts = {}) {
    this.opts = opts;
    this.x = opts.x ?? 500;
    this.y = opts.y ?? 400;
    this.w = opts.width ?? 200;
    this.h = opts.height ?? 100;
    this.destroyed = false;
    this.visible = false;
    this.handlers = {};
    this.sent = [];
  }
  setAlwaysOnTop() {}
  setOpacity() {}
  setIgnoreMouseEvents() {}
  loadFile() {}
  setBounds(b) {
    if (b.x != null) this.x = b.x;
    if (b.y != null) this.y = b.y;
    if (b.width != null) this.w = b.width;
    if (b.height != null) this.h = b.height;
  }
  setPosition(x, y) { this.x = x; this.y = y; }
  getPosition() { return [this.x, this.y]; }
  getSize() { return [this.w, this.h]; }
  getBounds() { return { x: this.x, y: this.y, width: this.w, height: this.h }; }
  close() { this.destroyed = true; }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  showInactive() { this.visible = true; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  focus() {}
  once(ev, fn) { this.handlers[ev] = fn; }
  on(ev, fn) { this.handlers[ev] = fn; }
  emit(ev) { if (this.handlers[ev]) this.handlers[ev](); }
  get webContents() {
    const self = this;
    return {
      send: (ch, payload) => self.sent.push({ ch, payload }),
      isLoading: () => false,
      once: () => {},
    };
  }
}

const created = [];
const DISPLAY = { workArea: { x: 0, y: 0, width: 1920, height: 1080 } };
const fakeElectron = {
  app: { getPath: () => USER_DATA },
  screen: { getPrimaryDisplay: () => DISPLAY, getDisplayMatching: () => DISPLAY },
  BrowserWindow: class {
    constructor(opts) { const w = new FakeWindow(opts); created.push(w); return w; }
  },
};
const electronId = require.resolve('electron');
require.cache[electronId] = { id: electronId, filename: electronId, loaded: true, exports: fakeElectron, children: [], paths: [] };

const moveHud = require('../src/main/moveHudWindow');
const wm = require('../src/main/widgetManager');
wm.setActiveProfileIdFn(() => 'default');

// --- the panel stays on screen ---------------------------------------------------------------

test('clampToScreen pulls a panel fully back onto the work area - Done is never lost', () => {
  const W = moveHud.PANEL_W;
  const H = moveHud.PANEL_H;
  // dragged off the right and bottom
  const c = moveHud.clampToScreen({ x: 1900, y: 1050, width: W, height: H });
  assert.equal(c.x, 1920 - W);
  assert.equal(c.y, 1080 - H);
  // dragged off the top-left
  const c2 = moveHud.clampToScreen({ x: -80, y: -40, width: W, height: H });
  assert.equal(c2.x, 0);
  assert.equal(c2.y, 0);
  // fully on screen - unchanged
  const c3 = moveHud.clampToScreen({ x: 500, y: 400, width: W, height: H });
  assert.deepEqual(c3, { x: 500, y: 400, width: W, height: H });
});

// --- nudge / bounds --------------------------------------------------------------------------

function makeAura(name) {
  const before = created.length;
  const config = wm.createCustomWidget(name);
  const win = created[before] || created[created.length - 1];
  return { config, win };
}

test('nudgeWidget moves the aura window by the delta and persists the anchor', () => {
  const { config, win } = makeAura('Nudged');
  wm.setLocked(config.id, false); // move mode - window exists
  const [x0, y0] = win.getPosition();

  wm.nudgeWidget(config.id, 5, -3);
  assert.deepEqual(win.getPosition(), [x0 + 5, y0 - 3]);

  wm.nudgeWidget(config.id, -5, 3);
  assert.deepEqual(win.getPosition(), [x0, y0], 'a nudge back returns to the start');

  const saved = wm.getWidgetConfig(config.id).position;
  assert.equal(saved.x, x0);
  assert.equal(saved.y, y0);
});

test('getWidgetBounds reports the live window rect; onWidgetMoved fires on a nudge', () => {
  const { config, win } = makeAura('Bounds');
  wm.setLocked(config.id, false);
  const moves = [];
  wm.setOnWidgetMovedFn((id, bounds) => moves.push({ id, bounds }));

  wm.nudgeWidget(config.id, 12, 0);
  assert.equal(moves.length, 1);
  assert.equal(moves[0].id, config.id);
  assert.deepEqual(moves[0].bounds, wm.getWidgetBounds(config.id));
  assert.deepEqual(wm.getWidgetBounds(config.id), win.getBounds());
});

test('a drag of the aura window also fires onWidgetMoved (so the HUD x/y keeps up)', () => {
  const { config, win } = makeAura('Dragged');
  wm.setLocked(config.id, false);
  const moves = [];
  wm.setOnWidgetMovedFn((id) => moves.push(id));

  win.x += 40; win.y += 20;
  win.emit('moved'); // Windows dragged it; Electron fires this
  assert.deepEqual(moves, [config.id]);
});

// --- snap to grid (phase 2) -----------------------------------------------------------------

test('setSnapGrid clamps the size and getSnapGrid reads it back', () => {
  assert.deepEqual(wm.setSnapGrid({ enabled: true, sizePx: 16 }), { enabled: true, sizePx: 16 });
  assert.deepEqual(wm.getSnapGrid(), { enabled: true, sizePx: 16 });
  assert.equal(wm.setSnapGrid({ enabled: true, sizePx: 1 }).sizePx, 2, 'floored');
  assert.equal(wm.setSnapGrid({ enabled: true, sizePx: 0 }).sizePx, 8, 'a junk 0 falls back to the default');
  assert.equal(wm.setSnapGrid({ enabled: true, sizePx: 9999 }).sizePx, 200, 'ceiled');
  wm.setSnapGrid({ enabled: false, sizePx: 8 });
});

test('a nudge lands on the grid only for the aura in move mode, only when snap is on', () => {
  const { config, win } = makeAura('Snapper');
  wm.setLocked(config.id, false);
  win.setPosition(103, 97);

  wm.setSnapGrid({ enabled: true, sizePx: 8 });
  wm.setSnapWidgetId(config.id);
  wm.nudgeWidget(config.id, 1, 1); // 104,98 -> nearest 8: 104, 96
  assert.deepEqual(win.getPosition(), [104, 96]);

  // a different aura, not the one in move mode: no snap
  const other = makeAura('Free');
  wm.setLocked(other.config.id, false);
  other.win.setPosition(101, 101);
  wm.nudgeWidget(other.config.id, 1, 1);
  assert.deepEqual(other.win.getPosition(), [102, 102], 'a non-move-mode aura is not snapped');

  wm.setSnapGrid({ enabled: false, sizePx: 8 });
  wm.setSnapWidgetId(null);
});

test('a drag drop of the move-mode aura snaps to the grid; others are left alone', () => {
  const { config, win } = makeAura('DragSnap');
  wm.setLocked(config.id, false);
  wm.setSnapGrid({ enabled: true, sizePx: 10 });
  wm.setSnapWidgetId(config.id);

  win.x = 137; win.y = 62;
  win.emit('moved');
  assert.deepEqual(win.getPosition(), [140, 60], 'the drop rounded to the 10px grid');

  const other = makeAura('DragFree');
  wm.setLocked(other.config.id, false);
  other.win.x = 137; other.win.y = 62;
  other.win.emit('moved');
  assert.deepEqual(other.win.getPosition(), [137, 62], 'a non-move-mode aura is not snapped on drop');

  wm.setSnapGrid({ enabled: false, sizePx: 8 });
  wm.setSnapWidgetId(null);
});

module.exports = () => report('move-hud');
if (require.main === module) report('move-hud').then((n) => process.exit(n ? 1 : 0));
