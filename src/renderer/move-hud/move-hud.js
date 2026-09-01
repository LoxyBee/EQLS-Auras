// The move HUD renderer - a small detached control panel.
//
//  - 'single' mode ("Move…" on one aura or action bar): a nudge pad, a live x/y readout, step
//    size, snap-to-grid, Reset position, Done. The main window is hidden while it is up.
//  - 'all' mode ("Unlock all auras"): the nudge arrows are on each aura's own blue box, so this
//    panel drops the pad and the coords and is just the shared step / snap controls + Lock all.
//
// The window (moveHudWindow.js) clamps itself back on screen after every drag. Body is
// -webkit-app-region:drag; every control is no-drag (see move-hud.css).

const panelEl = document.getElementById('panel');
const nameEl = document.getElementById('aura-name');
const coordsEl = document.getElementById('coords');
const step1El = document.getElementById('step-1');
const step10El = document.getElementById('step-10');
const snapOnEl = document.getElementById('snap-on');
const snapSizeEl = document.getElementById('snap-size');
const doneEl = document.getElementById('done');
const resetEl = document.getElementById('reset-pos');

let stepPx = 1;

window.eqMoveHud.onFrame((payload) => {
  const a = payload.aura || {};
  const all = payload.mode === 'all';
  panelEl.dataset.mode = all ? 'all' : 'single';

  nameEl.textContent = all ? 'Positioning all auras' : (payload.name || 'Aura');
  coordsEl.textContent = !all && typeof a.x === 'number' ? `x: ${a.x}  y: ${a.y}` : '';
  resetEl.style.display = all ? 'none' : '';
  doneEl.textContent = all ? 'Lock all auras' : 'Done';

  if (typeof payload.stepPx === 'number' && payload.stepPx !== stepPx) setStep(payload.stepPx, false);
  if (typeof payload.snapEnabled === 'boolean') snapOnEl.checked = payload.snapEnabled;
  if (payload.snapSizePx != null) snapSizeEl.value = String(payload.snapSizePx);
});

function setStep(px, tell = true) {
  stepPx = px === 10 ? 10 : 1;
  step1El.classList.toggle('is-on', stepPx === 1);
  step10El.classList.toggle('is-on', stepPx === 10);
  if (tell) window.eqMoveHud.setStep(stepPx);
}
step1El.addEventListener('click', () => setStep(1));
step10El.addEventListener('click', () => setStep(10));

function pushSnap() {
  window.eqMoveHud.setSnap(snapOnEl.checked, Number(snapSizeEl.value));
}
snapOnEl.addEventListener('change', pushSnap);
snapSizeEl.addEventListener('change', pushSnap);

// The pad only nudges the single-mode target (an action bar has no per-box arrows of its own).
document.getElementById('nudge-up').addEventListener('click', () => window.eqMoveHud.nudge(0, -stepPx));
document.getElementById('nudge-down').addEventListener('click', () => window.eqMoveHud.nudge(0, stepPx));
document.getElementById('nudge-left').addEventListener('click', () => window.eqMoveHud.nudge(-stepPx, 0));
document.getElementById('nudge-right').addEventListener('click', () => window.eqMoveHud.nudge(stepPx, 0));
resetEl.addEventListener('click', () => window.eqMoveHud.resetPosition());
doneEl.addEventListener('click', () => window.eqMoveHud.done());
