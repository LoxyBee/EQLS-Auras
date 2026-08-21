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
  getActiveCustomTimers: () => ipcRenderer.invoke('customTimers:getActive'),
  onActiveCustomTimersChanged: (callback) => {
    ipcRenderer.on('customTimers:active', (_event, timers) => callback(timers));
  },
  getLockState: (widgetId) => ipcRenderer.invoke('widget:isLocked', widgetId),
  onLockChanged: (callback) => {
    ipcRenderer.on('widget:lockChanged', (_event, locked) => callback(locked));
  },
  getAudible: (widgetId) => ipcRenderer.invoke('widget:isAudible', widgetId),
  onAudibleChanged: (callback) => {
    ipcRenderer.on('widget:audibleChanged', (_event, audible) => callback(audible));
  },
  onConfigChanged: (callback) => {
    ipcRenderer.on('widget:configChanged', (_event, config) => callback(config));
  },
  reportContentSize: (widgetId, width, height, originX) => {
    ipcRenderer.send('widget:reportContentSize', { id: widgetId, width, height, originX });
  },
  // Note 6. Only the second thing an overlay window can send to the main process - it is
  // otherwise receive-only, which is why this needed a new channel rather than an existing one.
  openSettings: (widgetId) => {
    ipcRenderer.send('widget:openSettings', widgetId);
  },
});
