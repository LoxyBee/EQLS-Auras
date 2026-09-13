const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqProfileFlash', {
  onShow: (cb) => ipcRenderer.on('profileFlash:show', (_e, name) => cb(name)),
  done: () => ipcRenderer.send('profileFlash:done'),
});
