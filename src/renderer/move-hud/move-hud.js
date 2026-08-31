// The move HUD renderer. See moveHudWindow.js for the window and why it starts click-through.
//
// Click-through management: the window is created with setIgnoreMouseEvents(true, {forward:true}),
// so it never blocks the aura's blue drag box behind it - but forward:true still delivers
// mousemove here. On every move we look at what's under the pointer: over a .hud-interactive
// element -> ask main to make the window interactive so the click lands; anywhere else -> back to
// click-through so a drag falls through to the aura.

const holeEl = document.getElementById('hole');
const nameEl = document.getElementById('aura-name');
const coordsEl = document.getElementById('coords');
const step1El = document.getElementById('step-1');
const step10El = document.getElementById('step-10');
const snapOnEl = document.getElementById('snap-on');
const snapSizeEl = document.getElementById('snap-size');

let stepPx = 1;

window.eqMoveHud.onFrame((payload) => {
  const a = payload.aura || {};
  // Size the see-through hole to the aura, so the dashed outline lines up with the real window.
  holeEl.style.top = `${payload.marginPx ?? 46}px`;
  holeEl.style.left = `${payload.marginPx ?? 46}px`;
  holeEl.style.right = `${payload.marginPx ?? 46}px`;
  holeEl.style.bottom = `${payload.marginPx ?? 46}px`;
  if (payload.name != null) nameEl.textContent = payload.name || 'Aura';
  if (typeof a.x === 'number') coordsEl.textContent = `x: ${a.x}  y: ${a.y}`;
  if (typeof payload.stepPx === 'number' && payload.stepPx !== stepPx) setStep(payload.stepPx, false);
  if (typeof payload.snapEnabled === 'boolean') snapOnEl.checked = payload.snapEnabled;
  if (payload.snapSizePx != null) snapSizeEl.value = String(payload.snapSizePx);
});

function pushSnap() {
  window.eqMoveHud.setSnap(snapOnEl.checked, Number(snapSizeEl.value));
}
snapOnEl.addEventListener('change', pushSnap);
snapSizeEl.addEventListener('change', pushSnap);

function setStep(px, tell = true) {
  stepPx = px === 10 ? 10 : 1;
  step1El.classList.toggle('is-on', stepPx === 1);
  step10El.classList.toggle('is-on', stepPx === 10);
  if (tell) window.eqMoveHud.setStep(stepPx);
}

step1El.addEventListener('click', () => setStep(1));
step10El.addEventListener('click', () => setStep(10));

document.getElementById('nudge-up').addEventListener('click', () => window.eqMoveHud.nudge(0, -stepPx));
document.getElementById('nudge-down').addEventListener('click', () => window.eqMoveHud.nudge(0, stepPx));
document.getElementById('nudge-left').addEventListener('click', () => window.eqMoveHud.nudge(-stepPx, 0));
document.getElementById('nudge-right').addEventListener('click', () => window.eqMoveHud.nudge(stepPx, 0));
document.getElementById('reset-pos').addEventListener('click', () => window.eqMoveHud.resetPosition());
document.getElementById('done').addEventListener('click', () => window.eqMoveHud.done());

// --- click-through toggle -----------------------------------------------------------------------
let interactive = false;
function setInteractive(on) {
  if (on === interactive) return;
  interactive = on;
  window.eqMoveHud.setInteractive(on);
}
document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  setInteractive(!!(el && el.closest('.hud-interactive')));
});
// A pointer that leaves the window entirely never fires another mousemove - make sure we don't
// stay stuck interactive (which would keep the aura's drag box blocked).
document.addEventListener('mouseleave', () => setInteractive(false));
