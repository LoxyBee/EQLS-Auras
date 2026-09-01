// The per-box nudge pad renderer. The target id + kind ('widget' | 'actionBar') are in the query
// string (same idiom as the overlay window). Each arrow nudges that one thing by the shared step
// size (1 or 10 px), pushed from the move HUD via widget:nudgeStep and read once on load.

const q = new URLSearchParams(window.location.search);
const id = q.get('id');
const kind = q.get('kind') || 'widget';
let stepPx = 1;

for (const btn of document.querySelectorAll('.nudge')) {
  btn.addEventListener('click', () => {
    window.eqNudgePad.nudge(id, kind, Number(btn.dataset.dx) * stepPx, Number(btn.dataset.dy) * stepPx);
  });
}

window.eqNudgePad.onStep((px) => { stepPx = Number(px) === 10 ? 10 : 1; });
window.eqNudgePad.getStep().then((px) => { stepPx = Number(px) === 10 ? 10 : 1; });
