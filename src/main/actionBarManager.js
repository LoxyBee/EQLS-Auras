// Multiple Action Bar overlays (CLAUDE.md's "Action bar cover replacements" backlog entry) - one
// independent transparent bar of gems per instance, each sized/spaced/positioned/styled on its
// own, the same way multiple widgets/auras already work. Requested directly: "add multiple action
// bar support... exactly the same way there is an add aura button and sub selections."
//
// Far simpler windows than widgetManager.js's - there's no measured DOM content to fit around
// (fitToContent's whole reason for existing there): a bar's size is fully determined by its own
// settings (icons per row, icon size, margin, slot count), so this module computes it directly.
const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { ActionBarStore, TOTAL_SLOTS } = require('./actionBarStore');
const { loadJson, saveJson } = require('./store');
const positionSnap = require('./positionSnap');

const store = new ActionBarStore({ loadJson, saveJson });

const windows = new Map(); // id -> BrowserWindow
// The move HUD (moveHudWindow.js) - fired on every move of a bar's window so the HUD's x/y readout
// keeps up. main.js wires this. movedGuard suppresses the extra 'moved' our own snap setPosition fires.
let onBarMoved = () => {};
function setOnMovedFn(fn) { if (typeof fn === 'function') onBarMoved = fn; }
const movedGuard = new Set();
// Always starts locked/click-through on launch regardless of how it was left last time - same
// safety behaviour every other overlay window in this app has (see widgetManager.js's own
// runtimeLock comment). Deliberately not persisted.
const runtimeLock = new Map(); // id -> boolean
// Runtime-only, never persisted - raw foreground-watcher state, NOT a single hidden/shown flag.
// Unlike widgetManager (whose auras all obey the one shared showAurasWhenAppFocused global
// setting), each bar has its OWN showWhenAppFocused override (actionBarStore.js), so whether a
// given bar is hidden has to be computed per-bar from this raw state rather than once globally.
// Fixes a real report: toggling the "show while app focused" checkbox for one bar was making
// every bar reappear, because it was wired to the shared global flag despite living in a per-bar
// settings panel.
let foregroundState = { autoHideEnabled: true, eqFocused: true, ownAppFocused: false };
// Note 4's temporary "clear the screen" override (Pause/Break hotkey + the top bar's "Hide auras"
// button) - deliberately not persisted, same reasoning as widgetManager's own masterHidden: a
// forgotten master-hide surviving a restart would look exactly like "all my action bars broke
// overnight." Requested directly: "the same hotkey that disables overlays needs to also pause
// action bar overlays" - main.js's toggleMasterHidden and the overlay:setMasterHidden IPC handler
// both already call widgetManager.setMasterHidden, so wiring this in here for main.js to call
// alongside it is what makes the EXISTING hotkey AND the existing top-bar button cover action
// bars too, rather than needing a second, separate control.
let masterHidden = false;

// (id) => string - which loadout profile is currently active. Injected rather than
// require('./profileStore') directly, same DI reasoning as widgetManager's own
// getActiveProfileIdFn - keeps this module's only Electron/profile coupling at the one function
// main.js wires in.
let getActiveProfileIdFn = () => null;
function setActiveProfileIdFn(fn) {
  getActiveProfileIdFn = fn;
}

// Same rule as widgetManager's isVisibleForActiveProfile: showOnAllProfiles wins outright,
// otherwise the bar only counts as visible on a profile actually ticked in activeProfileIds.
function isVisibleForActiveProfile(config) {
  if (config.showOnAllProfiles) return true;
  const ids = config.activeProfileIds || [];
  return ids.includes(getActiveProfileIdFn());
}

const PADDING_PX = 4; // outer padding so slot borders aren't clipped at the window edge

// The active slots (slotCount, 1-12 - see actionBarStore.js) wrap onto a new row once a row hits
// iconsPerRow - the window has to be sized for the whole wrapped block (every row), not just one
// row, or rows past the first would be clipped. Effective per-row is capped at slotCount itself,
// so asking for a wider wrap than there are slots doesn't leave the window oversized.
function computeSize(config) {
  const { iconSize, marginPx } = config;
  const slotCount = config.slotCount || TOTAL_SLOTS;
  const perRow = Math.max(1, Math.min(config.iconsPerRow || TOTAL_SLOTS, slotCount));
  const rows = Math.ceil(slotCount / perRow);
  const width = Math.round(perRow * iconSize + (perRow - 1) * marginPx + PADDING_PX * 2);
  const height = Math.round(rows * iconSize + (rows - 1) * marginPx + PADDING_PX * 2);
  return { width, height };
}

// Each new bar defaults a little further down/right of the last so a second (third, fourth...)
// bar doesn't land exactly on top of the first, invisible underneath it - same reasoning as
// widgetManager's getDefaultPosition, offset by how many bars already exist.
function getDefaultPosition(config) {
  const { workArea } = screen.getPrimaryDisplay();
  const { width } = computeSize(config);
  const index = store.getAll().length;
  return {
    x: workArea.x + Math.round((workArea.width - width) / 2) + index * 24,
    y: workArea.y + workArea.height - 160 - index * 24,
  };
}

function createWindow(config) {
  if (windows.has(config.id)) return windows.get(config.id);
  const pos = config.position || getDefaultPosition(config);
  const { width, height } = computeSize(config);

  const win = new BrowserWindow({
    width,
    height,
    x: pos.x,
    y: pos.y,
    frame: false,
    transparent: true,
    hasShadow: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload-actionbar.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.setAlwaysOnTop(true, 'screen-saver');
  // Same reason as widgetManager.js's identical handler - a frameless window's drag region
  // otherwise pops Windows' own system menu on right-click instead of doing nothing useful.
  win.on('system-context-menu', (event) => event.preventDefault());
  if (!runtimeLock.has(config.id)) runtimeLock.set(config.id, true);
  win.setIgnoreMouseEvents(runtimeLock.get(config.id), { forward: true });
  win.setOpacity(config.opacity ?? 1);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'actionbar', 'index.html'), {
    query: { barId: config.id },
  });

  win.once('ready-to-show', () => {
    if (shouldBeOnScreen(config.id)) win.showInactive();
  });

  win.on('moved', () => {
    if (movedGuard.has(config.id)) return;
    let [x, y] = win.getPosition();
    // Snap the drop onto the grid, but only for the bar being positioned through the move HUD.
    if (positionSnap.active(config.id) && (positionSnap.snap(x) !== x || positionSnap.snap(y) !== y)) {
      x = positionSnap.snap(x);
      y = positionSnap.snap(y);
      movedGuard.add(config.id);
      win.setPosition(x, y);
      movedGuard.delete(config.id);
    }
    store.savePosition(config.id, { x, y });
    onBarMoved(config.id, getBounds(config.id));
  });

  win.on('closed', () => {
    windows.delete(config.id);
    runtimeLock.delete(config.id);
  });

  windows.set(config.id, win);
  return win;
}

function applySize(id) {
  const win = windows.get(id);
  const config = store.getById(id);
  if (!win || !config) return;
  const { width, height } = computeSize(config);
  const [x, y] = win.getPosition();
  win.setBounds({ x, y, width, height });
}

function pushConfigChanged(id) {
  const win = windows.get(id);
  const config = store.getById(id);
  if (win && !win.isDestroyed() && config) win.webContents.send('actionBar:configChanged', withTotalSlots(config));
}

// totalSlots rides along with the config rather than being a second round trip - the renderer
// needs it to know how many slots to draw, and the settings page's slider needs it for its max.
function withTotalSlots(config) {
  return { ...config, totalSlots: TOTAL_SLOTS };
}

function getAllBars() {
  return store.getAll();
}

function getConfig(id) {
  const config = store.getById(id);
  return config ? withTotalSlots(config) : null;
}

function createBar(name) {
  let config = store.create(name);
  // Same convention every widget creation path already uses: start scoped to whichever profile
  // is active right now, not visible everywhere - showOnAllProfiles:true is reserved for a bar
  // that existed before this feature (see actionBarStore.js's own comment on the default).
  const activeProfileId = getActiveProfileIdFn();
  config = store.update(config.id, {
    showOnAllProfiles: !activeProfileId,
    activeProfileIds: activeProfileId ? [activeProfileId] : [],
  });
  createWindow(config);
  return withTotalSlots(config);
}

// Every "visual style" setting a bar carries - deliberately NOT id/name/position/visible/
// activeProfileIds/showOnAllProfiles/slots. Requested directly: "copy all visual settings from
// the chosen bar, except for the positional and slot data" - position and which gems are on it
// are specific to that one bar's own place in the world, not a look worth copying elsewhere.
// iconsPerRow is excluded for the same reason - reported live: it got copied along with the rest
// and shouldn't have, since it's part of matching THIS bar's own wrap to THIS bar's own real
// hotbar shape, not a "look" the two bars should necessarily share.
const COPYABLE_SETTING_FIELDS = [
  'iconSize',
  'marginPx',
  'opacity',
  'slotCount',
  'cooldownStyle',
  'cooldownShowNumber',
  'nameLabelSize',
  'nameLabelAnchor',
  'nameLabelColor',
  'nameLabelWrap',
  'cooldownTextSize',
  'cooldownTextAnchor',
  'cooldownTextColor',
  'cooldownTextWrap',
  'cooldownReplacesLabel',
  'borderWidthPx',
  'borderOffsetPx',
  'borderColor',
];

function copySettingsFrom(id, fromId) {
  const source = store.getById(fromId);
  if (!source || id === fromId) return store.getById(id);
  const patch = {};
  for (const field of COPYABLE_SETTING_FIELDS) patch[field] = source[field];
  store.update(id, patch);
  applySize(id);
  const win = windows.get(id);
  if (win) win.setOpacity(patch.opacity ?? 1);
  pushConfigChanged(id);
  return withTotalSlots(store.getById(id));
}

function deleteBar(id) {
  const win = windows.get(id);
  if (win) win.close();
  windows.delete(id);
  runtimeLock.delete(id);
  return store.remove(id);
}

// A full clone - every setting AND every gem - except id/name (fresh, "<name> (copy)") and
// position (offset +24/+24 so the copy isn't invisible sitting exactly on top of the original,
// same reasoning as widgetManager.duplicateWidget). Deep-copies slots explicitly rather than
// letting the reference alias between the two bars - store.getById only ever shallow-copies the
// bar object itself, so without this the original and the copy would share the same slot objects
// until the first per-slot edit happened to fork them.
function duplicateBar(id) {
  const source = store.getById(id);
  if (!source) return null;
  const created = store.create(`${source.name} (copy)`);
  const position = source.position ? { x: source.position.x + 24, y: source.position.y + 24 } : null;
  const patch = { ...source, slots: source.slots.map((s) => ({ ...s })), position };
  delete patch.id;
  delete patch.name;
  store.update(created.id, patch);
  const config = store.getById(created.id);
  createWindow(config);
  return withTotalSlots(config);
}

// Clears every gem's per-slot text-size override on this bar back to the bar-wide nameLabelSize,
// without having to open each gem's own modal and untick "Override text size" one at a time.
function clearAllTextOverrides(id) {
  const config = store.getById(id);
  if (!config) return null;
  const slots = config.slots.map((s) => (s.nameSizeOverride == null ? s : { ...s, nameSizeOverride: null }));
  store.update(id, { slots });
  pushConfigChanged(id);
  return withTotalSlots(store.getById(id));
}

function setBarName(id, name) {
  const config = store.update(id, { name: String(name || '').trim() || 'Action Bar' });
  pushConfigChanged(id);
  return config;
}

function setIconsPerRow(id, count) {
  const n = Math.max(1, Math.min(TOTAL_SLOTS, Math.round(Number(count) || 1)));
  store.update(id, { iconsPerRow: n });
  applySize(id);
  pushConfigChanged(id);
  return store.getById(id);
}

function setIconSize(id, px) {
  const n = Math.max(16, Math.min(120, Math.round(Number(px) || 40)));
  store.update(id, { iconSize: n });
  applySize(id);
  pushConfigChanged(id);
  return store.getById(id);
}


function setMarginPx(id, px) {
  const n = Math.max(0, Math.min(20, Math.round(Number(px) || 0)));
  store.update(id, { marginPx: n });
  applySize(id);
  pushConfigChanged(id);
  return store.getById(id);
}

function setOpacity(id, opacity) {
  const n = Math.max(0, Math.min(1, Number(opacity)));
  store.update(id, { opacity: n });
  const win = windows.get(id);
  if (win) win.setOpacity(n);
  pushConfigChanged(id);
  return store.getById(id);
}

function setSlotCount(id, count) {
  const n = Math.max(1, Math.min(TOTAL_SLOTS, Math.round(Number(count) || 1)));
  store.update(id, { slotCount: n });
  applySize(id);
  pushConfigChanged(id);
  return store.getById(id);
}

function setCooldownStyle(id, style) {
  const s = ['none', 'wipe', 'radial'].includes(style) ? style : 'wipe';
  store.update(id, { cooldownStyle: s });
  pushConfigChanged(id);
  return store.getById(id);
}

// Independent of setCooldownStyle above - see actionBarStore.js's own comment on why they split.
function setCooldownShowNumber(id, enabled) {
  store.update(id, { cooldownShowNumber: !!enabled });
  pushConfigChanged(id);
  return store.getById(id);
}

function setNameLabelSize(id, size) {
  const n = Math.max(6, Math.min(20, Math.round(Number(size) || 11)));
  store.update(id, { nameLabelSize: n });
  pushConfigChanged(id);
  return store.getById(id);
}

function setNameLabelAnchor(id, anchor) {
  store.update(id, { nameLabelAnchor: typeof anchor === 'string' && anchor ? anchor : 'bottom-center' });
  pushConfigChanged(id);
  return store.getById(id);
}

function setNameLabelColor(id, color) {
  store.update(id, { nameLabelColor: typeof color === 'string' && color ? color : '#f0f1f5' });
  pushConfigChanged(id);
  return store.getById(id);
}

function setNameLabelWrap(id, wrap) {
  store.update(id, { nameLabelWrap: !!wrap });
  pushConfigChanged(id);
  return store.getById(id);
}

function setCooldownTextSize(id, size) {
  const n = Math.max(6, Math.min(20, Math.round(Number(size) || 13)));
  store.update(id, { cooldownTextSize: n });
  pushConfigChanged(id);
  return store.getById(id);
}

function setCooldownTextAnchor(id, anchor) {
  store.update(id, { cooldownTextAnchor: typeof anchor === 'string' && anchor ? anchor : 'middle-center' });
  pushConfigChanged(id);
  return store.getById(id);
}

function setCooldownTextColor(id, color) {
  store.update(id, { cooldownTextColor: typeof color === 'string' && color ? color : '#ffffff' });
  pushConfigChanged(id);
  return store.getById(id);
}

function setCooldownTextWrap(id, wrap) {
  store.update(id, { cooldownTextWrap: !!wrap });
  pushConfigChanged(id);
  return store.getById(id);
}

function setCooldownReplacesLabel(id, replaces) {
  store.update(id, { cooldownReplacesLabel: !!replaces });
  pushConfigChanged(id);
  return store.getById(id);
}

function setBorderWidth(id, px) {
  const n = Math.max(1, Math.min(4, Math.round(Number(px) || 2)));
  store.update(id, { borderWidthPx: n });
  pushConfigChanged(id);
  return store.getById(id);
}

function setBorderOffset(id, px) {
  const n = Math.max(0, Math.min(6, Math.round(Number(px) || 0)));
  store.update(id, { borderOffsetPx: n });
  pushConfigChanged(id);
  return store.getById(id);
}

function setBorderColor(id, color) {
  store.update(id, { borderColor: typeof color === 'string' && color ? color : '#d2d6e1' });
  pushConfigChanged(id);
  return store.getById(id);
}

function clampSlotIndex(index) {
  return Math.max(0, Math.min(TOTAL_SLOTS - 1, Math.round(Number(index) || 0)));
}

// Shared by every per-slot setter below - copies the slots array (and each slot object inside it)
// so a mutation to one slot never touches another's reference, then writes the one slot's patch.
function updateSlot(id, index, patch) {
  const config = store.getById(id);
  if (!config) return null;
  const i = clampSlotIndex(index);
  const slots = config.slots.map((s) => ({ ...s }));
  slots[i] = { ...slots[i], ...patch };
  store.update(id, { slots });
  pushConfigChanged(id);
  return withTotalSlots(store.getById(id));
}

function setSlotIcon(id, index, iconId) {
  return updateSlot(id, index, { iconId: iconId == null ? null : Math.round(Number(iconId)) });
}

function setSlotName(id, index, name) {
  return updateSlot(id, index, { name: String(name == null ? '' : name).slice(0, 40) });
}

function setSlotDisabled(id, index, disabled) {
  return updateSlot(id, index, { disabled: !!disabled });
}

function setSlotBgColor(id, index, color) {
  return updateSlot(id, index, { bgColor: typeof color === 'string' && color ? color : null });
}

function setSlotNameSizeOverride(id, index, size) {
  const n = size == null ? null : Math.max(6, Math.min(20, Math.round(Number(size))));
  return updateSlot(id, index, { nameSizeOverride: n });
}

// Per-gem, not bar-wide - reported directly: the game's own white active/toggled border only
// shows on whichever specific button is toggled, not the whole bar, so the escape hatch to reveal
// it has to be per-gem too. Clamped to less than half the smallest allowed icon size (16px) so the
// icon can never be inset into nothing.
function setSlotInsetPx(id, index, px) {
  const n = Math.max(0, Math.min(15, Math.round(Number(px) || 0)));
  return updateSlot(id, index, { insetPx: n });
}

// Stance/invocation membership (see abilityGroups.js) - null clears both toggleName and
// toggleGroup together, since a name with no group makes no sense and would leave a stale pick
// sitting behind an unrelated future group choice.
function setSlotToggleGroup(id, index, group) {
  const clean = group === 'stance' || group === 'invocation' ? group : null;
  return updateSlot(id, index, clean ? { toggleGroup: clean } : { toggleGroup: null, toggleName: null });
}

function setSlotToggleName(id, index, name) {
  return updateSlot(id, index, { toggleName: typeof name === 'string' && name ? name : null });
}

function setSlotToggleDurationSec(id, index, sec) {
  const n = Math.max(1, Math.min(120, Math.round(Number(sec) || 6)));
  return updateSlot(id, index, { toggleDurationSec: n });
}

// Splits the gem diagonally between iconId (top-left) and secondIconId (bottom-right). The two
// are independent settings - toggling the split off and back on doesn't lose the second pick.
function setSlotMultiIcon(id, index, enabled) {
  return updateSlot(id, index, { multiIcon: !!enabled });
}

function setSlotSecondIcon(id, index, iconId) {
  return updateSlot(id, index, { secondIconId: iconId == null ? null : Math.round(Number(iconId)) });
}

function setSlotCooldown(id, index, cooldown) {
  return updateSlot(id, index, { cooldown: cooldown || null });
}

// Per-gem border, layered on top of the bar-wide one (see actionBarStore.js's own comment on
// these fields) - same width/offset/colour shape as setBorderWidth/setBorderOffset/setBorderColor
// below, just scoped to one slot via updateSlot instead of the whole bar.
function setSlotBorderEnabled(id, index, enabled) {
  return updateSlot(id, index, { borderEnabled: !!enabled });
}

function setSlotBorderWidth(id, index, px) {
  const n = Math.max(1, Math.min(4, Math.round(Number(px) || 2)));
  return updateSlot(id, index, { borderWidthPx: n });
}

function setSlotBorderOffset(id, index, px) {
  const n = Math.max(0, Math.min(6, Math.round(Number(px) || 0)));
  return updateSlot(id, index, { borderOffsetPx: n });
}

function setSlotBorderColor(id, index, color) {
  return updateSlot(id, index, { borderColor: typeof color === 'string' && color ? color : '#d2d6e1' });
}

// Feeds every bar's slot cooldowns into the SAME detection engine every widget's custom timers
// already run through (customTimerEngine.js), rather than building a second copy of trigger
// matching just for gems - see main.js's setGetWidgetsFn wiring. Each active (below slotCount),
// enabled slot with a cooldown becomes its own one-trigger pseudo-widget, keyed
// `actionBarSlot:<barId>:<index>` - unique across every bar, not just within one, now that there
// can be more than one. That key is both the pseudo-widget's id AND its one timer's id, since
// 'independent' mode (the only mode used here) keys activeTimers by the timer's own id. The
// overlay renderer matches active timers back to slots by that same key (see actionbar.js).
function getPseudoWidgets() {
  const widgets = [];
  for (const config of store.getAll()) {
    (config.slots || []).forEach((slot, i) => {
      if (i >= config.slotCount) return;
      if (!slot || slot.disabled || !slot.cooldown || !slot.cooldown.triggerText) return;
      const key = `actionBarSlot:${config.id}:${i}`;
      widgets.push({
        id: key,
        triggerCombineMode: 'independent',
        reverseDetection: false,
        customTimers: [
          {
            id: key,
            name: slot.name || `${config.name} slot ${i + 1}`,
            triggerMatch: slot.cooldown.triggerMatch,
            triggerText: slot.cooldown.triggerText,
            endedText: slot.cooldown.endedText,
            triggerChat: slot.cooldown.triggerChat,
            durationSec: slot.cooldown.durationSec,
            cooldownSec: 0,
            iconId: slot.iconId,
          },
        ],
      });
    });
  }
  return widgets;
}

// Single decision for "should this bar be on screen right now" - mirrors widgetManager's own
// shouldBeOnScreen ordering exactly: the explicit visible toggle is the ON/OFF switch, master
// hide beats even unlock (deliberately - it exists to clear the screen while doing other UI work,
// so it appearing to do nothing because a bar happened to be unlocked would make the button
// useless), THEN unlocking (move mode) beats profile scoping and auto-hide because you can't
// drag/reconfigure what you can't see, and otherwise loadout-profile membership and
// auto-hide-while-EQ-unfocused decide.
function isBarForegroundHidden(config) {
  if (!foregroundState.autoHideEnabled) return false;
  const shouldShow =
    foregroundState.eqFocused || (config.showWhenAppFocused && foregroundState.ownAppFocused);
  return !shouldShow;
}

function shouldBeOnScreen(id) {
  const config = store.getById(id);
  if (!config || !config.visible) return false;
  if (masterHidden) return false;
  if (isUnlocked(id)) return true;
  if (!isVisibleForActiveProfile(config)) return false;
  return !isBarForegroundHidden(config);
}

function setMasterHidden(hidden) {
  const next = !!hidden;
  if (next === masterHidden) return masterHidden;
  masterHidden = next;
  for (const config of store.getAll()) applyVisibility(config.id);
  return masterHidden;
}

function isMasterHidden() {
  return masterHidden;
}

function applyVisibility(id) {
  const win = windows.get(id);
  if (!win) {
    if (shouldBeOnScreen(id)) {
      const config = store.getById(id);
      if (config) createWindow(config);
    }
    return;
  }
  if (shouldBeOnScreen(id)) win.showInactive();
  else win.hide();
}

function setVisible(id, visible) {
  store.update(id, { visible: !!visible });
  applyVisibility(id);
  return store.getById(id);
}

// Profile membership IS this bar's on/off control alongside the plain visible toggle - ticking/
// unticking the currently active profile has to show/hide it immediately, same as a widget's own
// setActiveProfileIds. Touching this always clears showOnAllProfiles - once the user has made an
// explicit choice, the "unseen before, don't want to lose it" default no longer applies.
function setActiveProfileIds(id, profileIds) {
  const clean = Array.isArray(profileIds) ? profileIds.filter((p) => typeof p === 'string') : [];
  store.update(id, { activeProfileIds: clean, showOnAllProfiles: false });
  applyVisibility(id);
  pushConfigChanged(id);
  return store.getById(id);
}

// Called by main.js whenever the ACTIVE loadout profile changes - every bar's visibility depends
// on it, not just the ones the user touched.
function applyProfileVisibility() {
  for (const config of store.getAll()) {
    applyVisibility(config.id);
    pushConfigChanged(config.id);
  }
}

// Called by main.js when a profile is deleted - dropping a deleted profile can leave a bar with
// an empty activeProfileIds, which now means hidden everywhere (see isVisibleForActiveProfile),
// so visibility has to be re-applied too, not just the stale id removed.
function removeProfileFromAllBars(profileId) {
  for (const config of store.getAll()) {
    if (!(config.activeProfileIds || []).includes(profileId)) continue;
    store.update(config.id, { activeProfileIds: config.activeProfileIds.filter((p) => p !== profileId) });
  }
  applyProfileVisibility();
}

function setLocked(id, nextLocked) {
  const locked = !!nextLocked;
  runtimeLock.set(id, locked);
  const win = windows.get(id);
  if (win) {
    win.setIgnoreMouseEvents(locked, { forward: true });
    win.webContents.send('actionBar:lockChanged', locked);
  }
  // Unlocking must be able to bring the window back on screen even if auto-hide currently has it
  // hidden - same "you can't drag what you can't see" reasoning as widgetManager.setLocked.
  applyVisibility(id);
  return locked;
}

function toggleLock(id) {
  return setLocked(id, !isLocked(id));
}

function isLocked(id) {
  return runtimeLock.get(id) !== false;
}

function isUnlocked(id) {
  return runtimeLock.get(id) === false;
}

// Called by main.js's foregroundWatcher wiring, alongside widgetManager.setForegroundHidden -
// same raw signal, but unlike widgetManager each bar decides for itself via its own
// showWhenAppFocused (isBarForegroundHidden above), so this stores the raw state rather than one
// shared hidden/shown flag.
function setForegroundState(state) {
  foregroundState = state;
  for (const config of store.getAll()) applyVisibility(config.id);
}

// setShowWhenAppFocused: per-bar override, see actionBarStore.js's field comment.
function setShowWhenAppFocused(id, enabled) {
  const config = store.update(id, { showWhenAppFocused: !!enabled });
  if (config) applyVisibility(id);
  return config;
}

// Only recovery path for a bar dragged off-screen or left on a monitor that's since been
// disconnected - same convention as widgetManager.js's resetPosition.
function resetPosition(id) {
  const win = windows.get(id);
  const config = store.getById(id);
  if (!win || !config) return null;
  const pos = getDefaultPosition(config);
  win.setPosition(pos.x, pos.y);
  store.savePosition(id, pos);
  onBarMoved(id, getBounds(id));
  return store.getById(id);
}

function getBounds(id) {
  const win = windows.get(id);
  if (!win || win.isDestroyed()) return null;
  const [x, y] = win.getPosition();
  const [width, height] = win.getSize();
  return { x, y, width, height };
}

// 1px-at-a-time repositioning for lining the bar up exactly - a mouse drag can't reliably land
// on an exact pixel, which matters here since the whole point of this stage is matching the
// real bar's position precisely. Driven by the move HUD (moveHudWindow.js).
function nudgePosition(id, dx, dy) {
  const win = windows.get(id);
  if (!win) return null;
  const [x, y] = win.getPosition();
  let nx = x + Math.round(Number(dx) || 0);
  let ny = y + Math.round(Number(dy) || 0);
  if (positionSnap.active(id)) {
    nx = positionSnap.snap(nx);
    ny = positionSnap.snap(ny);
  }
  win.setPosition(nx, ny);
  store.savePosition(id, { x: nx, y: ny });
  onBarMoved(id, getBounds(id));
  return getBounds(id);
}

function initActionBars() {
  for (const config of store.getAll()) createWindow(config);
}

module.exports = {
  initActionBars,
  getAllBars,
  getConfig,
  setActiveProfileIdFn,
  setActiveProfileIds,
  applyProfileVisibility,
  removeProfileFromAllBars,
  createBar,
  deleteBar,
  duplicateBar,
  clearAllTextOverrides,
  copySettingsFrom,
  setBarName,
  setIconsPerRow,
  setIconSize,
  setMarginPx,
  setVisible,
  setLocked,
  toggleLock,
  isLocked,
  setForegroundState,
  setShowWhenAppFocused,
  setMasterHidden,
  isMasterHidden,
  resetPosition,
  nudgePosition,
  getBounds,
  setOnMovedFn,
  setOpacity,
  setSlotCount,
  setCooldownStyle,
  setCooldownShowNumber,
  setNameLabelSize,
  setNameLabelAnchor,
  setNameLabelColor,
  setNameLabelWrap,
  setCooldownTextSize,
  setCooldownTextAnchor,
  setCooldownTextColor,
  setCooldownTextWrap,
  setCooldownReplacesLabel,
  setBorderWidth,
  setBorderOffset,
  setBorderColor,
  setSlotIcon,
  setSlotName,
  setSlotDisabled,
  setSlotBgColor,
  setSlotNameSizeOverride,
  setSlotInsetPx,
  setSlotToggleGroup,
  setSlotToggleName,
  setSlotToggleDurationSec,
  setSlotMultiIcon,
  setSlotSecondIcon,
  setSlotBorderEnabled,
  setSlotBorderWidth,
  setSlotBorderOffset,
  setSlotBorderColor,
  setSlotCooldown,
  getPseudoWidgets,
};
