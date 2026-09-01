const path = require('path');
const { BrowserWindow, screen } = require('electron');

// One tiny always-on-top pad per unlocked aura, holding just the four nudge arrows. It is a
// separate window (not drawn inside the aura's own box) because an empty aura's box is far too
// short to hold the arrows without clipping them - the owner hit exactly that. The pad is
// anchored just above the aura's blue box and follows it on every move; it is torn down when the
// aura re-locks.
//
// Same "small frameless always-on-top helper" idea as moveHudWindow.js, but keyed by aura id and
// auto-positioned rather than user-dragged.

const PAD_W = 90;
const PAD_H = 40;
const GAP = 6; // between the pad and the aura box

const pads = new Map(); // widgetId -> BrowserWindow

// Sit the pad centred just above the box; flip below if it would leave the work area at the top.
function placeFor(bounds) {
  const b = bounds || {};
  const bx = Number(b.x) || 0;
  const by = Number(b.y) || 0;
  const bw = Number(b.width) || 0;
  let x = Math.round(bx + (bw - PAD_W) / 2);
  let y = Math.round(by - PAD_H - GAP);

  const display = screen.getDisplayMatching({ x: bx, y: by, width: Math.max(1, bw), height: 1 })
    || screen.getPrimaryDisplay();
  const wa = display.workArea;
  if (y < wa.y) y = Math.round(by + (Number(b.height) || 0) + GAP); // no room above -> below
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - PAD_W));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - PAD_H));
  return { x, y, width: PAD_W, height: PAD_H };
}

function showFor(widgetId, bounds) {
  if (!widgetId) return;
  let win = pads.get(widgetId);
  const place = placeFor(bounds);
  if (win && !win.isDestroyed()) {
    win.setBounds(place);
    win.showInactive();
    return;
  }
  win = new BrowserWindow({
    ...place,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    focusable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload-nudge-pad.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  win.setAlwaysOnTop(true, 'screen-saver');
  win.on('system-context-menu', (e) => e.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'nudge-pad', 'index.html'), {
    query: { widgetId },
  });
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive(); });
  pads.set(widgetId, win);
}

// The aura moved (drag / nudge) - keep the pad glued above it.
function updateFor(widgetId, bounds) {
  const win = pads.get(widgetId);
  if (win && !win.isDestroyed()) win.setBounds(placeFor(bounds));
}

function hideFor(widgetId) {
  const win = pads.get(widgetId);
  if (win && !win.isDestroyed()) win.destroy();
  pads.delete(widgetId);
}

function hideAll() {
  for (const win of pads.values()) if (win && !win.isDestroyed()) win.destroy();
  pads.clear();
}

module.exports = { showFor, updateFor, hideFor, hideAll, PAD_W, PAD_H };
