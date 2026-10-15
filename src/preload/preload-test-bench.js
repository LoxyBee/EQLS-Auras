const { contextBridge, ipcRenderer } = require('electron');

// Test bench window (dev builds only) - see src/main/testBench.js.
contextBridge.exposeInMainWorld('eqTestBench', {
  getState: () => ipcRenderer.invoke('testBench:getState'),
  getPresets: () => ipcRenderer.invoke('testBench:getPresets'),
  getHistory: () => ipcRenderer.invoke('testBench:getHistory'),
  send: (text) => ipcRenderer.invoke('testBench:send', text),
  runPreset: (index) => ipcRenderer.invoke('testBench:runPreset', index),
  removeHistory: (line) => ipcRenderer.invoke('testBench:removeHistory', line),
  clearHistory: () => ipcRenderer.invoke('testBench:clearHistory'),
  setExamples: (on) => ipcRenderer.invoke('testBench:setExamples', on),
  stop: () => ipcRenderer.invoke('testBench:stop'),
  onState: (cb) => ipcRenderer.on('testBench:state', (_e, s) => cb(s)),
  onHistory: (cb) => ipcRenderer.on('testBench:history', (_e, h) => cb(h)),
});
