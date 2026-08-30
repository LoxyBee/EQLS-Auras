const dragBarEl = document.getElementById('drag-bar');
const searchEl = document.getElementById('zone-search');
const listEl = document.getElementById('zone-list');
const cancelEl = document.getElementById('zone-cancel');
const stopTrackingEl = document.getElementById('zone-stop-tracking');
const fixCurrentEl = document.getElementById('zone-fix-current');

// Keyed by the same `mode` main.js's pendingZonePrompt carries - see travel:resolveZonePrompt.
const TITLES = {
  destination: 'Where are you going?',
  currentZone: 'Where are you now?',
};

let allZones = [];
let currentMode = null;

// No result cap: if a match is a real zone it is always listed (QOL-BACKLOG #31). The list is
// ~104 zones unfiltered, which renders fine; nicknames/shorthand are a separate feature (#30)
// and deliberately do not appear here.
function render() {
  const query = searchEl.value.trim().toLowerCase();
  const matches = query ? allZones.filter((z) => z.toLowerCase().includes(query)) : allZones;
  listEl.innerHTML = '';
  for (const zone of matches) {
    const btn = document.createElement('button');
    btn.className = 'zone-option';
    btn.textContent = zone;
    btn.addEventListener('click', () => {
      if (currentMode) window.eqZonePrompt.resolvePrompt(currentMode, zone);
    });
    listEl.appendChild(btn);
  }
  if (!matches.length) {
    const none = document.createElement('div');
    none.className = 'zone-none';
    none.textContent = 'No zone matches that';
    listEl.appendChild(none);
  }
}

// Reset the filter whenever the prompt switches to a different question - a destination search
// left over from the last prompt would be a confusing starting point for "where are you now".
function applyPrompt(prompt) {
  const mode = prompt ? prompt.mode : null;
  if (mode !== currentMode) searchEl.value = '';
  currentMode = mode;
  dragBarEl.textContent = (mode && TITLES[mode]) || 'Which zone?';
  // Stopping tracking only means anything for a destination - "stop knowing where I am" isn't a
  // real action, the app just doesn't know until the next zone line either way. Same reasoning
  // for the "fix current zone" shortcut - already ON the current-zone picker, it would be
  // pointless.
  stopTrackingEl.style.display = mode === 'destination' ? '' : 'none';
  fixCurrentEl.style.display = mode === 'destination' ? '' : 'none';
  render();
}

searchEl.addEventListener('input', render);
cancelEl.addEventListener('click', () => window.eqZonePrompt.dismissPrompt());
stopTrackingEl.addEventListener('click', () => window.eqZonePrompt.stopTracking());
fixCurrentEl.addEventListener('click', () => window.eqZonePrompt.correctCurrentZone());

window.eqZonePrompt.getZoneNames().then((zones) => {
  allZones = zones;
  render();
});
window.eqZonePrompt.getPrompt().then(applyPrompt);
window.eqZonePrompt.onPromptChanged(applyPrompt);
