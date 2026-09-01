const path = require('path');
const { BrowserWindow, screen } = require('electron');

// One tiny always-on-top pad per thing being positioned (an aura, or an action bar), holding just
// the four nudge arrows. It is a separate window - not drawn inside the aura's own box - because
// an empty aura's box is far too short to hold the arrows without clipping them (the owner hit
// exactly that). The pad sits CENTRED OVER the box and follows it on every move; it is torn down
// when the thing re-locks.
//
// Same "small frameless always-on-top helper" idea as moveHudWindow.js, but keyed by id and
// auto-positioned rather than user-dragged.

const PAD_W = 86;
const PAD_H = 52;

const pads = new Map(); // id -> { win, kind }

// Centre the pad over the box, clamped to the box's display's work area.
function placeFor(bounds) {
  const b = bounds || {};
  const bx = Number(b.x) || 0;
  const by = Number(b.y) || 0;
  const bw = Number(b.width) || 0;
  const bh = Number(b.height) || 0;
  let x = Math.round(bx + (bw - PAD_W) / 2);
  let y = Math.round(by + (bh - PAD_H) / 2);

  const display = screen.getDisplayMatching({ x: bx, y: by, width: Math.max(1, bw), height: Math.max(1, bh) })
    || screen.getPrimaryDisplay();
  const wa = display.workArea;
  x = Math.max(wa.x, Math.min(x, wa.x + wa.width - PAD_W));
  y = Math.max(wa.y, Math.min(y, wa.y + wa.height - PAD_H));
  return { x, y, width: PAD_W, height: PAD_H };
}

function showFor(id, bounds, kind = 'widget') {
  if (!id) return;
  const existing = pads.get(id);
  const place = placeFor(bounds);
  if (existing && !existing.win.isDestroyed()) {
    existing.win.setBounds(place);
    existing.win.showInactive();
    return;
  }
  const win = new BrowserWindow({
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
    query: { id, kind },
  });
  win.once('ready-to-show', () => { if (!win.isDestroyed()) win.showInactive(); });
  pads.set(id, { win, kind });
}

// The box moved (drag / nudge) - keep the pad centred over it.
function updateFor(id, bounds) {
  const p = pads.get(id);
  if (p && !p.win.isDestroyed()) p.win.setBounds(placeFor(bounds));
}

function hideFor(id) {
  const p = pads.get(id);
  if (p && !p.win.isDestroyed()) p.win.destroy();
  pads.delete(id);
}

function hideAll() {
  for (const p of pads.values()) if (p && !p.win.isDestroyed()) p.win.destroy();
  pads.clear();
}

module.exports = { showFor, updateFor, hideFor, hideAll, PAD_W, PAD_H };
