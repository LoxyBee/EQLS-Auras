// The move HUD renderer - a small detached panel of SHARED controls (owner's "B1" layout, 16 Oct).
//
//  - 'single' mode ("Move…" on one aura or action bar): the live x/y readout, Centre and Reset.
//    The main window is hidden while it is up.
//  - 'all' mode ("Unlock all auras"): just the shared controls; "Done" becomes "Lock all auras".
//  - a linked-folder move ("Move together") adds the Moves: Group | One choice and the Alt tip.
//
// The nudge arrows are NOT here - they live in a pad window over each box (nudgePadWindow.js). The
// window is sized to fit #panel: every time the panel's size changes it is reported to main
// (moveHudWindow.fitTo), so the border always hugs the buttons. Body is -webkit-app-region:drag;
// every control is no-drag (see move-hud.css).

const panelEl = document.getElementById('panel');
const nameEl = document.getElementById('aura-name');
const linkEl = document.getElementById('group-link');
const coordsEl = document.getElementById('coords');
const step1El = document.getElementById('step-1');
const step10El = document.getElementById('step-10');
const gridButtons = [...document.querySelectorAll('#grid-seg button')];
const doneEl = document.getElementById('done');
const resetEl = document.getElementById('reset-pos');
const groupRowEl = document.getElementById('group-row');
const altTipEl = document.getElementById('alt-tip');
const groupModeGroupEl = document.getElementById('group-mode-group');
const groupModeSingleEl = document.getElementById('group-mode-single');
const undoEl = document.getElementById('undo');
const redoEl = document.getElementById('redo');

let stepPx = 1;
let snapEnabled = false;
let snapSizePx = 8;

window.eqMoveHud.onFrame((payload) => {
  const a = payload.aura || {};
  const all = payload.mode === 'all';
  panelEl.dataset.mode = all ? 'all' : 'single';

  // A linked-folder move ("Move together"): the title is the folder, with the link mark.
  const g = !all && payload.group ? payload.group : null;
  groupRowEl.style.display = g ? '' : 'none';
  linkEl.style.display = g ? '' : 'none';
  altTipEl.style.display = g && g.mode === 'group' ? '' : 'none';
  if (g) {
    groupModeGroupEl.classList.toggle('is-on', g.mode === 'group');
    groupModeSingleEl.classList.toggle('is-on', g.mode === 'single');
  }
  nameEl.textContent = all ? 'Positioning all auras' : g && g.mode === 'group' ? g.name : (payload.name || 'Aura');
  coordsEl.textContent = !all && typeof a.x === 'number' ? `${a.x}, ${a.y}` : '';
  doneEl.textContent = all ? 'Lock all auras' : 'Done';
  undoEl.disabled = !payload.canUndo;
  redoEl.disabled = !payload.canRedo;

  if (typeof payload.stepPx === 'number' && payload.stepPx !== stepPx) setStep(payload.stepPx, false);
  if (typeof payload.snapEnabled === 'boolean') snapEnabled = payload.snapEnabled;
  if (payload.snapSizePx != null) snapSizePx = Number(payload.snapSizePx);
  paintGrid();
});

function setStep(px, tell = true) {
  stepPx = px === 10 ? 10 : 1;
  step1El.classList.toggle('is-on', stepPx === 1);
  step10El.classList.toggle('is-on', stepPx === 10);
  if (tell) window.eqMoveHud.setStep(stepPx);
}
step1El.addEventListener('click', () => setStep(1));
step10El.addEventListener('click', () => setStep(10));

// Grid: Off, or a size - one click instead of a checkbox plus a dropdown. Turning it off keeps the
// last size, so turning it back on (any size button) behaves as before.
function paintGrid() {
  for (const btn of gridButtons) {
    const size = Number(btn.dataset.grid);
    btn.classList.toggle('is-on', size === 0 ? !snapEnabled : snapEnabled && size === snapSizePx);
  }
}
for (const btn of gridButtons) {
  btn.addEventListener('click', () => {
    const size = Number(btn.dataset.grid);
    snapEnabled = size > 0;
    if (size > 0) snapSizePx = size;
    paintGrid();
    window.eqMoveHud.setSnap(snapEnabled, snapSizePx);
  });
}

document.getElementById('centre-h').addEventListener('click', () => window.eqMoveHud.centre('h'));
document.getElementById('centre-v').addEventListener('click', () => window.eqMoveHud.centre('v'));
resetEl.addEventListener('click', () => window.eqMoveHud.resetPosition());
groupModeGroupEl.addEventListener('click', () => window.eqMoveHud.setGroupMode('group'));
groupModeSingleEl.addEventListener('click', () => window.eqMoveHud.setGroupMode('single'));
doneEl.addEventListener('click', () => window.eqMoveHud.done());
undoEl.addEventListener('click', () => window.eqMoveHud.undo());
redoEl.addEventListener('click', () => window.eqMoveHud.redo());
// Ctrl+Z / Ctrl+Y (and Ctrl+Shift+Z) while the panel has focus.
document.addEventListener('keydown', (e) => {
  if (!e.ctrlKey) return;
  const k = e.key.toLowerCase();
  if (k === 'z' && !e.shiftKey) window.eqMoveHud.undo();
  else if (k === 'y' || (k === 'z' && e.shiftKey)) window.eqMoveHud.redo();
  else return;
  e.preventDefault();
});

// Fit the window to the panel: its size plus the margin around it (room for the shadow).
const PANEL_MARGIN = 4;
function reportSize() {
  const r = panelEl.getBoundingClientRect();
  window.eqMoveHud.fitTo(Math.ceil(r.width) + PANEL_MARGIN * 2, Math.ceil(r.height) + PANEL_MARGIN * 2);
}
new ResizeObserver(reportSize).observe(panelEl);
