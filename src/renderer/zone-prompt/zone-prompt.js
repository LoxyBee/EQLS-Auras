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
// ~104 zones unfiltered, which renders fine.
//
// A non-empty query goes through the main process (searchZones) so it can union the plain
// display-name substring match with community nicknames, raid-boss names and client short names
// (#30). It is async, so a race token drops a stale result when the user keeps typing.
let renderToken = 0;
async function render() {
  const query = searchEl.value.trim();
  const myToken = ++renderToken;
  const matches = query ? await window.eqZonePrompt.searchZones(query) : allZones;
  if (myToken !== renderToken) return; // superseded by a newer keystroke
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
  // Both action buttons stay visible in every mode (Shara, 28 Aug 2026). They were previously
  // hidden outside 'destination' mode on the reasoning that "stop tracking" / "fix current zone"
  // don't apply to the current-zone question - but a control vanishing between prompts reads as a
  // bug, and "Stop tracking" still clears the destination and closes the popup from here too.
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
