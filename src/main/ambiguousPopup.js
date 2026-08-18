const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { loadJson, saveJson } = require('./store');

// Small always-on-top, always-interactive (never click-through) popup for
// resolving ambiguous casts, separate from the buff overlay widgets - it
// can't just be "unlock the overlay" since that would also stop the
// overlay being click-through during normal play. Only ever exists while
// there's actually something to resolve; hidden (not destroyed) the
// instant the queue empties so re-showing it later doesn't need a fresh
// window/reload.
let win = null;

function getDefaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + Math.round(workArea.width / 2 - 170), y: workArea.y + 60 };
}

function createWindow() {
  if (win) return win;

  const pos = loadJson('ambiguousPopupPosition', null) || getDefaultPosition();

  win = new BrowserWindow({
    width: 340,
    height: 220,
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
      preload: path.join(__dirname, '..', 'preload', 'preload-ambiguous-popup.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // Same reasoning as the buff widgets - 'screen-saver' level gives it the
  // best chance of staying above the game window (which still needs to run
  // windowed/borderless-windowed, never true exclusive fullscreen).
  win.setAlwaysOnTop(true, 'screen-saver');

  win.loadFile(path.join(__dirname, '..', 'renderer', 'ambiguous-popup', 'index.html'));

  win.on('moved', () => {
    const [x, y] = win.getPosition();
    saveJson('ambiguousPopupPosition', { x, y });
  });

  win.on('closed', () => {
    win = null;
  });

  return win;
}

// Called on every ambiguousCastsChanged event - shows the popup the moment
// there's something to resolve, hides it the moment the queue is empty
// again, rather than leaving an empty window sitting on screen.
function updateVisibility(ambiguousCasts) {
  const hasWork = ambiguousCasts.length > 0;
  if (hasWork) {
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
