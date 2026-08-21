const path = require('path');
const { BrowserWindow, screen } = require('electron');
const { WidgetStore, normalizeDisplayMode, isSoundOnly, isTextAura, clampInstantSec } = require('./widgetStore');
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
// separate from profile-based visibility (below) so toggling focus never
// touches the widget store, and so EQ regaining focus (or the feature being
// turned off) restores exactly whichever widgets the active profile says
// should be showing - not everything indiscriminately.
let foregroundHidden = false;
// Runtime-only, deliberately never persisted (note 4). A forgotten master-hide surviving a
// restart would look exactly like "all my auras broke overnight", and the cost of NOT persisting
// it is one button press.
let masterHidden = false;
// Auras the user unlocked ONE AT A TIME, which forces them on screen even when the active
// loadout profile has them switched off (note 31) - you cannot drag something you cannot see.
// Deliberately not populated by "Unlock all auras": that would dump every aura you own onto the
// screen at once, which is the opposite of useful. Runtime-only, cleared by re-locking.
const forceShown = new Set(); // ids

// THE single source of truth for "should this widget's window be on screen".
// Loadout profile membership IS the on/off control - there is deliberately
// no separate global "enabled" switch anymore. That was an explicit user
// decision: two independent concepts (a global enable toggle AND per-profile
// membership) meant two places to look when a widget didn't show up, so they
// asked for one point of contact instead. The persisted `enabled` field is
// intentionally left in widgetStore.js untouched (zero-risk to existing
// saved data, see this project's userData-path incident) but is no longer
// read for visibility anywhere - don't reintroduce it as a second gate.
//
// Empty activeProfileIds means HIDDEN EVERYWHERE. This reverses an earlier
// choice (empty used to mean "show on every profile", as a guard against a
// new widget silently being invisible) - the user asked for unticking every
// profile to be the way you switch an aura off, which also gives a single
// profile a working on/off toggle. The original worry doesn't apply in
// practice: every creation path (create / duplicate / import / premade) ticks
// the currently active profile, so an empty list only ever results from the
// user deliberately unticking everything.
function isVisibleForActiveProfile(config) {
  const ids = config.activeProfileIds || [];
  return ids.includes(getActiveProfileIdFn());
}

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
  // A text aura's one line is as tall as its own size setting, which goes far higher than either
  // of the other two - floor it to that, or a 96px announcement opens in a window too short to
  // show it and looks clipped until something resizes.
  if (config.displayMode === 'text') return config.textAuraSize || 32;
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
  // Every widget starts LOCKED on launch regardless of how it was left last time - the same
  // safety behaviour the single overlay always had - which is what an empty runtimeLock map
  // means. But a window can now also be created ON DEMAND by unlocking an aura the current
  // profile has switched off (note 31), and that one must not immediately re-lock itself: the
  // unlock is already recorded, and overwriting it here made the button appear to do nothing.
  if (!runtimeLock.has(config.id)) runtimeLock.set(config.id, true);
  win.setIgnoreMouseEvents(shouldIgnoreMouse(config), { forward: true });
  win.setOpacity(config.opacity ?? 1);

  win.loadFile(path.join(__dirname, '..', 'renderer', 'overlay', 'index.html'), {
    query: { widgetId: config.id },
  });

  win.once('ready-to-show', () => {
    // Same single decision as everywhere else - a window created while an
    // unlock is active must appear immediately, not wait for the next focus
    // change.
    const current = widgetStore.getById(config.id);
    if (current && shouldBeOnScreen(current)) win.showInactive();
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
    if (isVisibleForActiveProfile(config)) createWidgetWindow(config);
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

function createTextAuraWidget(name, preset) {
  const config = widgetStore.createTextAura(name, { preset, activeProfileIds: [getActiveProfileIdFn()] });
  createWidgetWindow(config);
  return config;
}

function createBuffTimerWidget(name, spellName, source) {
  const config = widgetStore.createBuffTimer(name, {
    spellName,
    source,
    activeProfileIds: [getActiveProfileIdFn()],
  });
  createWidgetWindow(config);
  return config;
}

function createSoundOnlyWidget(name) {
  const config = widgetStore.createSoundOnly(name, { activeProfileIds: [getActiveProfileIdFn()] });
  // Still gets a real overlay window, exactly like every other aura. That window is where the
  // sound actually comes from - overlay.js already owns the whole alert pipeline (which buffs
  // count as visible, renewal detection, the warning-threshold loop, the volume). Routing
  // sound-only auras somewhere else would have meant a second copy of all of it.
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

// Brings one widget's window in line with what isVisibleForActiveProfile
// currently says - creating the window on demand the first time a widget
// becomes visible (a widget that's never been visible this session has no
// window yet, since initWidgets only builds the ones it needs). Safe to call
// repeatedly; showing an already-shown window is a no-op.
// Single decision for "should this aura's window be on screen", in priority
// order: it must belong to the active profile at all; an unlocked aura (one
// being repositioned) then beats auto-hide, since you can't drag what you
// can't see; otherwise auto-hide decides.
// TWO DIFFERENT KINDS OF RULE live in this function, and confusing them is how it goes wrong.
//
//   ON/OFF - is this aura running at all? Loadout profile membership is the only one, and it is
//   deliberately the app's single on/off switch (see isVisibleForActiveProfile above).
//
//   SCREEN-CLEARING - is a running aura visible right now? The master hide toggle (note 4) and
//   auto-hide-while-EverQuest-is-unfocused. Both are temporary, neither touches saved data.
//
// Unlocking overrides screen-clearing rules, because you cannot drag something you cannot see.
// A sound-only aura is subject to the on/off rule and exempt from every screen-clearing one,
// because it has nothing on the screen to clear.
//
// The order below IS the behaviour. Each clause has a reason it sits where it does.
function shouldBeOnScreen(config) {
  // Note 31: unlocking one aura BY HAND puts it on screen even when the current profile has it
  // switched off, and re-locking hands it straight back to the normal rules. forceShown rather
  // than isUnlocked, so "Unlock all auras" does not drag every switched-off aura onto the screen
  // with it.
  if (!isVisibleForActiveProfile(config) && !forceShown.has(config.id)) return false;

  // A sound-only aura draws nothing, so being on screen costs it nothing and hiding it buys
  // nothing. Hiding it would be actively harmful: a hidden window is one Chromium is entitled to
  // throttle, and reacting promptly is the only thing this aura does. It stays up, invisible,
  // and keeps listening. Below the profile check, never above it - an aura that kept beeping
  // after being switched off would be untraceable, with nothing on screen to point at.
  if (isSoundOnly(config)) return true;

  // Note 4: master hide beats unlock, deliberately, and this is the one clause that had to be
  // decided rather than inherited. It exists to clear the screen while doing other UI work, so
  // "Hide all auras" appearing to do nothing because something happened to be unlocked is
  // exactly the failure that would make the button useless.
  if (masterHidden) return false;

  if (isUnlocked(config.id)) return true;
  return !foregroundHidden;
}

// Whether an aura should be MAKING SOUND, which is a different question from whether it should
// be drawn - and the distinction only became visible once an aura could be nothing but sound.
//
// Hiding a window does NOT silence it. A hidden overlay keeps receiving the engine broadcasts
// and keeps running render(), which is exactly where the alert sounds fire. For an ordinary aura
// that was invisible in both senses of the word, so nobody noticed; for a sound-only aura it is
// the whole aura.
//
// The rule follows shouldBeOnScreen's two kinds of rule. Profile membership is the ON/OFF
// switch, so an aura the current loadout has switched off is off, full stop - silent as well as
// invisible. The SCREEN-CLEARING overrides (master hide, auto-hide while EverQuest is unfocused)
// deliberately do NOT silence anything: hearing that a buff is about to drop while you are
// tabbed out is most of the reason to have a sound at all.
function shouldBeAudible(config) {
  return isVisibleForActiveProfile(config);
}

function pushAudible(config) {
  const win = windows.get(config.id);
  if (win && !win.isDestroyed()) win.webContents.send('widget:audibleChanged', shouldBeAudible(config));
}

function applyVisibility(config) {
  let win = windows.get(config.id);
  if (shouldBeOnScreen(config)) {
    if (!win) {
      createWidgetWindow(config); // its ready-to-show handler does the showing
      return;
    }
    win.showInactive();
  } else if (win) {
    win.hide();
  }
  // After the show/hide, and on every path that has a window: a profile switch is the one thing
  // that changes this, and it comes through here for every widget.
  pushAudible(config);
}

// Called by main.js whenever the ACTIVE loadout profile changes - profile
// membership is what decides visibility now (see isVisibleForActiveProfile),
// so a switch has to re-evaluate every widget, not just the ones the user
// touched.
function applyProfileVisibility() {
  for (const config of widgetStore.getAll()) applyVisibility(config);
}

// Called by main.js on every game-focus change, only while the auto-hide
// setting is on (see main.js's foregroundWatcher wiring) - hides/shows every
// widget the active profile says should be showing. A widget hidden by
// profile membership was already hidden and stays that way regardless of
// focus.
function setForegroundHidden(hidden) {
  if (hidden === foregroundHidden) return;
  foregroundHidden = hidden;
  // One decision function (shouldBeOnScreen) rather than repeating the
  // override rules here - an unlocked or force-shown aura must survive
  // auto-hide, and that logic should live in exactly one place.
  for (const config of widgetStore.getAll()) applyVisibility(config);
}

// An UNLOCKED aura is always on screen, whatever auto-hide currently says.
// Unlocking is how you reposition or resize one, and you can only do that to
// something you can see - with auto-hide on, clicking into this app to unlock
// an aura is itself what makes EQ lose focus, so the aura being adjusted was
// the one thing guaranteed to vanish. Re-locking hands it straight back to
// the normal rules.
//
// The force option is what separates unlocking ONE aura from "Unlock all auras" (note 31).
// Unlocking one by hand forces it on screen even if the active profile has it switched off;
// unlocking everything does not, or every aura you own appears at once.
// A sound-only aura stays click-through whatever its lock says. Unlocked, it would otherwise be
// an INVISIBLE rectangle sitting over the game and swallowing clicks - with nothing on screen to
// explain where they were going. There is nothing to drag either, which is why the settings
// window hides its Unlock button too.
function shouldIgnoreMouse(config) {
  return isSoundOnly(config) || isLocked(config.id);
}

function setLocked(id, locked, { force = true } = {}) {
  runtimeLock.set(id, locked);
  if (locked || !force) forceShown.delete(id);
  else forceShown.add(id);
  const config = widgetStore.update(id, { locked });

  // Visibility FIRST, and unconditionally. An aura switched off for the current profile has no
  // window at all, so unlocking it has to be able to create one - the previous version only
  // re-evaluated visibility when a window already existed, which meant unlocking an off-profile
  // aura did nothing whatsoever and read as a broken button.
  if (config) applyVisibility(config);

  // Re-read: applyVisibility may have just created this window. A brand-new one does not need
  // the message anyway - overlay.js asks for the lock state itself as it boots - but it does
  // need the click-through flag, which is main-process state.
  const win = windows.get(id);
  if (win && config) {
    win.setIgnoreMouseEvents(shouldIgnoreMouse(config), { forward: true });
    win.webContents.send('widget:lockChanged', locked);
  }
  return locked;
}

// Master unlock control on the Overlay Auras page. A toggle rather than a
// one-shot action so the same button always puts things back - "unlock
// everything" with no matching "re-lock everything" would leave every aura
// click-catching with no obvious way out.
function setAllUnlocked(unlocked) {
  // force: false - see setLocked. Unlocking everything must not haul every aura the current
  // profile has switched off onto the screen along with the ones you can actually see.
  for (const config of widgetStore.getAll()) setLocked(config.id, !unlocked, { force: false });
  return unlocked;
}

// Note 4: a temporary "clear the screen" override for doing other UI work. Deliberately not
// persisted (see masterHidden), and deliberately beats unlock (see shouldBeOnScreen).
function setMasterHidden(hidden) {
  const next = !!hidden;
  if (next === masterHidden) return masterHidden;
  masterHidden = next;
  // One decision function rather than repeating the override rules here.
  for (const config of widgetStore.getAll()) applyVisibility(config);
  return masterHidden;
}

function isMasterHidden() {
  return masterHidden;
}

function areAllUnlocked() {
  const all = widgetStore.getAll();
  return all.length > 0 && all.every((c) => isUnlocked(c.id));
}

function isUnlocked(id) {
  return runtimeLock.get(id) === false;
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
  const config = widgetStore.update(id, { displayMode: normalizeDisplayMode(mode) });
  pushConfigChanged(id);
  // Switching INTO or OUT OF sound-only changes whether this widget should be on screen at all
  // (see shouldBeOnScreen) - a sound-only aura is exempt from auto-hide, an ordinary one is not.
  // Without this, turning an aura sound-only while EQ was unfocused left it hidden and therefore
  // deaf until the next focus change happened to correct it.
  applyVisibility(config);
  // Switching to sound-only has to take the click-through flag with it, or an aura that was
  // unlocked when the switch happened is left as an invisible click-eating rectangle.
  const win = windows.get(id);
  if (win && config) win.setIgnoreMouseEvents(shouldIgnoreMouse(config), { forward: true });
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

function setCategoryBorders(id, enabled) {
  const config = widgetStore.update(id, { categoryBordersEnabled: !!enabled });
  pushConfigChanged(id);
  return config;
}

function setMergeSameDuration(id, enabled) {
  const config = widgetStore.update(id, { mergeSameDuration: !!enabled });
  pushConfigChanged(id);
  return config;
}

function setTextAuraMessage(id, message) {
  const config = widgetStore.update(id, { textAuraMessage: String(message == null ? '' : message) });
  pushConfigChanged(id);
  return config;
}

function setTextAuraInstantSec(id, seconds) {
  // Clamped in the store rather than here, so a share code goes through the same gate a slider
  // does - see clampInstantSec.
  const config = widgetStore.update(id, { textAuraInstantSec: clampInstantSec(Number(seconds)) });
  pushConfigChanged(id);
  return config;
}

function setTextAuraSize(id, size) {
  const config = widgetStore.update(id, { textAuraSize: Number(size) || 32 });
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

// Profile membership IS this widget's on/off control (see
// isVisibleForActiveProfile) - ticking/unticking the currently active
// profile here has to show/hide it immediately, which is the whole point of
// there being no separate global enable toggle.
function setActiveProfileIds(id, profileIds) {
  const config = widgetStore.update(id, { activeProfileIds: profileIds });
  if (!config) return null;
  applyVisibility(config);
  pushConfigChanged(id);
  return config;
}

// Called by main.js when a profile is deleted - no pushConfigChanged loop
// needed here (unlike most mutations) since the renderer already refreshes
// its whole widget list in response to the profiles:changed broadcast that
// accompanies a deletion. Visibility IS re-applied though: dropping a
// deleted profile can leave a widget with an empty membership list, which
// now means "visible on every profile".
function removeProfileFromAllWidgets(profileId) {
  widgetStore.removeProfileFromAllWidgets(profileId);
  applyProfileVisibility();
}

function setGroupAllyBuffs(id, value) {
  const config = widgetStore.update(id, { groupAllyBuffs: value });
  pushConfigChanged(id);
  return config;
}

function setGroupAllyDirection(id, value) {
  const config = widgetStore.update(id, { groupAllyDirection: value });
  pushConfigChanged(id);
  return config;
}

function setHideAllyNameOnTile(id, value) {
  const config = widgetStore.update(id, { hideAllyNameOnTile: value });
  pushConfigChanged(id);
  return config;
}

function setTimerTextColor(id, value) {
  const config = widgetStore.update(id, { timerTextColor: value });
  pushConfigChanged(id);
  return config;
}

function setLabelTextColor(id, value) {
  const config = widgetStore.update(id, { labelTextColor: value });
  pushConfigChanged(id);
  return config;
}

function setIconMargin(id, value) {
  const config = widgetStore.update(id, { iconMarginPx: value });
  pushConfigChanged(id);
  return config;
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

function setLandSoundId(id, soundId) {
  const config = widgetStore.update(id, { landSoundId: soundId });
  pushConfigChanged(id);
  return config;
}

function setExpireSoundId(id, soundId) {
  const config = widgetStore.update(id, { expireSoundId: soundId });
  pushConfigChanged(id);
  return config;
}

function setWarningSoundId(id, soundId) {
  const config = widgetStore.update(id, { warningSoundId: soundId });
  pushConfigChanged(id);
  return config;
}

function setAlertVolume(id, volume) {
  const config = widgetStore.update(id, { alertVolume: volume });
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
  // 'customTimer' is accepted only for the two ANNOUNCER types - text and sound-only. Every
  // other aura has its source fixed when it is created, deliberately (see defaultCustomWidget's
  // note on the field), and this coercion is what enforces that.
  //
  // Those two are the exception because their whole purpose is to react to something happening,
  // and the thing worth reacting to is as often a line of log text as it is a buff. Both of their
  // buttons in the add-aura list say so in as many words, which is the other reason this has to
  // hold: an option promised in the copy and refused by the code is worse than one never offered.
  const current = widgetStore.getById(id);
  const isAnnouncer = isTextAura(current) || isSoundOnly(current);
  const allowed = isAnnouncer ? ['self', 'ally', 'customTimer'] : ['self', 'ally'];
  const config = widgetStore.update(id, { buffSource: allowed.includes(source) ? source : 'self' });
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
  createSoundOnlyWidget,
  createTextAuraWidget,
  createBuffTimerWidget,
  exportWidget,
  peekWidgetCode,
  importWidget,
  duplicateWidget,
  applyCodeToSelfBuffs,
  deleteWidget,
  moveWidget,
  applyProfileVisibility,
  setForegroundHidden,
  setMasterHidden,
  isMasterHidden,
  shouldBeAudible,
  // Exported for test/visibility.test.js. Nothing in the app calls it from outside this module -
  // it is exported because it is the single decision function for what appears on screen, and a
  // rule this dense is worth being able to drive directly rather than infer from side effects.
  shouldBeOnScreen,
  shouldIgnoreMouse,
  setAllUnlocked,
  areAllUnlocked,
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
  setMergeSameDuration,
  setCategoryBorders,
  setTextAuraMessage,
  setTextAuraSize,
  setTextAuraInstantSec,
  setHideBardSongs,
  setMaxDurationFilter,
  setShowRowIcon,
  setMirrorRowDirection,
  setShowIconLabel,
  setActiveProfileIds,
  removeProfileFromAllWidgets,
  setGroupAllyBuffs,
  setGroupAllyDirection,
  setHideAllyNameOnTile,
  setTimerTextColor,
  setLabelTextColor,
  setIconMargin,
  setIconLabelSize,
  setIconLabelAnchor,
  setWrapText,
  setIconJustify,
  setSoundOnLand,
  setSoundOnExpire,
  setSoundWarningSec,
  setSoundWarningLoopSec,
  setLandSoundId,
  setExpireSoundId,
  setWarningSoundId,
  setAlertVolume,
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
