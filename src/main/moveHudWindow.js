const path = require('path');
const { BrowserWindow } = require('electron');

// The move HUD - a transparent frame that surrounds ONE aura while it is being positioned, with
// nudge arrows on its four edges and a control strip below (step size, snap to grid, live x/y,
// Reset, Done). Same "small always-on-top helper window" idea as ambiguousPopup.js /
// zonePromptPopup.js, but two things are different:
//
//  - it has a HOLE. The aura's own window sits inside the frame and its blue drag box has to stay
//    grabbable, so the HUD starts click-through (setIgnoreMouseEvents(true, { forward: true })) and
//    the renderer flips it interactive only while the pointer is actually over one of the arrows
//    or strip buttons (see move-hud.js). forward:true is what still delivers mousemove to the
//    renderer while click-through, which is how it knows.
//  - it FOLLOWS the aura. widgetManager broadcasts every move of the aura window (drag, nudge,
//    Reset) and main.js calls reframe() so the frame tracks it.
//
// MARGIN is the room each edge leaves for a ~40px arrow; STRIP_H is the control strip under the
// aura. Both are also hard-coded in move-hud.css - keep them in step.
const MARGIN = 46;
const STRIP_H = 132;

let win = null;

function frameBounds(auraBounds) {
  return {
    x: Math.round(auraBounds.x - MARGIN),
    y: Math.round(auraBounds.y - MARGIN),
    width: Math.round(auraBounds.width + MARGIN * 2),
    height: Math.round(auraBounds.height + MARGIN * 2 + STRIP_H),
  };
}

function createWindow(auraBounds) {
  if (win) return win;
  const b = frameBounds(auraBounds);

  win = new BrowserWindow({
    ...b,
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
  win.setIgnoreMouseEvents(true, { forward: true }); // click-through until the renderer says otherwise
  win.on('system-context-menu', (event) => event.preventDefault());
  win.loadFile(path.join(__dirname, '..', 'renderer', 'move-hud', 'index.html'));
  win.on('closed', () => { win = null; });
  return win;
}

// auraBounds: { x, y, width, height } of the aura window being positioned.
function open(auraBounds, meta) {
  if (!auraBounds) return;
  const w = createWindow(auraBounds);
  const send = () => {
    if (w.isDestroyed()) return;
    w.setBounds(frameBounds(auraBounds));
    w.webContents.send('moveHud:frame', { aura: auraBounds, ...meta });
    w.showInactive();
  };
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
  else send();
}

function reframe(auraBounds, meta) {
  if (!win || win.isDestroyed() || !auraBounds) return;
  win.setBounds(frameBounds(auraBounds));
  win.webContents.send('moveHud:frame', { aura: auraBounds, ...meta });
}

function setInteractive(interactive) {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(!interactive, { forward: true });
}

function close() {
  if (win && !win.isDestroyed()) win.hide();
}

function isOpen() {
  return !!(win && !win.isDestroyed() && win.isVisible());
}

module.exports = { open, reframe, setInteractive, close, isOpen, frameBounds, MARGIN, STRIP_H };
