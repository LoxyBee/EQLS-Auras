const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqMoveHud', {
  // { aura: {x,y,width,height}, name, x, y, stepPx } - pushed on open and on every aura move.
  onFrame: (cb) => ipcRenderer.on('moveHud:frame', (_e, payload) => cb(payload)),
  // Flip the window between click-through and interactive as the pointer enters/leaves a control.
  setInteractive: (on) => ipcRenderer.send('moveHud:setInteractive', !!on),
  nudge: (dx, dy) => ipcRenderer.invoke('moveHud:nudge', { dx, dy }),
  setStep: (px) => ipcRenderer.invoke('moveHud:setStep', px),
  setSnap: (enabled, sizePx) => ipcRenderer.invoke('moveHud:setSnap', { enabled, sizePx }),
  resetPosition: () => ipcRenderer.invoke('moveHud:resetPosition'),
  done: () => ipcRenderer.invoke('moveHud:done'),
});
