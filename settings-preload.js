const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sneakpeek', {
  get: () => ipcRenderer.invoke('cfg:get'),
  set: (patch) => ipcRenderer.invoke('cfg:set', patch),
  setIntegration: (key, on) => ipcRenderer.invoke('int:set', key, on),
  removeAll: () => ipcRenderer.invoke('int:removeAll'),
  setStartup: (on) => ipcRenderer.invoke('startup:set', on),
  checkUpdate: () => ipcRenderer.invoke('update:check'),
  runUpdate: () => ipcRenderer.invoke('update:run'),
  openRepo: () => ipcRenderer.send('open:repo'),
  onChanged:(fn) => ipcRenderer.on('cfg:changed', () => fn()),
});
