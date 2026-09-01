const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqOverlay', {
  getConfig: (widgetId) => ipcRenderer.invoke('widget:getConfig', widgetId),
  getActiveBuffs: () => ipcRenderer.invoke('buffs:getActive'),
  onActiveBuffsChanged: (callback) => {
    ipcRenderer.on('buffs:active', (_event, buffs) => callback(buffs));
  },
  getActiveAllyBuffs: () => ipcRenderer.invoke('buffs:getActiveAllies'),
  onActiveAllyBuffsChanged: (callback) => {
    ipcRenderer.on('buffs:activeAllies', (_event, buffs) => callback(buffs));
  },
  getActiveBardSongs: () => ipcRenderer.invoke('buffs:getActiveBardSongs'),
  onActiveBardSongsChanged: (callback) => {
    ipcRenderer.on('buffs:activeBardSongs', (_event, songs) => callback(songs));
  },
  getActiveCustomTimers: () => ipcRenderer.invoke('customTimers:getActive'),
  onActiveCustomTimersChanged: (callback) => {
    ipcRenderer.on('customTimers:active', (_event, timers) => callback(timers));
  },
  getTravelRoutes: () => ipcRenderer.invoke('travel:getRoutes'),
  onTravelRoutesChanged: (callback) => {
    ipcRenderer.on('travel:routes', (_event, routes) => callback(routes));
  },
  getActiveDamage: () => ipcRenderer.invoke('damage:getActive'),
  onActiveDamageChanged: (callback) => {
    ipcRenderer.on('damage:active', (_event, rows) => callback(rows));
  },
  // Backlog #33 - the current raid zone's named-kill board.
  getActiveRaidNamed: () => ipcRenderer.invoke('raidNamed:getActive'),
  onRaidNamedChanged: (callback) => {
    ipcRenderer.on('raidNamed:active', (_event, rows) => callback(rows));
  },
  // feat/module-system - one channel carrying every custom module's live entries, keyed by
  // module id. A module aura reads its own slice (see overlay.js currentSourceBuffs).
  getModuleEntries: () => ipcRenderer.invoke('modules:entries'),
  onModuleEntries: (callback) => {
    ipcRenderer.on('modules:entries', (_event, all) => callback(all));
  },
  getLockState: (widgetId) => ipcRenderer.invoke('widget:isLocked', widgetId),
  onLockChanged: (callback) => {
    ipcRenderer.on('widget:lockChanged', (_event, locked) => callback(locked));
  },
  getMergeRule: () => ipcRenderer.invoke('ui:getMergeRule'),
  onMergeRuleChanged: (callback) => {
    ipcRenderer.on('ui:mergeRuleChanged', (_event, rule) => callback(rule));
  },
  getAudible: (widgetId) => ipcRenderer.invoke('widget:isAudible', widgetId),
  onAudibleChanged: (callback) => {
    ipcRenderer.on('widget:audibleChanged', (_event, audible) => callback(audible));
  },
  onConfigChanged: (callback) => {
    ipcRenderer.on('widget:configChanged', (_event, config) => callback(config));
  },
  // "Show example content" - a persistent toggle (from the aura's own settings, or the Overlay
  // page's all-auras control). While on, an empty aura fills with a sample tile.
  onPreviewMode: (callback) => {
    ipcRenderer.on('widget:previewMode', (_event, opts) => callback(opts || {}));
  },
  reportContentSize: (widgetId, width, height, originX) => {
    ipcRenderer.send('widget:reportContentSize', { id: widgetId, width, height, originX });
  },
  // Note 6. Only the second thing an overlay window can send to the main process - it is
  // otherwise receive-only, which is why this needed a new channel rather than an existing one.
  openSettings: (widgetId) => {
    ipcRenderer.send('widget:openSettings', widgetId);
  },
  // Routes into the SAME debugLog() every main-process detection line already goes through - see
  // main.js's own debugLogEnabled gate. An overlay window can't write the file itself (renderer,
  // no fs access), so this is fire-and-forget, same shape as reportContentSize/openSettings above.
  debugLog: (message) => {
    ipcRenderer.send('debug:logLine', message);
  },
});
