// Persisted config for the Action Bar overlay (CLAUDE.md's "Action bar cover replacements"
// backlog entry). Deliberately its own tiny store rather than living in widgetStore.js - this
// isn't a widget/aura, it has no buffs, no source, none of that shape applies. Multiple bars are
// supported the same way multiple widgets are - a flat array of bar configs, each with its own id
// - requested directly: "add multiple action bar support... exactly the same way there is an add
// aura button and sub selections."
const crypto = require('crypto');

// The game's own action bar always holds exactly 12 buttons - confirmed directly against
// screenshots of the real bar, not a guess. What's user-adjustable is how many of those 12 sit in
// one row before the rest wrap onto a new row underneath (the game itself supports this - a bar
// can be laid out 12x1, 6x2, 4x3, etc.), not the total count.
const TOTAL_SLOTS = 12;

// One slot's shape. cooldown is null (no cooldown tracked) or
// { triggerMatch, triggerText, endedText, triggerChat, durationSec } - see
// actionBarManager.js's getPseudoWidgets for how this becomes a real detection trigger, and
// main-window.js's action-bar-cooldown modal for how it's built. There is deliberately no
// per-slot display style any more - see cooldownStyle below.
//
// bgColor is per-slot (unlike the border, which is bar-wide) - it's a stand-in for an icon, not a
// cosmetic tint, so it makes sense for each gem to pick its own (e.g. colour-coding several
// text-only gems differently). Only drawn while the slot has no icon - see actionbar.js's render.
//
// nameSizeOverride is null (use the bar-wide nameLabelSize) or a number - a per-gem escape hatch
// for the one gem whose name needs to read bigger/smaller than the rest, without having to make
// every other gem's text that size too.
//
// multiIcon/secondIconId split the gem diagonally between iconId (top-left) and secondIconId
// (bottom-right) - e.g. a buff+debuff combo icon, or two abilities sharing one hotbar slot.
// secondIconId is independent of multiIcon being on, so turning the split off and back on doesn't
// lose whatever was picked for the second half.
//
// insetPx is per-slot, not bar-wide - reported directly: the game's own hotbar sometimes draws a
// white active/toggled border right at a specific button's edge, and that's a per-ability thing,
// not a whole-bar thing. Shrinks the icon (and its cooldown wipe/pie) in from the tile's own edge
// so a ring of the real game button shows through - see actionbar.js's render for how the tile's
// own background is also cleared for this one gem once inset is in use, rather than leaving the
// dark semi-transparent calibration tint visible in that ring.
// toggleGroup/toggleName/toggleDurationSec - the "active" stance/invocation overlay. Requested
// directly: activating one stance/invocation puts every OTHER gem in the same group on cooldown
// too (mutual exclusion, matching how the game only lets one be active at a time), and the one
// actually chosen additionally draws a green "active" border on top of the ordinary cooldown
// overlay - see abilityGroups.js for the detection side and actionbar.js's render for the border.
// toggleGroup is null (an ordinary gem), 'stance', or 'invocation' - never both; toggleName is
// which specific one (e.g. "Evasive Stance") from abilityGroups.js's known list, matched against
// the real confirmed log lines ("You assume an evasive stance." / "You begin reciting the divine
// invocation.") rather than the "You begin to change your stance/invocation." precursor line,
// which never says WHICH one was picked. Stances share a fixed 6s cooldown (the game's own rule,
// not user-configurable); invocations use their own configurable toggleDurationSec per gem.
function emptySlot() {
  return {
    iconId: null,
    name: '',
    disabled: false,
    cooldown: null,
    bgColor: null,
    nameSizeOverride: null,
    multiIcon: false,
    secondIconId: null,
    insetPx: 0,
    toggleGroup: null,
    toggleName: null,
    toggleDurationSec: 6,
  };
}

// Every setting a bar carries, minus id/name/slots (added by defaultBar). Bar-wide, not per-gem -
// each of these was, at various points, explicitly requested as "one setting for the whole bar"
// rather than repeated per gem (cooldownStyle, nameLabel*, cooldownText*, border*).
const BAR_SETTING_DEFAULTS = {
  iconsPerRow: TOTAL_SLOTS, // wrap width - how many slots show per row before wrapping
  iconSize: 40, // px, the size of one slot at 100% scale
  marginPx: 2, // gap between slots
  position: null, // {x,y} - null until first placed
  visible: true,
  opacity: 1,
  // Loadout-profile scoping, same fields/meaning as a widget's own (widgetStore.js) -
  // showOnAllProfiles true means every profile, present and future; activeProfileIds is only
  // consulted when that's false. Defaults to true (not empty-means-hidden, the way a freshly
  // created widget works) specifically so an existing bar loaded from before this feature existed
  // doesn't silently vanish - see actionBarManager.createBar for the real "show only on the
  // profile I was on when I made this" default a NEW bar gets instead.
  showOnAllProfiles: true,
  activeProfileIds: [],
  // Per-bar override of the app-focused auto-hide rule - deliberately NOT the same shared global
  // flag widgets/auras use (settings:setShowAurasWhenAppFocused). Shara: toggling it while
  // configuring one bar was making every bar reappear, because it lived inside a per-bar panel but
  // acted globally. Defaults false to match that global flag's own default.
  showWhenAppFocused: false,
  slotCount: TOTAL_SLOTS, // how many of the 12 storage slots are actually active/shown, 1-12
  // Shade style and the countdown number are independent now, not one 3-way radio - requested
  // directly: "wipe and cooldown number should be separate things." cooldownStyle used to also
  // include 'number' as a value (meaning "no shade, just the number") - _normalizeBar below
  // migrates any bar saved with that old value into cooldownStyle:'none' +
  // cooldownShowNumber:true, so an existing bar's actual on-screen look never changes just from
  // this split landing.
  cooldownStyle: 'wipe', // 'none' | 'wipe' | 'radial' - the darkening overlay, or no shade at all
  cooldownShowNumber: false, // the countdown text, independent of whether a shade is also shown
  nameLabelSize: 11,
  nameLabelAnchor: 'bottom-center',
  nameLabelColor: '#f0f1f5',
  nameLabelWrap: true,
  cooldownTextSize: 13,
  cooldownTextAnchor: 'middle-center',
  cooldownTextColor: '#ffffff',
  cooldownTextWrap: false,
  cooldownReplacesLabel: true,
  borderWidthPx: 2,
  borderOffsetPx: 1,
  borderColor: '#d2d6e1',
};

function defaultBar(id, name) {
  return {
    id,
    name: name || 'Action Bar',
    ...BAR_SETTING_DEFAULTS,
    slots: Array.from({ length: TOTAL_SLOTS }, emptySlot),
  };
}

class ActionBarStore {
  constructor({ loadJson, saveJson }) {
    this.loadJson = loadJson;
    this.saveJson = saveJson;
    this.bars = this._load();
    this._save();
  }

  // New multi-bar file if present; otherwise migrates the old single-bar file (actionBar.json,
  // from before multiple bars existed) into a one-item array; otherwise starts with one default
  // bar. Same "old data loads without a migration flag" convention as buffStore's
  // currentlyMemorized loader - nothing to remember to bump, just tolerate every shape once.
  _load() {
    const multi = this.loadJson('actionBars', null);
    if (multi && Array.isArray(multi.bars) && multi.bars.length > 0) {
      return multi.bars.map((b) => this._normalizeBar(b));
    }
    const legacy = this.loadJson('actionBar', null);
    if (legacy && typeof legacy === 'object') {
      return [this._normalizeBar({ id: crypto.randomUUID(), name: 'Action Bar', ...legacy })];
    }
    return [defaultBar(crypto.randomUUID(), 'Action Bar 1')];
  }

  _normalizeBar(b) {
    const merged = { ...defaultBar(b.id || crypto.randomUUID(), b.name), ...b };
    // Migrates the old 3-way cooldownStyle radio ('wipe'|'number'|'radial') into the two
    // independent settings it split into - see BAR_SETTING_DEFAULTS's own comment. Only fires for
    // a bar saved before the split (cooldownShowNumber absent from the raw saved object) with the
    // old 'number' value specifically, so this can only ever run once per bar and never touches a
    // bar that's already been through it or was created fresh with the new shape.
    if (b.cooldownStyle === 'number' && b.cooldownShowNumber === undefined) {
      merged.cooldownStyle = 'none';
      merged.cooldownShowNumber = true;
    }
    merged.slots = this._normalizeSlots(merged.slots);
    return merged;
  }

  // Tolerates the earlier, simpler slot shape (a plain array of iconId-or-null) from before slots
  // grew name/disabled/cooldown/bgColor/nameSizeOverride.
  _normalizeSlots(slots) {
    const arr = Array.isArray(slots) ? slots : [];
    const out = [];
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      const s = arr[i];
      if (s && typeof s === 'object') {
        out.push({
          iconId: s.iconId == null ? null : Math.round(Number(s.iconId)),
          name: typeof s.name === 'string' ? s.name : '',
          disabled: !!s.disabled,
          cooldown: s.cooldown && typeof s.cooldown === 'object' ? s.cooldown : null,
          bgColor: typeof s.bgColor === 'string' && s.bgColor ? s.bgColor : null,
          nameSizeOverride: typeof s.nameSizeOverride === 'number' ? s.nameSizeOverride : null,
          multiIcon: !!s.multiIcon,
          secondIconId: s.secondIconId == null ? null : Math.round(Number(s.secondIconId)),
          insetPx: typeof s.insetPx === 'number' ? Math.max(0, Math.min(15, Math.round(s.insetPx))) : 0,
          toggleGroup: s.toggleGroup === 'stance' || s.toggleGroup === 'invocation' ? s.toggleGroup : null,
          toggleName: typeof s.toggleName === 'string' && s.toggleName ? s.toggleName : null,
          toggleDurationSec:
            typeof s.toggleDurationSec === 'number' ? Math.max(1, Math.min(120, Math.round(s.toggleDurationSec))) : 6,
        });
      } else {
        out.push({ ...emptySlot(), iconId: typeof s === 'number' ? s : null });
      }
    }
    return out;
  }

  getAll() {
    return this.bars.map((b) => ({ ...b }));
  }

  getById(id) {
    const bar = this.bars.find((b) => b.id === id);
    return bar ? { ...bar } : null;
  }

  create(name) {
    const bar = defaultBar(crypto.randomUUID(), name || `Action Bar ${this.bars.length + 1}`);
    this.bars.push(bar);
    this._save();
    return { ...bar };
  }

  remove(id) {
    const before = this.bars.length;
    this.bars = this.bars.filter((b) => b.id !== id);
    this._save();
    return this.bars.length !== before;
  }

  update(id, patch) {
    const bar = this.bars.find((b) => b.id === id);
    if (!bar) return null;
    Object.assign(bar, patch);
    this._save();
    return { ...bar };
  }

  savePosition(id, pos) {
    const bar = this.bars.find((b) => b.id === id);
    if (!bar) return;
    bar.position = pos;
    this._save();
  }

  _save() {
    this.saveJson('actionBars', { bars: this.bars });
  }
}

module.exports = { ActionBarStore, BAR_SETTING_DEFAULTS, TOTAL_SLOTS, emptySlot, defaultBar };
