const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqTracker', {
  getVersionInfo: () => ipcRenderer.invoke('app:getVersionInfo'),

  getUiScale: () => ipcRenderer.invoke('ui:getScale'),
  setUiScale: (pct) => ipcRenderer.invoke('ui:setScale', pct),
  getSidebarWidth: () => ipcRenderer.invoke('ui:getSidebarWidth'),
  setSidebarWidth: (px) => ipcRenderer.invoke('ui:setSidebarWidth', px),
  getMergeRule: () => ipcRenderer.invoke('ui:getMergeRule'),
  setMergeRule: (rule) => ipcRenderer.invoke('ui:setMergeRule', rule),
  getTradePing: () => ipcRenderer.invoke('ui:getTradePing'),
  setTradePing: (enabled) => ipcRenderer.invoke('ui:setTradePing', enabled),

  minimizeWindow: () => ipcRenderer.invoke('window:minimize'),
  toggleMaximizeWindow: () => ipcRenderer.invoke('window:maximizeToggle'),
  closeWindow: () => ipcRenderer.invoke('window:close'),
  isWindowMaximized: () => ipcRenderer.invoke('window:isMaximized'),
  onWindowMaximizedChange: (callback) => {
    ipcRenderer.on('window:maximized', () => callback(true));
    ipcRenderer.on('window:unmaximized', () => callback(false));
  },

  getLogState: () => ipcRenderer.invoke('log:getState'),
  chooseLogFolder: () => ipcRenderer.invoke('log:chooseFolder'),
  onLogStatus: (callback) => {
    ipcRenderer.on('log:status', (_event, status) => callback(status));
  },
  onLogLine: (callback) => {
    ipcRenderer.on('log:line', (_event, line) => callback(line));
  },
  onLogError: (callback) => {
    ipcRenderer.on('log:error', (_event, message) => callback(message));
  },
  onDebugLine: (callback) => {
    ipcRenderer.on('debug:line', (_event, line) => callback(line));
  },
  setSplitEnabled: (enabled) => ipcRenderer.invoke('log:setSplitEnabled', enabled),
  setSplitOnGap: (splitOnGap) => ipcRenderer.invoke('log:setSplitOnGap', splitOnGap),
  chooseSplitFolder: () => ipcRenderer.invoke('log:chooseSplitFolder'),
  resetSplitFolder: () => ipcRenderer.invoke('log:resetSplitFolder'),
  openLogFolder: () => ipcRenderer.invoke('log:openFolder'),
  archiveLogNow: () => ipcRenderer.invoke('log:archiveNow'),

  getActiveBuffs: () => ipcRenderer.invoke('buffs:getActive'),
  getUnknownBuffs: () => ipcRenderer.invoke('buffs:getUnknown'),
  getKnownBuffs: () => ipcRenderer.invoke('buffs:getKnown'),
  resolveUnknownBuff: (name, durationSec, options = {}) =>
    ipcRenderer.invoke('buffs:resolveUnknown', { name, durationSec, ...options }),
  dismissUnknownBuff: (name) => ipcRenderer.invoke('buffs:dismissUnknown', name),
  removeActiveBuff: (name) => ipcRenderer.invoke('buffs:removeActive', name),
  getActiveAllyBuffs: () => ipcRenderer.invoke('buffs:getActiveAllies'),
  removeActiveAllyBuff: (allyName, name) => ipcRenderer.invoke('buffs:removeActiveAlly', { allyName, name }),
  onActiveAllyBuffsChanged: (callback) => {
    ipcRenderer.on('buffs:activeAllies', (_event, buffs) => callback(buffs));
  },

  getActiveCustomTimers: () => ipcRenderer.invoke('customTimers:getActive'),
  removeActiveCustomTimer: (id) => ipcRenderer.invoke('customTimers:removeActive', id),
  onActiveCustomTimersChanged: (callback) => {
    ipcRenderer.on('customTimers:active', (_event, timers) => callback(timers));
  },
  getBlockedBuffs: () => ipcRenderer.invoke('buffs:getBlocked'),
  blockBuff: (name) => ipcRenderer.invoke('buffs:blockBuff', name),
  unblockBuff: (name) => ipcRenderer.invoke('buffs:unblockBuff', name),
  onBlockedBuffsChanged: (callback) => {
    ipcRenderer.on('buffs:blocked', (_event, blocked) => callback(blocked));
  },
  upsertKnownBuff: (name, durationSec, options = {}) =>
    ipcRenderer.invoke('buffs:upsertKnown', { name, durationSec, ...options }),
  removeKnownBuff: (name) => ipcRenderer.invoke('buffs:removeKnown', name),
  renameKnownBuff: (oldName, newName) => ipcRenderer.invoke('buffs:renameKnown', { oldName, newName }),
  onActiveBuffsChanged: (callback) => {
    ipcRenderer.on('buffs:active', (_event, buffs) => callback(buffs));
  },
  onUnknownBuffsChanged: (callback) => {
    ipcRenderer.on('buffs:unknown', (_event, buffs) => callback(buffs));
  },
  setShowOnOverlay: (name, showOnOverlay) =>
    ipcRenderer.invoke('buffs:setShowOnOverlay', { name, showOnOverlay }),
  setBardSong: (name, isBardSong) => ipcRenderer.invoke('buffs:setBardSong', { name, isBardSong }),
  setNoDurationScaling: (name, value) => ipcRenderer.invoke('buffs:setNoDurationScaling', { name, value }),

  getAmbiguousCasts: () => ipcRenderer.invoke('buffs:getAmbiguous'),
  resolveAmbiguousCast: (text, buffName) => ipcRenderer.invoke('buffs:resolveAmbiguous', { text, buffName }),
  dismissAmbiguousCast: (text) => ipcRenderer.invoke('buffs:dismissAmbiguous', text),
  resetAmbiguousResolutions: () => ipcRenderer.invoke('buffs:resetAmbiguousResolutions'),
  getAmbiguousResolutions: () => ipcRenderer.invoke('buffs:getAmbiguousResolutions'),
  removeAmbiguousResolution: (text, isSelf) => ipcRenderer.invoke('buffs:removeAmbiguousResolution', { text, isSelf }),
  onAmbiguousCastsChanged: (callback) => {
    ipcRenderer.on('buffs:ambiguous', (_event, casts) => callback(casts));
  },

  getTrackOthersEnabled: () => ipcRenderer.invoke('settings:getTrackOthers'),
  setTrackOthersEnabled: (enabled) => ipcRenderer.invoke('settings:setTrackOthers', enabled),
  getAutoHideOverlayEnabled: () => ipcRenderer.invoke('settings:getAutoHideOverlay'),
  getShowAurasWhenAppFocused: () => ipcRenderer.invoke('settings:getShowAurasWhenAppFocused'),
  setShowAurasWhenAppFocused: (enabled) => ipcRenderer.invoke('settings:setShowAurasWhenAppFocused', enabled),
  getOverlayMasterState: () => ipcRenderer.invoke('overlay:getMasterState'),
  setOverlayAllUnlocked: (unlocked) => ipcRenderer.invoke('overlay:setAllUnlocked', unlocked),
  setOverlayMasterHidden: (hidden) => ipcRenderer.invoke('overlay:setMasterHidden', hidden),
  onOverlayMasterStateChanged: (callback) => {
    ipcRenderer.on('overlay:masterStateChanged', () => callback());
  },
  setAutoHideOverlayEnabled: (enabled) => ipcRenderer.invoke('settings:setAutoHideOverlay', enabled),

  getSpellbookState: () => ipcRenderer.invoke('spellbook:getState'),
  getMemorizedSpells: () => ipcRenderer.invoke('spellbook:getMemorized'),
  forgetMemorizedSpell: (name) => ipcRenderer.invoke('spellbook:forgetMemorized', name),
  clearMemorizedSpells: () => ipcRenderer.invoke('spellbook:clearMemorized'),
  onMemorizedSpellsChanged: (callback) => {
    ipcRenderer.on('spellbook:memorized', (_event, names) => callback(names));
  },

  getCharacterSettings: () => ipcRenderer.invoke('settings:getCharacter'),
  setCharacterSettings: (settings) => ipcRenderer.invoke('settings:setCharacter', settings),

  listWidgets: () => ipcRenderer.invoke('widget:list'),
  createWidget: (name, buffSource) => ipcRenderer.invoke('widget:create', { name, buffSource }),
  createAllyBuffsWidget: (name) => ipcRenderer.invoke('widget:createAlly', { name }),
  createSoundOnlyWidget: (name) => ipcRenderer.invoke('widget:createSoundOnly', { name }),
  setWidgetMergeSameDuration: (id, value) =>
    ipcRenderer.invoke('widget:setMergeSameDuration', { id, value }),
  onOpenWidgetSettings: (callback) => {
    ipcRenderer.on('widget:openSettings', (_event, id) => callback(id));
  },
  exportWidget: (id) => ipcRenderer.invoke('widget:export', id),
  peekWidgetCode: (code) => ipcRenderer.invoke('widget:peekCode', code),
  importWidget: (code) => ipcRenderer.invoke('widget:import', code),
  duplicateWidget: (id) => ipcRenderer.invoke('widget:duplicate', id),
  applyCodeToSelfBuffs: (code) => ipcRenderer.invoke('widget:applyCodeToSelfBuffs', code),
  deleteWidget: (id) => ipcRenderer.invoke('widget:delete', id),
  moveWidget: (id, direction) => ipcRenderer.invoke('widget:move', { id, direction }),
  setWidgetName: (id, name) => ipcRenderer.invoke('widget:setName', { id, value: name }),
  toggleWidgetLock: (id) => ipcRenderer.invoke('widget:toggleLock', id),
  resetWidgetPosition: (id) => ipcRenderer.invoke('widget:resetPosition', id),
  isWidgetLocked: (id) => ipcRenderer.invoke('widget:isLocked', id),
  setWidgetDisplayMode: (id, mode) => ipcRenderer.invoke('widget:setDisplayMode', { id, mode }),
  setWidgetTimerFormat: (id, format) => ipcRenderer.invoke('widget:setTimerFormat', { id, value: format }),
  setWidgetTextSize: (id, size) => ipcRenderer.invoke('widget:setTextSize', { id, value: size }),
  setWidgetIconSize: (id, size) => ipcRenderer.invoke('widget:setIconSize', { id, value: size }),
  setWidgetContentAnchor: (id, anchor) => ipcRenderer.invoke('widget:setContentAnchor', { id, value: anchor }),
  setWidgetIconsPerRow: (id, count) => ipcRenderer.invoke('widget:setIconsPerRow', { id, value: count }),
  setWidgetRowSize: (id, size) => ipcRenderer.invoke('widget:setRowSize', { id, value: size }),
  setWidgetSortOrder: (id, order) => ipcRenderer.invoke('widget:setSortOrder', { id, value: order }),
  setWidgetLowTimeThreshold: (id, seconds) => ipcRenderer.invoke('widget:setLowTimeThreshold', { id, value: seconds }),
  setWidgetLandingGlowEnabled: (id, enabled) => ipcRenderer.invoke('widget:setLandingGlowEnabled', { id, enabled }),
  setWidgetHideBardSongs: (id, hide) => ipcRenderer.invoke('widget:setHideBardSongs', { id, hide }),
  setWidgetShowRowIcon: (id, enabled) => ipcRenderer.invoke('widget:setShowRowIcon', { id, enabled }),
  setWidgetMirrorRowDirection: (id, enabled) => ipcRenderer.invoke('widget:setMirrorRowDirection', { id, enabled }),
  setWidgetShowIconLabel: (id, enabled) => ipcRenderer.invoke('widget:setShowIconLabel', { id, enabled }),
  setWidgetIconLabelSize: (id, size) => ipcRenderer.invoke('widget:setIconLabelSize', { id, value: size }),
  setWidgetIconLabelAnchor: (id, anchor) => ipcRenderer.invoke('widget:setIconLabelAnchor', { id, value: anchor }),
  setWidgetTimerTextColor: (id, value) => ipcRenderer.invoke('widget:setTimerTextColor', { id, value }),
  setWidgetGroupAllyBuffs: (id, value) => ipcRenderer.invoke('widget:setGroupAllyBuffs', { id, value }),
  setWidgetGroupAllyDirection: (id, value) => ipcRenderer.invoke('widget:setGroupAllyDirection', { id, value }),
  setWidgetHideAllyNameOnTile: (id, value) => ipcRenderer.invoke('widget:setHideAllyNameOnTile', { id, value }),
  setWidgetLabelTextColor: (id, value) => ipcRenderer.invoke('widget:setLabelTextColor', { id, value }),
  setWidgetIconMargin: (id, value) => ipcRenderer.invoke('widget:setIconMargin', { id, value }),
  setWidgetWrapText: (id, enabled) => ipcRenderer.invoke('widget:setWrapText', { id, enabled }),
  setWidgetIconJustify: (id, value) => ipcRenderer.invoke('widget:setIconJustify', { id, value }),
  setWidgetMaxDurationFilter: (id, seconds) => ipcRenderer.invoke('widget:setMaxDurationFilter', { id, value: seconds }),
  setWidgetSoundOnLand: (id, enabled) => ipcRenderer.invoke('widget:setSoundOnLand', { id, enabled }),
  setWidgetSoundOnExpire: (id, enabled) => ipcRenderer.invoke('widget:setSoundOnExpire', { id, enabled }),
  setWidgetSoundWarningSec: (id, seconds) => ipcRenderer.invoke('widget:setSoundWarningSec', { id, value: seconds }),
  setWidgetSoundWarningLoopSec: (id, seconds) => ipcRenderer.invoke('widget:setSoundWarningLoopSec', { id, value: seconds }),
  setWidgetLandSoundId: (id, soundId) => ipcRenderer.invoke('widget:setLandSoundId', { id, soundId }),
  setWidgetExpireSoundId: (id, soundId) => ipcRenderer.invoke('widget:setExpireSoundId', { id, soundId }),
  setWidgetWarningSoundId: (id, soundId) => ipcRenderer.invoke('widget:setWarningSoundId', { id, soundId }),
  setWidgetAlertVolume: (id, volume) => ipcRenderer.invoke('widget:setAlertVolume', { id, value: volume }),
  pickSound: () => ipcRenderer.invoke('sounds:pick'),
  getSoundInfo: (id) => ipcRenderer.invoke('sounds:getInfo', id),
  openSoundsFolder: () => ipcRenderer.invoke('sounds:openFolder'),
  setWidgetListWidth: (id, width) => ipcRenderer.invoke('widget:setListWidth', { id, value: width }),
  setWidgetOpacity: (id, opacity) => ipcRenderer.invoke('widget:setOpacity', { id, value: opacity }),
  setWidgetBuffFilter: (id, mode, names) => ipcRenderer.invoke('widget:setBuffFilter', { id, mode, names }),
  setWidgetBuffSource: (id, source) => ipcRenderer.invoke('widget:setBuffSource', { id, source }),
  addWidgetCustomTimer: (id, timer) => ipcRenderer.invoke('widget:addCustomTimer', { id, ...timer }),
  updateWidgetCustomTimer: (id, timerId, timer) =>
    ipcRenderer.invoke('widget:updateCustomTimer', { id, timerId, ...timer }),
  removeWidgetCustomTimer: (id, timerId) => ipcRenderer.invoke('widget:removeCustomTimer', { id, timerId }),
  excludeWidgetBuff: (id, name) => ipcRenderer.invoke('widget:excludeBuff', { id, name }),
  unexcludeWidgetBuff: (id, name) => ipcRenderer.invoke('widget:unexcludeBuff', { id, name }),
  setWidgetActiveProfileIds: (id, profileIds) => ipcRenderer.invoke('widget:setActiveProfileIds', { id, profileIds }),

  getProfiles: () => ipcRenderer.invoke('profiles:list'),
  getActiveProfileId: () => ipcRenderer.invoke('profiles:getActiveId'),
  createProfile: (name, widgetIdsToMigrate) => ipcRenderer.invoke('profiles:create', { name, widgetIdsToMigrate }),
  renameProfile: (id, name) => ipcRenderer.invoke('profiles:rename', { id, name }),
  setActiveProfile: (id) => ipcRenderer.invoke('profiles:setActive', id),
  deleteProfile: (id) => ipcRenderer.invoke('profiles:delete', id),
  onProfilesChanged: (callback) => {
    ipcRenderer.on('profiles:changed', (_event, profiles) => callback(profiles));
  },
  onActiveProfileChanged: (callback) => {
    ipcRenderer.on('profiles:activeChanged', (_event, id) => callback(id));
  },

  getIconSets: () => ipcRenderer.invoke('icons:getSets'),
  getIconSet: () => ipcRenderer.invoke('icons:getSet'),
  setIconSet: (iconSet) => ipcRenderer.invoke('icons:setSet', iconSet),
  getIconCount: () => ipcRenderer.invoke('icons:getCount'),
});
