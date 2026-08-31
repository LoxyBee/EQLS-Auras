const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('eqGridGuide', {
  onSize: (cb) => ipcRenderer.on('gridGuide:size', (_e, px) => cb(px)),
});
