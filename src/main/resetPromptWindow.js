'use strict';
const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { loadJson, saveJson } = require('./store');

// A small "reset or keep progress?" popup - one generic window, not a raid-board-specific one, so
// whatever asks next (the damage meter's own zone-re-entry question is queued as future work,
// owner's own request 13 Sep: "build once and share between both") wires into the same window
// instead of a second copy of it. The caller owns the DECISION (what "reset" and "keep" actually
// do); this module only ever shows a message and two buttons and reports back which was clicked.
//
// Same shape as ambiguousPopup.js: always-on-top, always-interactive (never click-through, unlike
// the buff overlay), focusable:false so clicking an answer can't steal focus from EQ mid-raid.
// Hidden (not destroyed) once answered, so a later question reuses the same window/reload.
let win = null;
let pending = null; // { message, resetLabel, keepLabel, onAnswer } | null

function getDefaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + Math.round(workArea.width / 2 - 170), y: workArea.y + 60 };
}

function createWindow() {
  if (win) return win;

  const pos = loadJson('resetPromptPosition', null) || getDefaultPosition();

  win = new BrowserWindow({
    width: 340,
    height: 150,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload-reset-prompt.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  win.loadFile(path.join(__dirname, '..', 'renderer', 'reset-prompt', 'index.html'));

  win.on('moved', () => {
    const [x, y] = win.getPosition();
    saveJson('resetPromptPosition', { x, y });
  });

  win.on('closed', () => {
    win = null;
  });

  return win;
}

// `onAnswer(choice)` fires with 'reset' or 'keep' - the caller decides what either one means and
// is responsible for clearing its own pending state; this module clears its own and hides.
function ask({ message, resetLabel = 'Reset', keepLabel = 'Keep progress' }, onAnswer) {
  pending = { message, resetLabel, keepLabel, onAnswer };
  const w = createWindow();
  w.webContents.send('resetPrompt:pending', getPending());
  if (w.isVisible()) return;
  if (w.webContents.isLoading()) {
    w.once('ready-to-show', () => w.showInactive());
  } else {
    w.showInactive();
  }
}

function getPending() {
  if (!pending) return null;
  return { message: pending.message, resetLabel: pending.resetLabel, keepLabel: pending.keepLabel };
}

function answer(choice) {
  const p = pending;
  pending = null;
  if (win) win.hide();
  if (p) p.onAnswer(choice);
}

module.exports = { ask, getPending, answer };
