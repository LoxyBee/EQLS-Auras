const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { loadJson, saveJson } = require('./store');

// The test bench's own small window (dev builds only - see testBench.js). A separate, movable,
// resizable panel tied to the main window (a child of it): it stays above the app's own window, so
// it is always reachable while editing auras, and minimises with it - but it is NOT always-on-top,
// so it never floats over the game or anything else (owner, 15 Oct). Same "small helper window"
// shape as moveHudWindow.js: frameless, dragged by its header, kept on screen, position + size
// remembered (store key testBenchBounds).
const DEFAULT_W = 380;
const DEFAULT_H = 560;
const MIN_W = 300;
const MIN_H = 320;

let win = null;

function clampToScreen(bounds) {
  const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
  const wa = display.workArea;
  const width = Math.min(Math.max(bounds.width, MIN_W), wa.width);
  const height = Math.min(Math.max(bounds.height, MIN_H), wa.height);
  return {
    x: Math.max(wa.x, Math.min(bounds.x, wa.x + wa.width - width)),
    y: Math.max(wa.y, Math.min(bounds.y, wa.y + wa.height - height)),
    width,
    height,
  };
}

function defaultBounds() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + 40, y: workArea.y + 80, width: DEFAULT_W, height: DEFAULT_H };
}

// parent: the main window, when there is one.
function open(parent) {
  if (win && !win.isDestroyed()) {
    win.showInactive();
    return win;
  }
  const saved = loadJson('testBenchBounds', null);
  const start = clampToScreen(saved && typeof saved.x === 'number' ? { ...defaultBounds(), ...saved } : defaultBounds());

  win = new BrowserWindow({
    ...start,
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,
    transparent: false,
    backgroundColor: '#14100b',
    alwaysOnTop: false,
    parent: parent && !parent.isDestroyed() ? parent : undefined,
    skipTaskbar: true,
    resizable: true,
    fullscreenable: false,
    show: false,
    title: 'Test bench',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload-test-bench.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.on('system-context-menu', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'test-bench', 'index.html'));
  win.once('ready-to-show', () => win && !win.isDestroyed() && win.show());

  const remember = () => {
    if (!win || win.isDestroyed()) return;
    const b = win.getBounds();
    const c = clampToScreen(b);
    if (c.x !== b.x || c.y !== b.y || c.width !== b.width || c.height !== b.height) win.setBounds(c);
    saveJson('testBenchBounds', c);
  };
  win.on('moved', remember);
  win.on('resized', remember);
  win.on('closed', () => { win = null; });
  return win;
}

function close() {
  if (win && !win.isDestroyed()) win.close();
  win = null;
}

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

module.exports = { open, close, send, clampToScreen };
