const path = require('path');
const { BrowserWindow, screen } = require('electron');

// A brief on-screen banner naming the loadout you just switched to - shown near the top-centre of
// the primary display, held ~3s, then faded out. Same borderless / transparent / click-through /
// always-on-top shape as gridGuideWindow. Never interactive, never on the taskbar.
//
// Only shown on an actual profile CHANGE (main.js's activateProfile), and only when
// `profileFlashEnabled` is on. The renderer runs the fade and asks to be hidden when it finishes;
// a main-side safety timer hides it anyway if that message never arrives.
let win = null;
let hideTimer = null;

const WIDTH = 420;
const HEIGHT = 90;

function createWindow() {
  if (win) return win;
  const { bounds } = screen.getPrimaryDisplay();
  win = new BrowserWindow({
    x: Math.round(bounds.x + (bounds.width - WIDTH) / 2),
    y: Math.round(bounds.y + bounds.height * 0.12),
    width: WIDTH,
    height: HEIGHT,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload-profile-flash.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true);
  win.loadFile(path.join(__dirname, '..', 'renderer', 'profile-flash', 'index.html'));
  win.webContents.on('ipc-message', (_e, channel) => {
    if (channel === 'profileFlash:done') hide();
  });
  win.on('closed', () => { win = null; });
  return win;
}

function show(name) {
  const label = String(name || '').trim();
  if (!label) return;
  const w = createWindow();
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  const send = () => {
    if (w.isDestroyed()) return;
    w.webContents.send('profileFlash:show', label);
    w.showInactive();
  };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
  else send();
  // Safety net - the renderer normally hides itself when its fade ends (~3.6s).
  hideTimer = setTimeout(hide, 5000);
}

function hide() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (win && !win.isDestroyed()) win.hide();
}

function destroy() {
  if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { show, hide, destroy };
