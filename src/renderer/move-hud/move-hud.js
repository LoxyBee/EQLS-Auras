// The move HUD renderer - a small detached panel of SHARED controls (step size, snap-to-grid).
//
//  - 'single' mode ("Move…" on one aura or action bar): also shows the live x/y readout and a
//    "Reset position" button. The main window is hidden while it is up.
//  - 'all' mode ("Unlock all auras"): just the shared controls; "Done" becomes "Lock all auras".
//
// The nudge arrows are NOT here - they live in a pad window over each box (nudgePadWindow.js), so
// one aura, one bar, or all of them nudge the same way. The window (moveHudWindow.js) clamps
// itself back on screen after every drag. Body is -webkit-app-region:drag; every control is
// no-drag (see move-hud.css).

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

document.getElementById('centre-h').addEventListener('click', () => window.eqMoveHud.centre('h'));
document.getElementById('centre-v').addEventListener('click', () => window.eqMoveHud.centre('v'));
resetEl.addEventListener('click', () => window.eqMoveHud.resetPosition());
doneEl.addEventListener('click', () => window.eqMoveHud.done());
