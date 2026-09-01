'use strict';
// The faint full-screen alignment grid shown while a move HUD is open and snap-to-grid is on.
// Extracted from an inline <script> so the page can carry a strict script-src 'self' CSP.
const el = document.getElementById('grid');
window.eqGridGuide.onSize((px) => el.style.setProperty('--g', px + 'px'));
