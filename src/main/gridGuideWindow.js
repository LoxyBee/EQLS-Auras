const path = require('path');
const { BrowserWindow, screen } = require('electron');

// A faint full-screen grid, shown only while the move HUD is open AND snap-to-grid is on, so you
// can see where an aura will land. Fully click-through - it never intercepts anything. Covers the
// primary display only (the case that matters); a secondary monitor just doesn't get the guide.
let win = null;

function createWindow() {
  if (win) return win;
  const { bounds } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload-grid-guide.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true); // never interactive
  win.loadFile(path.join(__dirname, '..', 'renderer', 'grid-guide', 'index.html'));
  win.on('closed', () => { win = null; });
  return win;
}

function show(sizePx) {
  const w = createWindow();
  const send = () => {
    if (w.isDestroyed()) return;
    w.webContents.send('gridGuide:size', Math.max(2, Math.round(Number(sizePx) || 8)));
    w.showInactive();
  };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
  else send();
}

function hide() {
  if (win && !win.isDestroyed()) win.hide();
}

module.exports = { show, hide };
