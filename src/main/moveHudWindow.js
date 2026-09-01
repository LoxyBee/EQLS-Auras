const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { loadJson, saveJson } = require('./store');

// The move HUD - a small DETACHED control panel shown while one aura is being positioned. Nudge
// arrows, step size, snap-to-grid, the live x/y readout, Reset position and Done. It does NOT wrap
// or follow the aura: it opens centred, the user drags it wherever, and it is CLAMPED so it can
// never sit even partly off-screen - so the Done button is never lost (owner's requirement).
//
// Same "small always-on-top helper window" idea as zonePromptPopup.js. Fully interactive (drag it
// by its background, -webkit-app-region:drag; controls are no-drag), so none of the click-through
// juggling the earlier wrapping-frame version needed.
const PANEL_W = 320;
const PANEL_H = 150;

let win = null;

function clampToScreen(bounds) {
  const display = screen.getDisplayMatching(bounds) || screen.getPrimaryDisplay();
  const wa = display.workArea;
  return {
    x: Math.max(wa.x, Math.min(bounds.x, wa.x + wa.width - bounds.width)),
    y: Math.max(wa.y, Math.min(bounds.y, wa.y + wa.height - bounds.height)),
    width: bounds.width,
    height: bounds.height,
  };
}

// Default: near the top centre of the primary display, out of the way of the auras being arranged
// (owner's placement, 1 Sep). The panel is draggable and its position is remembered after that.
function centred() {
  const { workArea } = screen.getPrimaryDisplay();
  return {
    x: Math.round(workArea.x + (workArea.width - PANEL_W) / 2),
    y: Math.round(workArea.y + 24),
  };
}

function createWindow() {
  if (win) return win;
  const saved = loadJson('moveHudPosition', null);
  const pos = saved && typeof saved.x === 'number' ? saved : centred();

  win = new BrowserWindow({
    x: pos.x,
    y: pos.y,
    width: PANEL_W,
    height: PANEL_H,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload-move-hud.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.on('system-context-menu', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'move-hud', 'index.html'));

  // Clamp back on screen after every move, then remember where it ended up.
  win.on('moved', () => {
    const b = win.getBounds();
    const c = clampToScreen(b);
    if (c.x !== b.x || c.y !== b.y) win.setBounds(c);
    saveJson('moveHudPosition', { x: c.x, y: c.y });
  });

  win.on('closed', () => { win = null; });
  return win;
}

// meta: { name, stepPx, snapEnabled, snapSizePx }. auraBounds carries the live x/y.
function open(auraBounds, meta) {
  const w = createWindow();
  // Re-clamp on open too - a monitor may have been unplugged since it was last saved.
  w.setBounds(clampToScreen(w.getBounds()));
  const send = () => {
    if (w.isDestroyed()) return;
    w.webContents.send('moveHud:frame', { aura: auraBounds || {}, ...meta });
    w.showInactive();
  };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
  else send();
}

// The aura moved (drag / nudge / Reset) - just push its new position for the x/y readout. The
// panel itself does not move.
function update(auraBounds, meta) {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  win.webContents.send('moveHud:frame', { aura: auraBounds || {}, ...meta });
}

function close() {
  if (win && !win.isDestroyed()) win.hide();
}

function isOpen() {
  return !!(win && !win.isDestroyed() && win.isVisible());
}

module.exports = { open, update, close, isOpen, clampToScreen, PANEL_W, PANEL_H };
