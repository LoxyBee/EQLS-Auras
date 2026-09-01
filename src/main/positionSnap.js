// Shared snap-to-grid state for the move HUD (moveHudWindow.js). Both widgetManager (auras) and
// actionBarManager (action bars) round through this so the HUD's Snap toggle behaves identically
// for either. Only ever applied to `activeId` - the one thing currently being positioned - so a
// bulk "Unlock all" drag is never snapped. main.js owns the persisted `overlaySnapGrid` and mirrors
// it here.
let grid = { enabled: false, sizePx: 8 };
let activeId = null;
// "Unlock all auras" mode - every unlocked aura carries its own nudge arrows, so snap has to
// apply to all of them, not just the one `activeId` the single-aura move HUD tracks.
let allActive = false;

function set(cfg) {
  grid = {
    enabled: !!(cfg && cfg.enabled),
    sizePx: Math.max(2, Math.min(200, Math.round(Number(cfg && cfg.sizePx) || 8))),
  };
  return { ...grid };
}

function get() {
  return { ...grid };
}

function setActive(id) {
  activeId = id || null;
}

function setActiveAll(on) {
  allActive = !!on;
}

function snap(v) {
  return Math.round(v / grid.sizePx) * grid.sizePx;
}

// Should a move of `id` be snapped right now?
function active(id) {
  if (!grid.enabled || id == null) return false;
  return allActive || id === activeId;
}

module.exports = { set, get, setActive, setActiveAll, snap, active };
