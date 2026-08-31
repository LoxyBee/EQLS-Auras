const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqMoveHud', {
  // { aura: {x,y,width,height}, name, stepPx, snapEnabled, snapSizePx } - on open and every aura move.
  onFrame: (cb) => ipcRenderer.on('moveHud:frame', (_e, payload) => cb(payload)),
  nudge: (dx, dy) => ipcRenderer.invoke('moveHud:nudge', { dx, dy }),
  setStep: (px) => ipcRenderer.invoke('moveHud:setStep', px),
  setSnap: (enabled, sizePx) => ipcRenderer.invoke('moveHud:setSnap', { enabled, sizePx }),
  resetPosition: () => ipcRenderer.invoke('moveHud:resetPosition'),
  done: () => ipcRenderer.invoke('moveHud:done'),
});
