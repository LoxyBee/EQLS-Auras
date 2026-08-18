const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { WidgetStore } = require('./widgetStore');
const { loadJson, saveJson } = require('./store');
const { DEFAULT_PROFILE_ID } = require('./profileStore');

const widgetStore = new WidgetStore({ loadJson, saveJson });

// (id) => string - which loadout profile is currently active, so a newly
// created/duplicated/imported widget starts out belonging to whatever
// profile the user is actually on, not always just DEFAULT_PROFILE_ID. Set
// by main.js from profileStore.js - injected rather than required directly
// for the same DI reasoning as buffEngine's setSpellbookCheckFn etc., and
// defaults to DEFAULT_PROFILE_ID so this module still works standalone
// (e.g. a plain Node test script) if never wired up.
let getActiveProfileIdFn = () => DEFAULT_PROFILE_ID;
function setActiveProfileIdFn(fn) {
  getActiveProfileIdFn = fn;
}

const windows = new Map(); // id -> BrowserWindow
// Lock state lives purely in memory, never read from widgetStore at window
// creation time - every widget always starts locked/click-through on
// launch regardless of how it was left last time, same safety behavior the
// single overlay always had.
const runtimeLock = new Map(); // id -> boolean
// How far a widget's window has currently been shifted left of its real
// stored position to reserve icon-label overflow room - see fitToContent's
// comment. Always 0 for anything that isn't an icon-mode widget with a
// label currently reserving overflow margin.
const originXByWidget = new Map(); // id -> number
// Runtime-only, never persisted - true when the auto-hide-when-EQ-unfocused
// feature (see foregroundWatcher.js) currently has widgets hidden. Kept
// separate from each widget's own persisted `enabled` state (widgetStore.js)
// so toggling focus never touches that store, and so EQ regaining focus (or
// the feature being turned off) restores exactly whichever widgets were
// actually enabled before - not everything indiscriminately, and never a
// widget the user manually disabled.
let foregroundHidden = false;

function getDefaultPosition() {
  const { workArea } = screen.getPrimaryDisplay();
  return { x: workArea.x + workArea.width - 260, y: workArea.y + 80 };
}

// Rough estimate used only for the very first paint of an icon-mode
// widget, before the renderer has had a chance to measure its own actual
// content and report back via fitToContent() below - avoids a flash of a
// wrongly-sized window on launch. Values mirror overlay.css's
// .buff-list.icon-grid gap and .buff-list padding.
const ICON_GRID_GAP_PX = 6;
const CONTENT_PADDING_PX = 8;

function estimateIconGridWidth(config) {
  const perRow = config.iconsPerRow || 4;
  const iconSize = config.iconSize || 46;
  return Math.round(perRow * iconSize + (perRow - 1) * ICON_GRID_GAP_PX + CONTENT_PADDING_PX);
}

// Zero active buffs/timers means zero measured content height - without a
// floor, an empty widget's window shrinks to whatever its last-saved height
// happened to be (or smaller), which can end up too short to see, click, or
// drag while unlocked. One tile's worth of height (icon size in icon mode,
// row size in list mode) keeps an empty widget a normal, grabbable size.
// Shared between initial window creation and fitToContent's live resizing
// so a widget that's already empty at launch (no content-change event ever
// fires to correct it) gets the floor applied too, not just live resizes.
function minHeightFor(config) {
  return (config.displayMode === 'icons' ? config.iconSize : config.rowSize) || 40;
}

function createWidgetWindow(config) {
  if (windows.has(config.id)) return windows.get(config.id);

  const pos = config.position || getDefaultPosition();
  const width = config.displayMode === 'icons' ? estimateIconGridWidth(config) : config.listWidth || config.width;
  const height = Math.max(config.height || 0, minHeightFor(config) + CONTENT_PADDING_PX);

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
    resizable: true,
    fullscreenable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload-overlay.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  // 'screen-saver' level gives the overlay the best chance of staying above
  // the game window - EQ still needs to run windowed/borderless-windowed,
  // never true exclusive fullscreen, or nothing can draw over it.
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setIgnoreMouseEvents(true, { forward: true });
  runtimeLock.set(config.id, true);
  win.setOpacity(config.opacity ?? 1);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'index.html'), {
    query: { widgetId: config.id },
  });

  win.once('ready-to-show', () => {
    if (widgetStore.getById(config.id)?.enabled && !foregroundHidden) win.showInactive();
  });

  win.on('moved', () => {
    const [x, y] = win.getPosition();
    // The stored position is the grid's own intended screen position, not
    // necessarily the window's raw x - see fitToContent's originX handling.
    // Whatever origin offset is currently applied has to be added back so a
    // real user drag (which always reports the window's true x) still saves
    // the same canonical anchor fitToContent already knows how to restore.
    const originX = originXByWidget.get(config.id) || 0;
    widgetStore.savePosition(config.id, { x: x + originX, y });
  });

  win.on('resized', () => {
    const [width, height] = win.getSize();
    widgetStore.saveSize(config.id, { width, height });
  });

  win.on('closed', () => {
    windows.delete(config.id);
    runtimeLock.delete(config.id);
    originXByWidget.delete(config.id);
  });

  windows.set(config.id, win);
  return win;
}

function initWidgets() {
  for (const config of widgetStore.getAll()) {
    if (config.enabled) createWidgetWindow(config);
  }
}

function createCustomWidget(name, options) {
  const config = widgetStore.create(name, { ...options, activeProfileIds: [getActiveProfileIdFn()] });
  createWidgetWindow(config);
  return config;
}

function addCustomTimer(id, timer) {
  const config = widgetStore.addCustomTimer(id, timer);
  pushConfigChanged(id);
  return config;
}

function updateCustomTimer(id, timerId, timer) {
  const config = widgetStore.updateCustomTimer(id, timerId, timer);
  pushConfigChanged(id);
  return config;
}

function removeCustomTimer(id, timerId) {
  const config = widgetStore.removeCustomTimer(id, timerId);
  pushConfigChanged(id);
  return config;
}

function excludeBuff(id, name) {
  const config = widgetStore.excludeBuff(id, name);
  pushConfigChanged(id);
  return config;
}

function unexcludeBuff(id, name) {
  const config = widgetStore.unexcludeBuff(id, name);
  pushConfigChanged(id);
  return config;
}

function createAllyBuffsWidget(name) {
  const config = widgetStore.createAllyBuffs(name, { activeProfileIds: [getActiveProfileIdFn()] });
  createWidgetWindow(config);
  return config;
}

function exportWidget(id) {
  return widgetStore.exportCode(id);
}

function peekWidgetCode(code) {
  return widgetStore.peekCode(code);
}

function importWidget(code) {
  // A genuine cross-person import - the payload's own profile membership
  // (if it even had any, which SHAREABLE_FIELDS excludes) would be someone
  // else's local UUIDs that don't exist in this install, so this always
  // starts the imported widget on whichever profile is currently active
  // here, same as a brand new widget.
  const config = widgetStore.importCode(code, { activeProfileIds: [getActiveProfileIdFn()] });
  if (!config) return null;
  createWidgetWindow(config);
  return config;
}

// Reuses the export/import code path rather than reimplementing "copy
// every shareable field" - a duplicate is just an import of a widget's own
// freshly-exported code. Refused for Self Buffs the same way importCode
// already refuses a Self-Buffs-exported code (it's a fixed singleton, see
// its own comment) - the UI hides the Duplicate button there too, this is
// just the backend's own guard against it being called some other way.
// Offset slightly from the source position (not left exactly overlapping
// it, which would make the new one invisible/indistinguishable until
// dragged) and named "<name> (copy)" so two widgets never share both a
// name and a position at once.
function duplicateWidget(id) {
  const source = widgetStore.getById(id);
  if (!source || source.kind === 'self-buffs-builtin') return null;
  const code = widgetStore.exportCode(id);
  if (!code) return null;
  const imported = widgetStore.importCode(code);
  if (!imported) return null;
  // Unlike a genuine cross-person import (see importWidget below), this is
  // the SAME install/user - the source widget's own profile membership is
  // real, meaningful data here (unlike a stranger's profile UUIDs, which
  // wouldn't even exist locally), so the copy should start out matching it
  // rather than defaulting to just whatever's currently active.
  widgetStore.update(imported.id, { name: `${source.name} (copy)`, activeProfileIds: [...source.activeProfileIds] });
  if (source.position) {
    widgetStore.savePosition(imported.id, { x: source.position.x + 24, y: source.position.y + 24 });
  }
  const config = widgetStore.getById(imported.id);
  createWidgetWindow(config);
  return config;
}

function applyCodeToSelfBuffs(code) {
  const config = widgetStore.applyCodeToSelfBuffs(code);
  if (config) pushConfigChanged('self-buffs');
  return config;
}

function deleteWidget(id) {
  const widget = widgetStore.getById(id);
  if (!widget || widget.deletable === false) return false;
  const win = windows.get(id);
  if (win) win.close();
  return widgetStore.remove(id);
}

function moveWidget(id, direction) {
  return widgetStore.move(id, direction);
}

function pushConfigChanged(id) {
  const win = windows.get(id);
  const config = widgetStore.getById(id);
  if (win && config) win.webContents.send('widget:configChanged', config);
}

// Both modes size their window's HEIGHT to exactly what their content
// actually needs right now (however many rows/icons are currently
// visible) - the renderer measures its own real layout (see the
// ResizeObserver in overlay.js) and reports it here, rather than this
// module trying to re-derive it from config and live buff counts, which
// it has no direct access to. WIDTH is mode-specific: icon mode's width is
// also content-driven (icons-per-row x icon size, since that's an
// explicit setting, not something to drag); list mode's width instead
// comes from the "List width" setting - the renderer sets its content to
// exactly that width before measuring, so what's reported back for width
// in list mode is just that same value confirmed, not something new.
const WINDOW_CONTENT_PADDING_PX = 8;

// originX: how far the renderer's actual content (the icon grid) currently
// sits inset from content-wrap's own left edge - always 0 except an icon-
// mode widget currently reserving overflow room on both sides for a label
// (see overlay.js's applyConfig). Widening the window to fit that reserved
// margin would, on its own, shift the grid right on screen (a BrowserWindow
// only ever grows from its top-left corner) - compensated for here by
// shifting the window's x left by the same amount, so the grid's on-screen
// position stays fixed regardless of how much margin is currently reserved.
function fitToContent(id, contentWidth, contentHeight, originX = 0) {
  const config = widgetStore.getById(id);
  const win = windows.get(id);
  if (!config || !win) return;
  const minHeight = minHeightFor(config);
  const width = Math.max(40, Math.round(contentWidth) + WINDOW_CONTENT_PADDING_PX);
  const height = Math.max(minHeight + WINDOW_CONTENT_PADDING_PX, Math.round(contentHeight) + WINDOW_CONTENT_PADDING_PX);
  const [currentWidth, currentHeight] = win.getSize();
  const [currentX, currentY] = win.getPosition();

  const roundedOriginX = Math.round(originX || 0);
  const previousOriginX = originXByWidget.get(id) || 0;
  // The canonical anchor is the grid's real intended screen position -
  // whatever's actually stored, or (for a widget that's never been
  // explicitly repositioned yet, so config.position is still null - see
  // createWidgetWindow's own fallback) derived from the window's current
  // position with whatever origin offset was already applied removed.
  const anchorX = config.position ? config.position.x : currentX + previousOriginX;
  const targetX = anchorX - roundedOriginX;

  const sizeChanged = width !== currentWidth || height !== currentHeight;
  const xChanged = targetX !== currentX;
  if (!sizeChanged && !xChanged) return;

  // Set before setBounds, not after - the 'moved' handler (see
  // createWidgetWindow) reads this map to convert the window's raw
  // post-move x back into the canonical anchor, and needs the NEW offset
  // to do that correctly for the move this call itself triggers.
  originXByWidget.set(id, roundedOriginX);
  win.setBounds({ x: targetX, y: currentY, width, height });
  widgetStore.update(id, { width, height });
}

function setEnabled(id, enabled) {
  const config = widgetStore.update(id, { enabled });
  if (!config) return null;
  let win = windows.get(id);
  if (enabled) {
    if (!win) win = createWidgetWindow(config);
    // Don't actually show it if auto-hide currently has everything hidden -
    // it'll appear once EQ regains focus (or auto-hide gets turned off)
    // instead, same as every other enabled widget.
    else if (!foregroundHidden) win.showInactive();
  } else if (win) {
    win.hide();
  }
  return config;
}

// Called by main.js on every game-focus change, only while the auto-hide
// setting is on (see main.js's foregroundWatcher wiring) - hides/shows
// every currently-ENABLED widget's window. A widget the user has manually
// disabled was already hidden and stays that way regardless of focus.
function setForegroundHidden(hidden) {
  if (hidden === foregroundHidden) return;
  foregroundHidden = hidden;
  for (const config of widgetStore.getAll()) {
    if (!config.enabled) continue;
    const win = windows.get(config.id);
    if (!win) continue;
    if (hidden) win.hide();
    else win.showInactive();
  }
}

function setLocked(id, locked) {
  runtimeLock.set(id, locked);
  widgetStore.update(id, { locked });
  const win = windows.get(id);
  if (win) {
    win.setIgnoreMouseEvents(locked, { forward: true });
    win.webContents.send('widget:lockChanged', locked);
  }
  return locked;
}

// Only recovery path for a widget that's been dragged off-screen, or whose
// saved position sat on a monitor that's since been disconnected - moves
// it back to the default corner of the (now-current) primary display.
// Doesn't touch size, only position, and clears any currently-reserved
// originX compensation (see fitToContent's comment) so the 'moved' handler
// saves this exact position back, not that offset re-applied to it.
function resetPosition(id) {
  const win = windows.get(id);
  if (!win) return null;
  const pos = getDefaultPosition();
  originXByWidget.set(id, 0);
  win.setPosition(pos.x, pos.y);
  widgetStore.savePosition(id, pos);
  return widgetStore.getById(id);
}

function toggleLock(id) {
  return setLocked(id, !isLocked(id));
}

function isLocked(id) {
  return runtimeLock.get(id) !== false;
}

function setDisplayMode(id, mode) {
  const config = widgetStore.update(id, { displayMode: mode === 'icons' ? 'icons' : 'list' });
  pushConfigChanged(id);
  return config;
}

function setTimerFormat(id, format) {
  const config = widgetStore.update(id, { timerFormat: format });
  pushConfigChanged(id);
  return config;
}

function setTextSize(id, size) {
  const config = widgetStore.update(id, { textSize: size });
  pushConfigChanged(id);
  return config;
}

function setIconSize(id, size) {
  const config = widgetStore.update(id, { iconSize: size });
  pushConfigChanged(id);
  return config;
}

function setContentAnchor(id, anchor) {
  const config = widgetStore.update(id, { contentAnchor: anchor });
  pushConfigChanged(id);
  return config;
}

function setIconsPerRow(id, count) {
  const config = widgetStore.update(id, { iconsPerRow: count });
  pushConfigChanged(id);
  return config;
}

function setRowSize(id, size) {
  const config = widgetStore.update(id, { rowSize: size });
  pushConfigChanged(id);
  return config;
}

function setSortOrder(id, order) {
  const config = widgetStore.update(id, { sortOrder: order });
  pushConfigChanged(id);
  return config;
}

function setLowTimeThreshold(id, seconds) {
  const config = widgetStore.update(id, { lowTimeThresholdSec: seconds });
  pushConfigChanged(id);
  return config;
}

function setLandingGlowEnabled(id, enabled) {
  const config = widgetStore.update(id, { landingGlowEnabled: enabled });
  pushConfigChanged(id);
  return config;
}

function setHideBardSongs(id, hide) {
  const config = widgetStore.update(id, { hideBardSongs: hide });
  pushConfigChanged(id);
  return config;
}

function setShowRowIcon(id, enabled) {
  const config = widgetStore.update(id, { showRowIcon: enabled });
  pushConfigChanged(id);
  return config;
}

function setMirrorRowDirection(id, enabled) {
  const config = widgetStore.update(id, { mirrorRowDirection: enabled });
  pushConfigChanged(id);
  return config;
}

function setShowIconLabel(id, enabled) {
  const config = widgetStore.update(id, { showIconLabel: enabled });
  pushConfigChanged(id);
  return config;
}

// Pure membership bookkeeping (see widgetStore.js's activeProfileIds field
// doc) - never affects whether this widget is shown, only which loadout
// profiles' ambiguous-cast memory it's considered part of.
function setActiveProfileIds(id, profileIds) {
  const config = widgetStore.update(id, { activeProfileIds: profileIds });
  pushConfigChanged(id);
  return config;
}

// Called by main.js when a profile is deleted - no pushConfigChanged loop
// needed here (unlike most mutations) since the renderer already refreshes
// its whole widget list in response to the profiles:changed broadcast that
// accompanies a deletion, and this has no visual effect on the overlay
// itself to push anyway.
function removeProfileFromAllWidgets(profileId) {
  widgetStore.removeProfileFromAllWidgets(profileId);
}

function setIconLabelSize(id, size) {
  const config = widgetStore.update(id, { iconLabelSize: size });
  pushConfigChanged(id);
  return config;
}

function setIconLabelAnchor(id, anchor) {
  const config = widgetStore.update(id, { iconLabelAnchor: anchor });
  pushConfigChanged(id);
  return config;
}

function setWrapText(id, enabled) {
  const config = widgetStore.update(id, { wrapText: enabled });
  pushConfigChanged(id);
  return config;
}

function setIconJustify(id, value) {
  const config = widgetStore.update(id, { iconJustify: value });
  pushConfigChanged(id);
  return config;
}

function setMaxDurationFilter(id, seconds) {
  const config = widgetStore.update(id, { maxDurationFilterSec: seconds });
  pushConfigChanged(id);
  return config;
}

function setSoundOnLand(id, enabled) {
  const config = widgetStore.update(id, { soundOnLand: enabled });
  pushConfigChanged(id);
  return config;
}

function setSoundOnExpire(id, enabled) {
  const config = widgetStore.update(id, { soundOnExpire: enabled });
  pushConfigChanged(id);
  return config;
}

function setSoundWarningSec(id, seconds) {
  const config = widgetStore.update(id, { soundWarningSec: seconds });
  pushConfigChanged(id);
  return config;
}

function setSoundWarningLoopSec(id, seconds) {
  const config = widgetStore.update(id, { soundWarningLoopSec: seconds });
  pushConfigChanged(id);
  return config;
}

function setListWidth(id, width) {
  const config = widgetStore.update(id, { listWidth: width });
  pushConfigChanged(id);
  return config;
}

function setOpacity(id, opacity) {
  const config = widgetStore.update(id, { opacity });
  const win = windows.get(id);
  if (win) win.setOpacity(opacity);
  pushConfigChanged(id);
  return config;
}

function setName(id, name) {
  return widgetStore.update(id, { name });
}

function setBuffFilter(id, mode, names) {
  const config = widgetStore.update(id, { buffFilterMode: mode, buffNames: names });
  pushConfigChanged(id);
  return config;
}

function setBuffSource(id, source) {
  const config = widgetStore.update(id, { buffSource: source === 'ally' ? 'ally' : 'self' });
  pushConfigChanged(id);
  return config;
}

function getAllWidgetConfigs() {
  return widgetStore.getAll();
}

function getWidgetConfig(id) {
  return widgetStore.getById(id);
}

module.exports = {
  initWidgets,
  setActiveProfileIdFn,
  createCustomWidget,
  createAllyBuffsWidget,
  exportWidget,
  peekWidgetCode,
  importWidget,
  duplicateWidget,
  applyCodeToSelfBuffs,
  deleteWidget,
  moveWidget,
  setEnabled,
  setForegroundHidden,
  setLocked,
  toggleLock,
  resetPosition,
  isLocked,
  setDisplayMode,
  setTimerFormat,
  setTextSize,
  setIconSize,
  setContentAnchor,
  setIconsPerRow,
  setRowSize,
  setSortOrder,
  setLowTimeThreshold,
  setLandingGlowEnabled,
  setHideBardSongs,
  setMaxDurationFilter,
  setShowRowIcon,
  setMirrorRowDirection,
  setShowIconLabel,
  setActiveProfileIds,
  removeProfileFromAllWidgets,
  setIconLabelSize,
  setIconLabelAnchor,
  setWrapText,
  setIconJustify,
  setSoundOnLand,
  setSoundOnExpire,
  setSoundWarningSec,
  setSoundWarningLoopSec,
  setListWidth,
  setOpacity,
  setName,
  setBuffFilter,
  setBuffSource,
  addCustomTimer,
  updateCustomTimer,
  removeCustomTimer,
  excludeBuff,
  unexcludeBuff,
  fitToContent,
  getAllWidgetConfigs,
  getWidgetConfig,
};
