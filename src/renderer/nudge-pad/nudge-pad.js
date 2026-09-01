// The per-aura nudge pad renderer. The aura id is in the query string (same idiom as the overlay
// window). Each arrow nudges that one aura by the shared step size (1 or 10 px), pushed from the
// move HUD via widget:nudgeStep and read once on load.

const widgetId = new URLSearchParams(window.location.search).get('widgetId');
let stepPx = 1;

for (const btn of document.querySelectorAll('.nudge')) {
  btn.addEventListener('click', () => {
    window.eqNudgePad.nudge(widgetId, Number(btn.dataset.dx) * stepPx, Number(btn.dataset.dy) * stepPx);
  });
}

window.eqNudgePad.onStep((px) => { stepPx = Number(px) === 10 ? 10 : 1; });
window.eqNudgePad.getStep().then((px) => { stepPx = Number(px) === 10 ? 10 : 1; });
