const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqNudgePad', {
  nudge: (widgetId, dx, dy) => ipcRenderer.send('widget:nudgeSelf', { id: widgetId, dx, dy }),
  onStep: (cb) => ipcRenderer.on('widget:nudgeStep', (_e, px) => cb(px)),
  getStep: () => ipcRenderer.invoke('widget:getNudgeStep'),
});
