const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqNudgePad', {
  nudge: (id, kind, dx, dy) => ipcRenderer.send('nudgePad:nudge', { id, kind, dx, dy }),
  onStep: (cb) => ipcRenderer.on('widget:nudgeStep', (_e, px) => cb(px)),
  getStep: () => ipcRenderer.invoke('widget:getNudgeStep'),
});
