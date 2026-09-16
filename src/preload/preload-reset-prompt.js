const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('eqResetPrompt', {
  getPending: () => ipcRenderer.invoke('resetPrompt:getPending'),
  answer: (choice) => ipcRenderer.invoke('resetPrompt:answer', choice),
  onPendingChanged: (callback) => {
    ipcRenderer.on('resetPrompt:pending', (_event, pending) => callback(pending));
  },
});
