const { app } = require('electron');
const path = require('path');

// Electron's default userData path is derived from the app's display name
// (productName/name in package.json), which normally makes a rebrand
// silently orphan every existing user's saved data - widgets, loadout
// profiles, the buff roster, spellbook cache, all of it would appear to
// vanish on next launch since the app would start reading/writing a brand
// new folder. Pinned here to the ORIGINAL "EQ Buff Tracker" folder
// (reconstructed from the OS-level roaming appdata root, not from the
// current product name) so the "EQLS Auras" rename - and any future one,
// e.g. toward "EQLsource" branding - never touches real user data.
//
// MUST run before requiring ANY local module, not just before this file's
// own app.getPath('userData') calls further down - widgetManager.js builds
// its WidgetStore at require() time (module-level code, not inside a
// function), so a require('./widgetManager') above this line would already
// read/create widgets.json under the WRONG folder before this line ever
// got a chance to run. Confirmed the hard way: an earlier version of this
// pin sat after the requires and silently seeded a second, empty
// widgets.json under the new "EQLS Auras" folder on first restart after
// the rename, while everything else (buffs, profiles, spellbook) correctly
// stayed in the old folder - a real split-brain, not a hypothetical.
app.setPath('userData', path.join(app.getPath('appData'), 'EQ Buff Tracker'));

const fs = require('fs');
const { ipcMain, protocol, BrowserWindow } = require('electron');
const { createMainWindow } = require('./mainWindow');
const { LogService } = require('./logService');
const { BuffStore } = require('./buffStore');
const { BuffEngine } = require('./buffEngine');
const { CustomTimerEngine } = require('./customTimerEngine');
const { IconService } = require('./iconService');
const { ICON_SETS } = require('./iconExtractor');
const { SpellbookService } = require('./spellbookService');
const { resolveInstallRoot } = require('./eqLocator');
const { loadJson, saveJson } = require('./store');
const widgetManager = require('./widgetManager');
const ambiguousPopup = require('./ambiguousPopup');
const { ProfileStore } = require('./profileStore');
const { ForegroundWatcher } = require('./foregroundWatcher');

protocol.registerSchemesAsPrivileged([
  { scheme: 'eqicon', privileges: { standard: true, supportFetchAPI: true, corsEnabled: true } },
]);

// Running two copies at once is a real trap here: each would independently
// tail the same log file, maintain its own separate buff state, and open
// its own overlay window - so whichever window you're actually looking at
// might not be the one that's processing anything. Refuse a second launch
// and just focus the existing one instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const logService = new LogService();
const buffStore = new BuffStore({ loadJson, saveJson });
const buffEngine = new BuffEngine(buffStore, { loadJson, saveJson });
const profileStore = new ProfileStore({ loadJson, saveJson });
// Makes sure the engine starts out pointed at whichever profile was last
// active, instead of always defaulting to DEFAULT_PROFILE_ID regardless of
// what the user last had selected.
buffEngine.setActiveProfileId(profileStore.getActiveId());
// So a newly created/duplicated/imported widget defaults to belonging to
// whichever profile is currently active, not always just the default one
// - see widgetManager.js's getActiveProfileIdFn doc.
widgetManager.setActiveProfileIdFn(() => profileStore.getActiveId());
const customTimerEngine = new CustomTimerEngine();
// Timer definitions live on widgets themselves (see widgetStore.js), not a
// separate store - injected rather than required directly since
// widgetManager pulls in Electron's screen/BrowserWindow.
customTimerEngine.setGetWidgetsFn(() => widgetManager.getAllWidgetConfigs());
const iconService = new IconService();
const spellbookService = new SpellbookService();
buffEngine.setIconUrlFn((iconId) => iconService.buildIconUrl(iconId));
buffEngine.setSpellbookCheckFn((name) => spellbookService.has(name));
customTimerEngine.setIconUrlFn((iconId) => iconService.buildIconUrl(iconId));
buffEngine.setTrackOthersEnabled(loadJson('trackOthersEnabled', false));
buffEngine.setBlockedNames(loadJson('blockedBuffs', []));

// Auto-hide overlay widgets while EQ isn't the focused window (backlog #6)
// - on by default per explicit user request. The watcher itself only ever
// runs while this is on, so there's no background polling overhead if the
// user turns it off.
const foregroundWatcher = new ForegroundWatcher();
let autoHideOverlayEnabled = loadJson('autoHideOverlay', true);
foregroundWatcher.on('focusChanged', (focused) => {
  if (autoHideOverlayEnabled) widgetManager.setForegroundHidden(!focused);
});
if (autoHideOverlayEnabled) foregroundWatcher.start();

// Permanent (not "remove before shipping" temp debug logging) - a running
// record of every detection decision (landed/queued/ignored/blocked and
// why), so a confusing moment in-game can be checked afterward instead of
// needing to manually trace the raw EQ log. Capped by truncating on
// startup rather than mid-session, so a single write is never slowed down
// by a size check.
const DEBUG_LOG_PATH = path.join(app.getPath('userData'), 'detection-debug.log');
const DEBUG_LOG_MAX_BYTES = 2 * 1024 * 1024;
try {
  if (fs.statSync(DEBUG_LOG_PATH).size > DEBUG_LOG_MAX_BYTES) fs.rmSync(DEBUG_LOG_PATH);
} catch {
  // Doesn't exist yet - nothing to trim.
}
buffEngine.setDebugLogFn((message) => {
  const line = `[${new Date().toLocaleTimeString()}] ${message}`;
  try {
    fs.appendFileSync(DEBUG_LOG_PATH, line + '\n');
  } catch {
    // Best-effort only - never let a logging failure break detection.
  }
  broadcast('debug:line', line);
});

// AA "Spell Casting Reinforcement" (4 ranks) and Exaltation "Extended
// Enhancement" (3 ranks) both extend buff durations by a flat percentage,
// and stack additively with each other. buffEngine only needs the combined
// multiplier - it doesn't know or care where the percentages came from.
const AA_REINFORCEMENT_PERCENTS = [0, 5, 15, 30, 50];
const EXALTATION_PERCENTS = [0, 5, 10, 15];

function loadCharacterSettings() {
  return loadJson('characterSettings', { aaLevel: 0, exaltationLevel: 0 });
}

function durationMultiplierFor(settings) {
  const aaPct = AA_REINFORCEMENT_PERCENTS[settings.aaLevel] || 0;
  const exaltPct = EXALTATION_PERCENTS[settings.exaltationLevel] || 0;
  return 1 + (aaPct + exaltPct) / 100;
}

buffEngine.setDurationMultiplierFn(() => durationMultiplierFor(loadCharacterSettings()));

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(channel, payload);
  }
}

logService.watcher.on('line', (line) => buffEngine.handleLine(line));
logService.watcher.on('line', (line) => customTimerEngine.handleLine(line));
logService.watcher.on('status', (status) => {
  if (status.currentFilePath) {
    const baseName = path.basename(status.currentFilePath, path.extname(status.currentFilePath)).replace(/^eqlog_/i, '');
    spellbookService.setCharacterBaseName(baseName);
  }
});
buffEngine.on('buffsChanged', (buffs) => broadcast('buffs:active', buffs));
buffEngine.on('allyBuffsChanged', (buffs) => broadcast('buffs:activeAllies', buffs));
buffEngine.on('memorizedChanged', (names) => broadcast('spellbook:memorized', names));
customTimerEngine.on('activeChanged', (timers) => broadcast('customTimers:active', timers));
buffEngine.on('unknownBuffsChanged', (buffs) => broadcast('buffs:unknown', buffs));
buffEngine.on('ambiguousCastsChanged', (casts) => {
  broadcast('buffs:ambiguous', casts);
  ambiguousPopup.updateVisibility(casts);
});
buffEngine.on('blockedBuffsChanged', (blocked) => broadcast('buffs:blocked', blocked));

app.on('second-instance', () => {
  const win = createMainWindow();
  if (win.isMinimized()) win.restore();
  win.focus();
});

app.whenReady().then(() => {
  iconService.registerProtocol();
  createMainWindow();
  widgetManager.initWidgets();
  logService.init();
  const eqFolder = logService.getState().eqFolder;
  if (eqFolder) {
    const installRoot = resolveInstallRoot(eqFolder);
    iconService.setEqFolder(installRoot);
    spellbookService.setInstallRoot(installRoot);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

ipcMain.handle('log:getState', () => logService.getState());
ipcMain.handle('log:chooseFolder', async () => {
  const state = await logService.chooseFolder();
  if (state.eqFolder) {
    const installRoot = resolveInstallRoot(state.eqFolder);
    iconService.setEqFolder(installRoot);
    spellbookService.setInstallRoot(installRoot);
  }
  return state;
});
ipcMain.handle('log:setSplitEnabled', (_event, enabled) => logService.setSplitEnabled(enabled));
ipcMain.handle('log:setSplitOnGap', (_event, splitOnGap) => logService.setSplitOnGap(splitOnGap));
ipcMain.handle('log:chooseSplitFolder', () => logService.chooseSplitFolder());
ipcMain.handle('log:resetSplitFolder', () => logService.resetSplitFolder());
ipcMain.handle('log:openFolder', () => logService.openLogFolder());
ipcMain.handle('log:archiveNow', () => logService.archiveNow());

ipcMain.handle('buffs:getActive', () => buffEngine.getActiveBuffs());
ipcMain.handle('buffs:getActiveAllies', () => buffEngine.getActiveAllyBuffs());

ipcMain.handle('customTimers:getActive', () => customTimerEngine.getActive());
ipcMain.handle('customTimers:removeActive', (_event, name) => customTimerEngine.removeActive(name));
ipcMain.handle('buffs:getUnknown', () => buffEngine.getUnknownBuffs());
ipcMain.handle('buffs:getKnown', () =>
  buffStore.getAll().map((b) => ({ ...b, iconUrl: b.iconId != null ? iconService.buildIconUrl(b.iconId) : null }))
);
ipcMain.handle('buffs:resolveUnknown', (_event, { name, durationSec, landingText, endedText }) =>
  buffEngine.resolveUnknown(name, durationSec, { landingText, endedText })
);
ipcMain.handle('buffs:dismissUnknown', (_event, name) => buffEngine.dismissUnknown(name));
ipcMain.handle('buffs:removeActive', (_event, name) => buffEngine.removeActiveBuff(name));
ipcMain.handle('buffs:removeActiveAlly', (_event, { allyName, name }) => buffEngine.removeActiveAllyBuff(allyName, name));
ipcMain.handle('buffs:getBlocked', () => buffEngine.getBlockedBuffs());
ipcMain.handle('buffs:blockBuff', (_event, name) => {
  buffEngine.blockBuff(name);
  saveJson('blockedBuffs', buffEngine.getBlockedBuffs());
  return buffEngine.getBlockedBuffs();
});
ipcMain.handle('buffs:unblockBuff', (_event, name) => {
  buffEngine.unblockBuff(name);
  saveJson('blockedBuffs', buffEngine.getBlockedBuffs());
  return buffEngine.getBlockedBuffs();
});
ipcMain.handle('buffs:upsertKnown', (_event, { name, durationSec, landingText, endedText, iconId }) => {
  const result = buffStore.upsert(name, durationSec, { landingText, endedText, iconId });
  broadcast('buffs:active', buffEngine.getActiveBuffs());
  return result;
});
ipcMain.handle('buffs:removeKnown', (_event, name) => buffStore.remove(name));
ipcMain.handle('buffs:renameKnown', (_event, { oldName, newName }) => {
  const result = buffStore.rename(oldName, newName);
  if (result) broadcast('buffs:active', buffEngine.getActiveBuffs());
  return result;
});
ipcMain.handle('buffs:setShowOnOverlay', (_event, { name, showOnOverlay }) => {
  const result = buffStore.setShowOnOverlay(name, showOnOverlay);
  broadcast('buffs:active', buffEngine.getActiveBuffs());
  return result;
});
ipcMain.handle('buffs:setBardSong', (_event, { name, isBardSong }) => {
  const result = buffStore.setBardSong(name, isBardSong);
  broadcast('buffs:active', buffEngine.getActiveBuffs());
  return result;
});

ipcMain.handle('buffs:getAmbiguous', () => buffEngine.getAmbiguousCasts());
ipcMain.handle('buffs:resolveAmbiguous', (_event, { text, buffName }) =>
  buffEngine.resolveAmbiguousCast(text, buffName)
);
ipcMain.handle('buffs:dismissAmbiguous', (_event, text) => buffEngine.dismissAmbiguousCast(text));
ipcMain.handle('buffs:resetAmbiguousResolutions', () => buffEngine.resetAmbiguousResolutions());
ipcMain.handle('buffs:getAmbiguousResolutions', () => buffEngine.getAmbiguousResolutions());
ipcMain.handle('buffs:removeAmbiguousResolution', (_event, { text, isSelf }) => buffEngine.removeAmbiguousResolution(text, isSelf));

ipcMain.handle('settings:getTrackOthers', () => loadJson('trackOthersEnabled', false));
ipcMain.handle('settings:setTrackOthers', (_event, enabled) => {
  saveJson('trackOthersEnabled', enabled);
  buffEngine.setTrackOthersEnabled(enabled);
  return enabled;
});

ipcMain.handle('settings:getAutoHideOverlay', () => autoHideOverlayEnabled);
ipcMain.handle('settings:setAutoHideOverlay', (_event, enabled) => {
  autoHideOverlayEnabled = enabled;
  saveJson('autoHideOverlay', enabled);
  if (enabled) {
    foregroundWatcher.start();
  } else {
    foregroundWatcher.stop();
    widgetManager.setForegroundHidden(false); // always show when the feature's off
  }
  return autoHideOverlayEnabled;
});

ipcMain.handle('settings:getCharacter', () => loadCharacterSettings());
ipcMain.handle('settings:setCharacter', (_event, settings) => {
  saveJson('characterSettings', settings);
  return settings;
});

ipcMain.handle('spellbook:getState', () => ({
  filePath: spellbookService.getFilePath(),
  spellCount: spellbookService.getCount(),
}));
ipcMain.handle('spellbook:getMemorized', () => buffEngine.getCurrentlyMemorized());

ipcMain.handle('widget:list', () => widgetManager.getAllWidgetConfigs());
ipcMain.handle('widget:getConfig', (_event, id) => widgetManager.getWidgetConfig(id));
ipcMain.handle('widget:create', (_event, { name, buffSource }) => widgetManager.createCustomWidget(name, { buffSource }));
ipcMain.handle('widget:createAlly', (_event, { name }) => widgetManager.createAllyBuffsWidget(name));
ipcMain.handle('widget:export', (_event, id) => widgetManager.exportWidget(id));
ipcMain.handle('widget:peekCode', (_event, code) => widgetManager.peekWidgetCode(code));
ipcMain.handle('widget:import', (_event, code) => widgetManager.importWidget(code));
ipcMain.handle('widget:duplicate', (_event, id) => widgetManager.duplicateWidget(id));
ipcMain.handle('widget:applyCodeToSelfBuffs', (_event, code) => widgetManager.applyCodeToSelfBuffs(code));
ipcMain.handle('widget:delete', (_event, id) => widgetManager.deleteWidget(id));
ipcMain.handle('widget:move', (_event, { id, direction }) => widgetManager.moveWidget(id, direction));
ipcMain.handle('widget:setEnabled', (_event, { id, enabled }) => widgetManager.setEnabled(id, enabled));
ipcMain.handle('widget:setName', (_event, { id, value }) => widgetManager.setName(id, value));
ipcMain.handle('widget:toggleLock', (_event, id) => widgetManager.toggleLock(id));
ipcMain.handle('widget:resetPosition', (_event, id) => widgetManager.resetPosition(id));
ipcMain.handle('widget:isLocked', (_event, id) => widgetManager.isLocked(id));
ipcMain.handle('widget:setDisplayMode', (_event, { id, mode }) => widgetManager.setDisplayMode(id, mode));
ipcMain.handle('widget:setTimerFormat', (_event, { id, value }) => widgetManager.setTimerFormat(id, value));
ipcMain.handle('widget:setTextSize', (_event, { id, value }) => widgetManager.setTextSize(id, value));
ipcMain.handle('widget:setIconSize', (_event, { id, value }) => widgetManager.setIconSize(id, value));
ipcMain.handle('widget:setContentAnchor', (_event, { id, value }) => widgetManager.setContentAnchor(id, value));
ipcMain.handle('widget:setIconsPerRow', (_event, { id, value }) => widgetManager.setIconsPerRow(id, value));
ipcMain.handle('widget:setRowSize', (_event, { id, value }) => widgetManager.setRowSize(id, value));
ipcMain.handle('widget:setSortOrder', (_event, { id, value }) => widgetManager.setSortOrder(id, value));
ipcMain.handle('widget:setLowTimeThreshold', (_event, { id, value }) => widgetManager.setLowTimeThreshold(id, value));
ipcMain.handle('widget:setLandingGlowEnabled', (_event, { id, enabled }) => widgetManager.setLandingGlowEnabled(id, enabled));
ipcMain.handle('widget:setHideBardSongs', (_event, { id, hide }) => widgetManager.setHideBardSongs(id, hide));
ipcMain.handle('widget:setShowRowIcon', (_event, { id, enabled }) => widgetManager.setShowRowIcon(id, enabled));
ipcMain.handle('widget:setMirrorRowDirection', (_event, { id, enabled }) => widgetManager.setMirrorRowDirection(id, enabled));
ipcMain.handle('widget:setShowIconLabel', (_event, { id, enabled }) => widgetManager.setShowIconLabel(id, enabled));
ipcMain.handle('widget:setIconLabelSize', (_event, { id, value }) => widgetManager.setIconLabelSize(id, value));
ipcMain.handle('widget:setIconLabelAnchor', (_event, { id, value }) => widgetManager.setIconLabelAnchor(id, value));
ipcMain.handle('widget:setWrapText', (_event, { id, enabled }) => widgetManager.setWrapText(id, enabled));
ipcMain.handle('widget:setIconJustify', (_event, { id, value }) => widgetManager.setIconJustify(id, value));
ipcMain.handle('widget:setMaxDurationFilter', (_event, { id, value }) => widgetManager.setMaxDurationFilter(id, value));
ipcMain.handle('widget:setSoundOnLand', (_event, { id, enabled }) => widgetManager.setSoundOnLand(id, enabled));
ipcMain.handle('widget:setSoundOnExpire', (_event, { id, enabled }) => widgetManager.setSoundOnExpire(id, enabled));
ipcMain.handle('widget:setSoundWarningSec', (_event, { id, value }) => widgetManager.setSoundWarningSec(id, value));
ipcMain.handle('widget:setSoundWarningLoopSec', (_event, { id, value }) => widgetManager.setSoundWarningLoopSec(id, value));
ipcMain.handle('widget:setListWidth', (_event, { id, value }) => widgetManager.setListWidth(id, value));
ipcMain.on('widget:reportContentSize', (_event, { id, width, height, originX }) => widgetManager.fitToContent(id, width, height, originX));
ipcMain.handle('widget:setOpacity', (_event, { id, value }) => widgetManager.setOpacity(id, value));
ipcMain.handle('widget:setBuffFilter', (_event, { id, mode, names }) => widgetManager.setBuffFilter(id, mode, names));
ipcMain.handle('widget:setBuffSource', (_event, { id, source }) => widgetManager.setBuffSource(id, source));
ipcMain.handle('widget:addCustomTimer', (_event, { id, name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId }) =>
  widgetManager.addCustomTimer(id, { name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId })
);
ipcMain.handle(
  'widget:updateCustomTimer',
  (_event, { id, timerId, name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId }) =>
    widgetManager.updateCustomTimer(id, timerId, { name, durationSec, triggerText, endedText, triggerChat, endedChat, iconId })
);
ipcMain.handle('widget:removeCustomTimer', (_event, { id, timerId }) => widgetManager.removeCustomTimer(id, timerId));
ipcMain.handle('widget:excludeBuff', (_event, { id, name }) => widgetManager.excludeBuff(id, name));
ipcMain.handle('widget:unexcludeBuff', (_event, { id, name }) => widgetManager.unexcludeBuff(id, name));
ipcMain.handle('widget:setActiveProfileIds', (_event, { id, profileIds }) => widgetManager.setActiveProfileIds(id, profileIds));

ipcMain.handle('profiles:list', () => profileStore.getAll());
ipcMain.handle('profiles:getActiveId', () => profileStore.getActiveId());
ipcMain.handle('profiles:create', (_event, { name, widgetIdsToMigrate }) => {
  const profile = profileStore.create(name);
  // "Migrate" here just means: check this widget's box in the create-profile
  // modal, and it's added to the new profile's membership list too - see
  // widgetStore.js's activeProfileIds field doc. Additive, not a replace -
  // a widget already active on other profiles keeps that membership.
  for (const id of widgetIdsToMigrate || []) {
    const widget = widgetManager.getWidgetConfig(id);
    if (widget && !widget.activeProfileIds.includes(profile.id)) {
      widgetManager.setActiveProfileIds(id, [...widget.activeProfileIds, profile.id]);
    }
  }
  broadcast('profiles:changed', profileStore.getAll());
  return profile;
});
ipcMain.handle('profiles:rename', (_event, { id, name }) => {
  const profile = profileStore.rename(id, name);
  if (profile) broadcast('profiles:changed', profileStore.getAll());
  return profile;
});
ipcMain.handle('profiles:setActive', (_event, id) => {
  const result = profileStore.setActiveId(id);
  if (result) {
    buffEngine.setActiveProfileId(result);
    broadcast('profiles:activeChanged', result);
  }
  return result;
});
ipcMain.handle('profiles:delete', (_event, id) => {
  const removed = profileStore.remove(id);
  if (!removed) return false;
  // Order matters: drop the profile's own resolution memory and its
  // membership on every widget first, THEN point the engine at whatever
  // profileStore now considers active (unconditionally - a no-op if the
  // deleted profile wasn't the active one, since setActiveProfileId
  // already short-circuits on an unchanged id).
  widgetManager.removeProfileFromAllWidgets(id);
  buffEngine.removeProfile(id);
  buffEngine.setActiveProfileId(profileStore.getActiveId());
  broadcast('profiles:changed', profileStore.getAll());
  broadcast('profiles:activeChanged', profileStore.getActiveId());
  return true;
});

ipcMain.handle('icons:getSets', () => ICON_SETS);
ipcMain.handle('icons:getSet', () => iconService.getIconSet());
ipcMain.handle('icons:setSet', (_event, iconSet) => {
  iconService.setIconSet(iconSet);
  broadcast('buffs:active', buffEngine.getActiveBuffs());
  return iconService.getIconSet();
});
ipcMain.handle('icons:getCount', () => iconService.getIconCount());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Basic round-trip test so we can confirm main <-> preload <-> renderer
// IPC is wired up correctly before building real features on top of it.
ipcMain.handle('app:getVersionInfo', () => {
  return {
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
  };
});
