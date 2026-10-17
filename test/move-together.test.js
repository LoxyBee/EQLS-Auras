'use strict';
/**
 * "Move together" (owner, 16 Oct): a folder can be linked so its auras move as one group. Dragging,
 * nudging or centring any member moves them all by the same amount; the move panel's "This aura"
 * moves just one; a member switched off on this profile (no window) follows by its saved position.
 *
 * The REAL widgetManager is driven here, with Electron swapped for a fake BrowserWindow that keeps a
 * position and fires 'move' / 'moved' like the real one does during a drag.
 */

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');
const { EventEmitter } = require('node:events');
const { test, report } = require('./harness');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8').replace(/\r\n/g, '\n');

class FakeWindow extends EventEmitter {
  constructor(opts) {
    super();
    this.x = opts.x;
    this.y = opts.y;
    this.w = opts.width || 200;
    this.h = opts.height || 60;
    this.visible = false;
    this.destroyed = false;
    this.webContents = { send() {}, isLoading: () => false, once() {}, on() {} };
    FakeWindow.all.push(this);
  }
  setAlwaysOnTop() {}
  setIgnoreMouseEvents() {}
  setOpacity() {}
  loadFile() {}
  getPosition() { return [this.x, this.y]; }
  setPosition(x, y) { this.x = x; this.y = y; this.emit('move'); }
  getSize() { return [this.w, this.h]; }
  setBounds(b) { if (b.x != null) { this.x = b.x; this.y = b.y; } if (b.width) { this.w = b.width; this.h = b.height; } }
  getBounds() { return { x: this.x, y: this.y, width: this.w, height: this.h }; }
  isDestroyed() { return this.destroyed; }
  isVisible() { return this.visible; }
  showInactive() { this.visible = true; }
  show() { this.visible = true; }
  hide() { this.visible = false; }
  close() { this.destroyed = true; }
  // A user drag: Windows moves the window and fires 'move' as it goes, then 'moved' on drop.
  userDrag(dx, dy, steps = 3) {
    for (let i = 1; i <= steps; i += 1) {
      this.x += Math.round(dx / steps);
      this.y += Math.round(dy / steps);
      this.emit('move');
    }
    this.emit('moved');
  }
}
FakeWindow.all = [];

function loadWidgetManager() {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'eq-move-together-'));
  const electron = {
    app: { getPath: () => userData, isPackaged: false },
    BrowserWindow: FakeWindow,
    screen: {
      getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
      getDisplayMatching: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }),
    },
  };
  const orig = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'electron') return electron;
    return orig.call(this, request, ...rest);
  };
  for (const m of ['widgetManager', 'widgetStore', 'store', 'positionSnap']) {
    try { delete require.cache[require.resolve(`../src/main/${m}`)]; } catch (e) { /* not loaded */ }
  }
  try {
    return { wm: require('../src/main/widgetManager'), userData };
  } finally {
    Module._load = orig;
  }
}

function setup() {
  FakeWindow.all = [];
  const { wm, userData } = loadWidgetManager();
  let profile = 'p1';
  wm.setActiveProfileIdFn(() => profile);
  const folder = wm.createFolder('Raid HUD');
  const make = (name) => {
    const c = wm.createCustomWidget(name, { buffSource: 'customTimer' });
    wm.setWidgetFolder(c.id, folder.id);
    return c.id;
  };
  const a = make('A');
  const b = make('B');
  const c = make('C');
  const winOf = (id) => FakeWindow.all.find((w) => w.listenerCount('moved') && w._id === id);
  // Tag each fake window with its aura id (created in order A, B, C).
  FakeWindow.all.forEach((w, i) => { w._id = [a, b, c][i]; });
  const pos = (id) => winOf(id).getPosition();
  // Spread them out so a group move is easy to read.
  [a, b, c].forEach((id, i) => wm.placeWidget(id, { x: 100 + i * 300, y: 100 }));
  return { wm, folder, a, b, c, winOf, pos, userData, setProfile: (p) => { profile = p; } };
}

// The follow rule main.js installs during a Group-mode move session of this folder.
function groupFollow(wm, ids, mode = () => 'group') {
  wm.setGroupFollowFn((moved) => (mode() === 'group' && ids.includes(moved) ? ids : null));
}

test('a live drag of one member drags the whole group by the same amount', () => {
  const { wm, a, b, c, winOf, pos } = setup();
  groupFollow(wm, [a, b, c]);
  for (const id of [a, b, c]) wm.setLocked(id, false);
  winOf(b).userDrag(30, 45);
  assert.deepEqual(pos(a), [130, 145]);
  assert.deepEqual(pos(b), [430, 145]);
  assert.deepEqual(pos(c), [730, 145]);
  const saved = wm.getWidgetConfig(c).position;
  assert.deepEqual([saved.x, saved.y], [730, 145], 'followers are saved on drop');
});

test('a nudge and a centre move the group too; a reset moves only that aura', () => {
  const { wm, a, b, c, pos } = setup();
  groupFollow(wm, [a, b, c]);
  wm.nudgeWidget(a, 10, -5);
  assert.deepEqual([pos(a), pos(b), pos(c)], [[110, 95], [410, 95], [710, 95]]);
  wm.placeWidget(a, { x: 0 });
  assert.deepEqual([pos(a)[0], pos(b)[0], pos(c)[0]], [0, 300, 600], 'centre/place keeps the layout');
  wm.resetPosition(c);
  assert.deepEqual([pos(a)[0], pos(b)[0]], [0, 300], 'a reset is this aura only');
});

test('"This aura" mode: only the dragged aura moves; the rest stay put', () => {
  const { wm, a, b, c, winOf, pos } = setup();
  let mode = 'single';
  groupFollow(wm, [a, b, c], () => mode);
  for (const id of [a, b, c]) wm.setLocked(id, false);
  winOf(a).userDrag(60, 0);
  assert.deepEqual([pos(a), pos(b), pos(c)], [[160, 100], [400, 100], [700, 100]]);
  mode = 'group';
  winOf(a).userDrag(12, 0);
  assert.deepEqual([pos(b), pos(c)], [[412, 100], [712, 100]], 'switched back mid-move: the group follows again');
});

test('a member switched off on this profile still follows, by its saved position', () => {
  const { wm, a, b, c, winOf, pos } = setup();
  wm.setActiveProfileIds(c, ['other-profile']); // C has no window on this profile
  const before = wm.getWidgetConfig(c).position;
  groupFollow(wm, [a, b, c]);
  wm.setLocked(a, false);
  winOf(a).userDrag(21, 21);
  const after = wm.getWidgetConfig(c).position;
  assert.deepEqual([after.x - before.x, after.y - before.y], [21, 21]);
  assert.deepEqual(pos(b), [421, 121]);
});

test('Alt-drag moves just the aura you grab - any member, not only the one the session opened on', () => {
  const { wm, a, b, c, winOf, pos } = setup();
  let alt = false;
  wm.setSoloDragFn(() => alt);
  groupFollow(wm, [a, b, c]);
  for (const id of [a, b, c]) wm.setLocked(id, false);
  alt = true;
  winOf(c).userDrag(30, 0); // C was not the aura the session was opened on
  assert.deepEqual([pos(a), pos(b), pos(c)], [[100, 100], [400, 100], [730, 100]]);
  alt = false;
  winOf(c).userDrag(30, 0); // next drag without Alt: the whole group again
  assert.deepEqual([pos(a), pos(b), pos(c)], [[130, 100], [430, 100], [760, 100]]);
});

test('Alt is read once, as the drag starts - letting go halfway does not yank the group along', () => {
  const { wm, a, b, winOf, pos } = setup();
  let alt = true;
  wm.setSoloDragFn(() => alt);
  groupFollow(wm, [a, b]);
  wm.setLocked(a, false);
  const w = winOf(a);
  w.x += 10; w.emit('move');
  alt = false; // released mid-drag
  w.x += 10; w.emit('move');
  w.emit('moved');
  assert.deepEqual(pos(a), [120, 100]);
  assert.deepEqual(pos(b), [400, 100]);
});

test('altKeyWatcher: reads the state lines the probe prints, and forgets Alt when stopped or gone', () => {
  const { AltKeyWatcher } = require('../src/main/altKeyWatcher');
  const procs = [];
  const fakeSpawn = (cmd, args) => {
    const p = new EventEmitter();
    p.stdout = new EventEmitter();
    p.args = args;
    p.kill = () => { p.killed = true; };
    procs.push(p);
    return p;
  };
  const w = new AltKeyWatcher(fakeSpawn);
  w.start();
  assert.ok(procs[0].args.includes('-EncodedCommand'));
  procs[0].stdout.emit('data', Buffer.from('0\r\n1'));
  assert.equal(w.isHeld(), false, 'a half-written line is not read yet');
  procs[0].stdout.emit('data', Buffer.from('\r\n'));
  assert.equal(w.isHeld(), true);
  w.start();
  assert.equal(procs.length, 1, 'start() twice keeps one process');
  procs[0].emit('exit');
  assert.equal(w.isHeld(), false);
  assert.equal(w.isRunning(), false);
  w.start();
  procs[1].stdout.emit('data', Buffer.from('1\n'));
  w.stop();
  assert.equal(procs[1].killed, true);
  assert.equal(w.isHeld(), false);
});

test('Alt on a nudge arrow moves just that aura; without Alt the arrow moves the group', () => {
  const { wm, a, b, pos } = setup();
  groupFollow(wm, [a, b]);
  wm.nudgeWidget(a, 10, 0, { solo: true });
  assert.deepEqual([pos(a), pos(b)], [[110, 100], [400, 100]]);
  wm.nudgeWidget(a, 10, 0);
  assert.deepEqual([pos(a), pos(b)], [[120, 100], [410, 100]]);
});

test('undo restore: puts each aura back exactly, without dragging its group along', () => {
  const { wm, a, b, c, pos } = setup();
  wm.setActiveProfileIds(c, ['other-profile']); // windowless member - its saved spot is restored
  const before = [a, b, c].map((id) => wm.getPositionSnapshot(id));
  groupFollow(wm, [a, b, c]);
  for (const id of [a, b]) wm.setLocked(id, false); // as in a real move session
  wm.nudgeWidget(a, 40, 40);
  assert.notDeepEqual(wm.getWidgetConfig(c).position, before[2].saved);
  // Restoring A on its own must not drag B along.
  wm.applyPositionSnapshot(a, before[0]);
  assert.deepEqual(pos(b), [440, 140]);
  [b, c].forEach((id, i) => wm.applyPositionSnapshot(id, before[i + 1]));
  assert.deepEqual([pos(a), pos(b)], [[100, 100], [400, 100]]);
  assert.deepEqual(wm.getWidgetConfig(c).position, before[2].saved);
  assert.deepEqual(wm.getWidgetConfig(a).position, before[0].saved);
});

test('MoveHistory: settled moves become steps; Undo/Redo walk them; a new move drops Redo', () => {
  const { MoveHistory } = require('../src/main/moveHistory');
  let where = 0;
  let pending = null;
  const h = new MoveHistory({
    capture: () => ({ where }),
    apply: (st) => { where = st.where; },
    setTimer: (fn) => { pending = fn; return 1; },
    clearTimer: () => { pending = null; },
  });
  assert.equal(h.canUndo(), false);
  h.start();
  where = 5; h.note(); where = 7; h.note(); // a quick run of nudges...
  pending(); // ...settles into ONE step
  assert.equal(h.canUndo(), true);
  where = 9; h.note(); pending();
  assert.equal(h.step(-1), true); assert.equal(where, 7);
  assert.equal(h.step(-1), true); assert.equal(where, 0);
  assert.equal(h.step(-1), false, 'nothing before the start');
  assert.equal(h.canRedo(), true);
  h.note(); pending(); // the restore itself settles - not a new step
  assert.equal(h.canRedo(), true);
  h.step(1); assert.equal(where, 7);
  where = 20; h.note(); pending(); // a new move after an undo
  assert.equal(h.canRedo(), false, 'the old Redo is gone');
  h.step(-1); assert.equal(where, 7);
  where = 30; h.note(); // still settling when Undo is pressed: it counts as a step first
  h.step(-1); assert.equal(where, 7);
  h.clear();
  assert.equal(h.canUndo(), false);
  assert.equal(h.step(-1), false);
});

test('wiring: Undo/Redo buttons + Ctrl+Z/Y on the panel, history per session, Alt from the pad', () => {
  const html = read('src', 'renderer', 'move-hud', 'index.html');
  assert.match(html, /id="undo"[^>]*title="Undo \(Ctrl\+Z\)"/);
  assert.match(html, /id="redo"[^>]*title="Redo \(Ctrl\+Y\)"/);
  const hud = read('src', 'renderer', 'move-hud', 'move-hud.js');
  assert.ok(hud.includes('undoEl.disabled = !payload.canUndo;'));
  assert.ok(hud.includes("if (k === 'z' && !e.shiftKey) window.eqMoveHud.undo();"));
  const mainSrc = read('src', 'main', 'main.js');
  assert.ok(mainSrc.includes("ipcMain.handle('moveHud:undo', () => moveHistory.step(-1));"));
  assert.ok(mainSrc.includes("ipcMain.handle('moveHud:redo', () => moveHistory.step(1));"));
  assert.equal((mainSrc.match(/moveHistory\.start\(\);/g) || []).length, 2, 'Move and Unlock all both start one');
  assert.equal((mainSrc.match(/moveHistory\.clear\(\);/g) || []).length, 2, 'and both end it');
  assert.ok(mainSrc.includes('function onMoveTargetMoved(id, bounds) {\n  moveHistory.note();'));
  assert.ok(read('src', 'renderer', 'nudge-pad', 'nudge-pad.js').includes('* stepPx, e.altKey);'));
});

test('snap: every member of a group session snaps when dragged on its own, not just the opened aura', () => {
  const { wm, a, b, winOf, pos } = setup();
  const positionSnap = require('../src/main/positionSnap');
  positionSnap.set({ enabled: true, sizePx: 32 });
  positionSnap.setActive([a, b]); // what main.js does for a group session
  wm.setSoloDragFn(() => true); // Alt held: B moves alone
  groupFollow(wm, [a, b]);
  for (const id of [a, b]) wm.setLocked(id, false);
  winOf(b).userDrag(30, 30); // B was not the aura the session was opened on
  assert.deepEqual(pos(b), [416, 128], 'B (430,130) snapped to the 32px grid');
  assert.deepEqual(pos(a), [100, 100], 'A untouched');
  positionSnap.setActive(a); // a single id still works
  assert.equal(positionSnap.active(a), true);
  assert.equal(positionSnap.active(b), false);
  positionSnap.setActive(null);
  positionSnap.set({ enabled: false, sizePx: 8 });
});

test('the grid guide counts its lines from the TOP of the screen, like the snap does', () => {
  const html = read('src', 'renderer', 'grid-guide', 'index.html');
  assert.match(html, /repeating-linear-gradient\(180deg/);
  assert.ok(read('src', 'main', 'main.js').includes('positionSnap.setActive(g.ids);'), 'a group session snaps every member');
  assert.doesNotMatch(html, /repeating-linear-gradient\(0deg/, 'a 0deg gradient starts at the bottom - off by (height mod grid)');
});

test('no follow rule (normal use, or an unlinked folder): auras move alone', () => {
  const { wm, a, b, winOf, pos } = setup();
  wm.setGroupFollowFn(null);
  wm.setLocked(a, false);
  winOf(a).userDrag(40, 0);
  assert.deepEqual(pos(b), [400, 100]);
});

test('the store: a linked folder is a group of 2+; unlinked or single-aura folders are not', () => {
  const { wm, folder, a, b, c } = setup();
  assert.equal(wm.getLinkedGroup(a), null, 'off by default');
  wm.setFolderLinked(folder.id, true);
  assert.deepEqual(wm.getLinkedGroup(b).ids.sort(), [a, b, c].sort());
  assert.equal(wm.getLinkedGroup(b).name, 'Raid HUD');
  wm.setWidgetFolder(b, '');
  wm.setWidgetFolder(c, '');
  assert.equal(wm.getLinkedGroup(a), null, 'one aura is not a group');
});

test('wiring: chain + Move on the folder, the menu item, the panel toggle and the group session', () => {
  const renderer = read('src', 'renderer', 'main-window', 'main-window.js');
  assert.match(renderer, /link\.className = 'nav-folder-link' \+ \(folder\.linked \? ' on' : ''\)/);
  assert.match(renderer, /window\.eqTracker\.moveAuraFolder\(folder\.id\)/);
  assert.match(read('src', 'renderer', 'main-window', 'index.html'), /id="folder-context-link">Move together</);
  assert.match(read('src', 'renderer', 'move-hud', 'index.html'), /id="group-mode-group"[\s\S]*id="group-mode-single"/);
  const mainSrc = read('src', 'main', 'main.js');
  assert.ok(mainSrc.includes("moveGroup = { ...g, mode: 'group' };"));
  assert.ok(mainSrc.includes("ipcMain.handle('moveHud:setGroupMode'"));
  assert.match(read('src', 'renderer', 'overlay', 'overlay.css'), /\.drag-overlay\.group-member/);
});

module.exports = () => report('move-together');
if (require.main === module) report('move-together').then((n) => process.exit(n ? 1 : 0));
