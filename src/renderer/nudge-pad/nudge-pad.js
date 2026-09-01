// The per-box nudge pad renderer. The target id + kind ('widget' | 'actionBar') are in the query
// string (same idiom as the overlay window). The four arrows nudge that one thing by the shared
// step size (1 or 10 px, from the move HUD via widget:nudgeStep). The centre button opens that
// aura's settings - hidden for an action bar, which has no settings page to jump to.

const q = new URLSearchParams(window.location.search);
const id = q.get('id');
const kind = q.get('kind') || 'widget';
let stepPx = 1;

for (const btn of document.querySelectorAll('.nudge')) {
  btn.addEventListener('click', () => {
    window.eqNudgePad.nudge(id, kind, Number(btn.dataset.dx) * stepPx, Number(btn.dataset.dy) * stepPx);
  });
}

if (kind === 'widget') {
  document.getElementById('open-settings').addEventListener('click', () => window.eqNudgePad.openSettings(id));
} else {
  document.getElementById('pad').classList.add('no-settings');
}

window.eqNudgePad.onStep((px) => { stepPx = Number(px) === 10 ? 10 : 1; });
window.eqNudgePad.getStep().then((px) => { stepPx = Number(px) === 10 ? 10 : 1; });
