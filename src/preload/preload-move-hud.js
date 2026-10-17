const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqMoveHud', {
  // { mode, aura: {x,y,width,height}, name, stepPx, snapEnabled, snapSizePx } - on open and every move.
  onFrame: (cb) => ipcRenderer.on('moveHud:frame', (_e, payload) => cb(payload)),
  setStep: (px) => ipcRenderer.invoke('moveHud:setStep', px),
  centre: (axis) => ipcRenderer.invoke('moveHud:centre', axis),
  setSnap: (enabled, sizePx) => ipcRenderer.invoke('moveHud:setSnap', { enabled, sizePx }),
  resetPosition: () => ipcRenderer.invoke('moveHud:resetPosition'),
  done: () => ipcRenderer.invoke('moveHud:done'),
  undo: () => ipcRenderer.invoke('moveHud:undo'),
  redo: () => ipcRenderer.invoke('moveHud:redo'),
  // The panel's rendered size, so the window can be fitted to it.
  fitTo: (width, height) => ipcRenderer.send('moveHud:fitTo', { width, height }),
  // "Move together" folders: 'group' | 'single' (this aura only).
  setGroupMode: (mode) => ipcRenderer.invoke('moveHud:setGroupMode', mode),
});
