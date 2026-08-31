// The move HUD renderer - a plain detached panel. The window (moveHudWindow.js) clamps itself back
// on screen after every drag, so nothing here has to worry about it going missing. The panel body
// is -webkit-app-region:drag; every control is no-drag (see move-hud.css).

const nameEl = document.getElementById('aura-name');
const coordsEl = document.getElementById('coords');
const step1El = document.getElementById('step-1');
const step10El = document.getElementById('step-10');
const snapOnEl = document.getElementById('snap-on');
const snapSizeEl = document.getElementById('snap-size');

let stepPx = 1;

window.eqMoveHud.onFrame((payload) => {
  const a = payload.aura || {};
  if (payload.name != null) nameEl.textContent = payload.name || 'Aura';
  if (typeof a.x === 'number') coordsEl.textContent = `x: ${a.x}  y: ${a.y}`;
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

document.getElementById('nudge-up').addEventListener('click', () => window.eqMoveHud.nudge(0, -stepPx));
document.getElementById('nudge-down').addEventListener('click', () => window.eqMoveHud.nudge(0, stepPx));
document.getElementById('nudge-left').addEventListener('click', () => window.eqMoveHud.nudge(-stepPx, 0));
document.getElementById('nudge-right').addEventListener('click', () => window.eqMoveHud.nudge(stepPx, 0));
document.getElementById('reset-pos').addEventListener('click', () => window.eqMoveHud.resetPosition());
document.getElementById('done').addEventListener('click', () => window.eqMoveHud.done());
