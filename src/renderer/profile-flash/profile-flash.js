'use strict';
// The brief "you switched to <loadout>" banner. Runs the fade animation, then tells the main
// process to hide the window (a main-side timer hides it anyway if this never lands).
const flash = document.getElementById('flash');
const nameEl = document.getElementById('name');

window.eqProfileFlash.onShow((name) => {
  nameEl.textContent = String(name || '');
  // Restart the animation from scratch even if a previous flash is still playing.
  flash.classList.remove('play');
  void flash.offsetWidth; // reflow, so re-adding the class re-triggers the animation
  flash.classList.add('play');
});

flash.addEventListener('animationend', () => {
  flash.classList.remove('play');
  window.eqProfileFlash.done();
});
