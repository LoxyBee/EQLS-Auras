// Shared snap-to-grid state for the move HUD (moveHudWindow.js). Both widgetManager (auras) and
// actionBarManager (action bars) round through this so the HUD's Snap toggle behaves identically
// for either. Only ever applied to `activeId` - the one thing currently being positioned - so a
// bulk "Unlock all" drag is never snapped. main.js owns the persisted `overlaySnapGrid` and mirrors
// it here.
let grid = { enabled: false, sizePx: 8 };
let activeId = null;

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

function snap(v) {
  return Math.round(v / grid.sizePx) * grid.sizePx;
}

// Should a move of `id` be snapped right now?
function active(id) {
  return grid.enabled && id != null && id === activeId;
}

module.exports = { set, get, setActive, snap, active };
