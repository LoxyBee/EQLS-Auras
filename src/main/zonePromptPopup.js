const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { loadJson, saveJson } = require('./store');

// Same shape as ambiguousPopup.js - a small always-on-top, always-interactive popup, separate
// from the buff overlay widgets so it never has to fight with their click-through behavior. Only
// ever exists while there's something to ask (a travel destination or a current zone the app has
// never seen a log line for); hidden, not destroyed, the instant the question is answered or
// dismissed.
//
// One window serves both questions ("where are you going" / "where are you now") rather than two
// separate popups, since they never show at the same time and the content (a searchable zone
// list) is identical either way - only the prompt text and which IPC channel the answer goes back
// on differ, and that's carried in the `prompt` payload itself (see main.js's pendingZonePrompt).
let win = null;

function getDefaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + Math.round(workArea.width / 2 - 160), y: workArea.y + 60 };
}

function createWindow() {
  if (win) return win;

  const pos = loadJson('zonePromptPopupPosition', null) || getDefaultPosition();

  win = new BrowserWindow({
    width: 320,
    height: 420,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload-zone-prompt.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');

  win.loadFile(path.join(__dirname, '..', 'renderer', 'zone-prompt', 'index.html'));

  win.on('moved', () => {
    const [x, y] = win.getPosition();
    saveJson('zonePromptPopupPosition', { x, y });
  });

  win.on('closed', () => {
    win = null;
  });

  return win;
}

// prompt: { mode: 'destination' | 'currentZone' } | null. The renderer gets the actual content
// (which mode, the zone list) over its own IPC channels - this only ever decides show vs hide.
function updateVisibility(prompt) {
  if (prompt) {
    const w = createWindow();
    if (w.isVisible()) return;
    if (w.webContents.isLoading()) {
      w.once('ready-to-show', () => w.showInactive());
    } else {
      w.showInactive();
    }
  } else if (win) {
    win.hide();
  }
}

module.exports = { updateVisibility };
