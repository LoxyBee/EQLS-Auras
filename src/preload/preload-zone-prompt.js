const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqZonePrompt', {
  getPrompt: () => ipcRenderer.invoke('travel:getZonePrompt'),
  // Base zones only, no instance-tier variants (" (Awakened)", " (Fused)") - see
  // pickableZoneNames() in zoneRouting.js.
  getZoneNames: () => ipcRenderer.invoke('travel:getPickableZones'),
  // QOL #30 - resolves a query through nicknames / boss names / client short names as well as the
  // plain display-name substring match. Returns the unioned zone-name list.
  searchZones: (query) => ipcRenderer.invoke('travel:searchZones', query),
  resolvePrompt: (mode, zone) => ipcRenderer.invoke('travel:resolveZonePrompt', { mode, zone }),
  dismissPrompt: () => ipcRenderer.invoke('travel:dismissZonePrompt'),
  stopTracking: () => ipcRenderer.invoke('travel:stopTracking'),
  correctCurrentZone: () => ipcRenderer.invoke('travel:correctCurrentZone'),
  onPromptChanged: (callback) => {
    ipcRenderer.on('travel:zonePrompt', (_event, prompt) => callback(prompt));
  },
});
