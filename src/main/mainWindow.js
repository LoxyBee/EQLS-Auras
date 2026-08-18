const path = require('path');
const { app, BrowserWindow } = require('electron');

let mainWindow = null;

function createMainWindow() {
  if (mainWindow) {
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    width: 900,
    height: 650,
    minWidth: 640,
    minHeight: 480,
    title: 'EQLS Auras',
    // Frameless so the renderer can draw its own themed title bar (see
    // index.html's .title-bar) instead of the OS default, which can't be
    // recoloured to match the app's palette. backgroundColor matches
    // --bg so there's no white flash before the page's own CSS loads.
    frame: false,
    backgroundColor: '#14100b',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload-main.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'main-window', 'index.html'));

  // The custom title bar's maximize/restore button needs to know which
  // icon to show, including when the window is maximized/restored some
  // other way (double-clicking the drag region, a Windows snap gesture,
  // Win+Up) - not just from its own click.
  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximized'));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:unmaximized'));

  // The main window is the only window with any visible chrome (title bar,
  // taskbar entry) - overlay widgets are frameless, skipTaskbar, and often
  // click-through, so a user has no way to see or close them individually.
  // Relying on Electron's default "quit once every window is closed"
  // behavior left the whole process running invisibly forever if any
  // widget was still open when the main window closed, with no taskbar
  // icon, tray icon, or exit button anywhere to stop it. Closing the main
  // window now always quits the app outright, tearing down every widget
  // window along with it - "close the one visible window" and "quit the
  // app" are the same action from the user's side of the click-through
  // overlay, and should behave the same.
  mainWindow.on('close', () => {
    app.quit();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  return mainWindow;
}

function getMainWindow() {
  return mainWindow;
}

module.exports = { createMainWindow, getMainWindow };
