const path = require('path');
const { app, BrowserWindow, screen } = require('electron');
const { loadJson, saveJson } = require('./store');

let mainWindow = null;

// Set true only by app.quit() actually starting (see the 'before-quit' listener below), which
// fires before any window's own 'close' event - so the close handler can tell "the user clicked
// the window's own close button" (hide to tray) apart from "the app is genuinely quitting"
// (let it close for real). Requested directly, once a tray icon existed to make "hide" recoverable
// from: before this, closing the window WAS the only quit path (see that handler's own history),
// which is exactly why hiding here used to be unsafe.
let isQuitting = false;
app.on('before-quit', () => {
  isQuitting = true;
});

const DEFAULT_BOUNDS = { width: 900, height: 650 };

// Restores the window to wherever it was last, but only if that position is
// still on a screen that currently exists - otherwise a window saved on a
// second monitor that's since been unplugged would reopen off-screen with no
// way to reach it (the same failure the per-aura "Reset position" button
// exists to recover from). Falls back to the default size, centred.
function restoredBounds() {
  const saved = loadJson('mainWindowBounds', null);
  if (!saved || typeof saved.width !== 'number' || typeof saved.height !== 'number') {
    return { ...DEFAULT_BOUNDS };
  }
  const bounds = {
    width: Math.max(640, saved.width),
    height: Math.max(480, saved.height),
  };
  if (typeof saved.x === 'number' && typeof saved.y === 'number') {
    // Visible if the saved top-left sits inside any current display's work
    // area - checking a corner rather than full containment so a window
    // deliberately hanging off an edge still comes back where it was.
    const onScreen = screen.getAllDisplays().some(({ workArea }) => {
      return (
        saved.x >= workArea.x &&
        saved.y >= workArea.y &&
        saved.x < workArea.x + workArea.width &&
        saved.y < workArea.y + workArea.height
      );
    });
    if (onScreen) {
      bounds.x = saved.x;
      bounds.y = saved.y;
    }
  }
  return bounds;
}

function createMainWindow() {
  if (mainWindow) {
    // .show() as well as .focus() - this is also the tray icon's own "Show EQLS Auras" path now,
    // and the window may be hidden (not destroyed) rather than merely unfocused.
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  mainWindow = new BrowserWindow({
    ...restoredBounds(),
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
      // App text size (see applyUiScale in main.js). Set HERE, at web-contents creation, rather
      // than after the page loads. Two reasons, and the second is the important one:
      //   - applying it post-load means the window paints at 100% and then jumps, which looks
      //     like a bug even though it is only late;
      //   - a post-load listener has to be `.once`, and `.once` does not re-arm - so Ctrl+R
      //     (kept alive deliberately for testing, see the View menu note in main.js) would
      //     silently drop the window back to 100% with the setting still reading correctly.
      // Clamping stays in main.js so the bounds are defined in exactly one place; a junk value
      // here would only mean an odd first paint, corrected the moment the setting is touched.
      zoomFactor: (Number(loadJson('uiScale', 100)) || 100) / 100,
    },
  });

  // Renderer console, forwarded to stdout, ONLY when EQLS_SMOKE is set. Off in every normal
  // launch, so it costs a shipped build nothing.
  //
  // It exists because a green test suite is not a rendered panel. No unit test in this project
  // starts Electron, so a renderer that throws on load - a missing element, a temporal dead zone,
  // a typo in an event name - produces a blank page and a completely green `node test/run.js`.
  // That exact failure has now cost this ecosystem several days across two codebases. With this,
  // tools/smoke-render.js can see what the page actually said.
  if (process.env.EQLS_SMOKE) {
    mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
      const where = sourceId ? ` (${String(sourceId).split(/[\/]/).pop()}:${line})` : '';
      process.stdout.write(`RENDERER[${level}] ${message}${where}
`);
    });
    mainWindow.webContents.on('render-process-gone', (_e, details) => {
      process.stdout.write(`RENDERER GONE: ${JSON.stringify(details)}
`);
    });
  }

  // EQLS_SMOKE=lockouts additionally drives ONE fixed, read-only probe once the page has loaded:
  // open the Lockouts tab and report what actually rendered. The string below is a constant in
  // this file - nothing external is evaluated - and it only runs when the variable is set by
  // tools/smoke-render.js.
  //
  // It exists because "the page loaded without errors" and "the panel rendered" are different
  // claims, and only the second one is worth anything.
  if (process.env.EQLS_SMOKE === 'lockouts') {
    mainWindow.webContents.once('did-finish-load', () => {
      const probe = `
        (async () => {
          const btn = document.getElementById('lockouts-nav-btn');
          if (!btn) return 'PROBE: no lockouts nav button';
          btn.click();
          await new Promise((r) => setTimeout(r, 6000));
          const page = document.getElementById('page-lockouts');
          const rows = document.querySelectorAll('#lockout-grid tr').length;
          const cells = document.querySelectorAll('#lockout-grid td').length;
          const states = {};
          for (const td of document.querySelectorAll('#lockout-grid td')) {
            for (const c of td.classList) {
              if (c.indexOf('lockout-') === 0 && c !== 'lockout-cell') states[c] = (states[c] || 0) + 1;
            }
          }
          return 'PROBE: visible=' + (page && page.classList.contains('active')) +
                 ' rows=' + rows + ' cells=' + cells +
                 ' states=' + JSON.stringify(states) +
                 ' summary=' + JSON.stringify((document.getElementById('lockout-summary')||{}).textContent || '') +
                 ' scan=' + JSON.stringify((document.getElementById('lockout-scan-status')||{}).textContent || '');
        })()
      `;
      mainWindow.webContents
        .executeJavaScript(probe)
        .then((r) => process.stdout.write(`RENDERER[1] ${r}
`))
        .catch((e) => process.stdout.write(`RENDERER[3] PROBE THREW: ${e && e.message}
`));
    });
  }

  // EQLS_SMOKE=rotation opens Setup and reports the weekly-archive card: whether the control is
  // there, what it says, and what the main process answers when asked for its status.
  //
  // READ-ONLY, and that is not incidental. This feature's whole job is emptying the user's game
  // log, and EverQuest is running on this machine with a live log of its own. The probe reads the
  // checkbox, it never toggles it, and it never asks for a rotation. The periodic check runs a
  // minute after launch while tools/smoke-render.js holds for twenty-two seconds, so a smoke run
  // cannot reach a real rotation either - which is deliberate, not luck.
  if (process.env.EQLS_SMOKE === 'rotation') {
    mainWindow.webContents.once('did-finish-load', () => {
      const probe = `
        (async () => {
          const nav = document.querySelector('.nav-btn[data-page="page-settings"]');
          if (!nav) return 'PROBE: no Setup nav button';
          nav.click();
          await new Promise((r) => setTimeout(r, 2500));
          const box = document.getElementById('log-rotation-checkbox');
          const status = document.getElementById('log-rotation-status');
          // Wait for the periodic check to have actually happened, rather than reporting on a
          // status that has not been asked anything yet. It runs once a minute.
          let ipc = null;
          for (let i = 0; i < 75; i += 1) {
            try { ipc = await window.eqTracker.getLogRotationStatus(); } catch (e) { ipc = { error: e && e.message }; break; }
            if (ipc && ipc.lastCheck) break;
            await new Promise((r) => setTimeout(r, 1000));
          }
          // Re-open Setup now that a check has actually happened, so the line reported below is
          // the one a person arriving at the card would read - not the one drawn before the main
          // process had decided anything.
          nav.click();
          await new Promise((r) => setTimeout(r, 600));
          const page = document.getElementById('page-settings');
          return 'PROBE: setupVisible=' + (page && page.classList.contains('active')) +
                 ' checkboxPresent=' + !!box +
                 ' checked=' + (box ? box.checked : 'n/a') +
                 ' statusText=' + JSON.stringify(status ? status.textContent : null) +
                 ' ipc=' + JSON.stringify(ipc);
        })()
      `;
      mainWindow.webContents
        .executeJavaScript(probe)
        .then((r) => process.stdout.write(`RENDERER[1] ${r}` + '\n'))
        .catch((e) => process.stdout.write(`RENDERER[3] PROBE THREW: ${e && e.message}` + '\n'));
    });
  }

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'main-window', 'index.html'));

  // getNormalBounds(), not getBounds(): while maximized the latter reports the
  // full screen, so saving it would lose the size to restore down to and the
  // window would come back maximized-shaped but not maximized. Debounced
  // because 'resize' fires continuously through a drag and this writes to
  // disk.
  let saveBoundsTimer = null;
  function saveBoundsSoon() {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      saveBoundsTimer = null;
      if (!mainWindow || mainWindow.isDestroyed()) return;
      saveJson('mainWindowBounds', mainWindow.getNormalBounds());
    }, 400);
  }
  mainWindow.on('resize', saveBoundsSoon);
  mainWindow.on('move', saveBoundsSoon);

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
  // window used to always quit the app outright for exactly that reason -
  // "close the one visible window" and "quit the app" had to be the same
  // action, since nothing else could reach the process at all.
  //
  // Now that a tray icon exists (see main.js) with its own real Quit item,
  // that's no longer true, and hiding is what most tray-companion apps do -
  // requested directly, with an explicit second button for the case this
  // history exists to prevent: closing the window hides it to the tray;
  // the tray's Quit item (or anything else that calls app.quit()) is what
  // actually tears everything down, flagged via isQuitting above so this
  // handler can tell the two apart.
  mainWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    // Flush immediately - the debounced save above may still be pending, and
    // quitting would drop it, silently losing the last move the user made.
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    if (!mainWindow.isDestroyed()) saveJson('mainWindowBounds', mainWindow.getNormalBounds());
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
