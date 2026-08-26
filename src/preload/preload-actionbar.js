const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqActionBar', {
  getConfig: (barId) => ipcRenderer.invoke('actionBar:getConfig', barId),
  getIconSet: () => ipcRenderer.invoke('icons:getSet'),
  onConfigChanged: (callback) => {
    ipcRenderer.on('actionBar:configChanged', (_event, config) => callback(config));
  },
  getLockState: (barId) => ipcRenderer.invoke('actionBar:isLocked', barId),
  onLockChanged: (callback) => {
    ipcRenderer.on('actionBar:lockChanged', (_event, locked) => callback(locked));
  },
  // Same global channel every widget overlay already reads its custom timers from - gem
  // cooldowns ride through it as pseudo-widgets (see actionBarManager.getPseudoWidgets), so this
  // renderer just filters the same broadcast for its own `actionBarSlot:<index>` ids.
  getActiveCustomTimers: () => ipcRenderer.invoke('customTimers:getActive'),
  onActiveCustomTimersChanged: (callback) => {
    ipcRenderer.on('customTimers:active', (_event, timers) => callback(timers));
  },
  // Stance/invocation "active" border overlay - a separate feed from the customTimers one above,
  // since abilityGroups.js's cross-gem mutual exclusion isn't something a pseudo-widget trigger
  // can express (see main.js's own comment on why it's a standalone tracker).
  getAbilityGroupState: () => ipcRenderer.invoke('actionBar:getAbilityGroupState'),
  onAbilityGroupStateChanged: (callback) => {
    ipcRenderer.on('actionBar:abilityGroupChanged', (_event, states) => callback(states));
  },
});
