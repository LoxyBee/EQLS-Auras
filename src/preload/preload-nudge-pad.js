const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqNudgePad', {
  nudge: (id, kind, dx, dy, alt) => ipcRenderer.send('nudgePad:nudge', { id, kind, dx, dy, alt: !!alt }),
  openSettings: (id) => ipcRenderer.send('nudgePad:openSettings', id),
  onStep: (cb) => ipcRenderer.on('widget:nudgeStep', (_e, px) => cb(px)),
  getStep: () => ipcRenderer.invoke('widget:getNudgeStep'),
});
