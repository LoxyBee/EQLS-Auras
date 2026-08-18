const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqAmbiguous', {
  getAmbiguousCasts: () => ipcRenderer.invoke('buffs:getAmbiguous'),
  resolveAmbiguousCast: (text, buffName) => ipcRenderer.invoke('buffs:resolveAmbiguous', { text, buffName }),
  dismissAmbiguousCast: (text) => ipcRenderer.invoke('buffs:dismissAmbiguous', text),
  onAmbiguousCastsChanged: (callback) => {
    ipcRenderer.on('buffs:ambiguous', (_event, casts) => callback(casts));
  },
});
