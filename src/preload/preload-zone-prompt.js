const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqZonePrompt', {
  getPrompt: () => ipcRenderer.invoke('travel:getZonePrompt'),
  // Base zones only, no instance-tier variants (" (Awakened)", " (Fused)") - see
  // pickableZoneNames() in zoneRouting.js.
  getZoneNames: () => ipcRenderer.invoke('travel:getPickableZones'),
  resolvePrompt: (mode, zone) => ipcRenderer.invoke('travel:resolveZonePrompt', { mode, zone }),
  dismissPrompt: () => ipcRenderer.invoke('travel:dismissZonePrompt'),
  stopTracking: () => ipcRenderer.invoke('travel:stopTracking'),
  correctCurrentZone: () => ipcRenderer.invoke('travel:correctCurrentZone'),
  onPromptChanged: (callback) => {
    ipcRenderer.on('travel:zonePrompt', (_event, prompt) => callback(prompt));
  },
});
