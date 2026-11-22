const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('widget', {
  onUsage: (fn) => ipcRenderer.on('usage', (_, u) => fn(u)),
  onActivity: (fn) => ipcRenderer.on('activity', (_, a) => fn(a)),
  onRequests: (fn) => ipcRenderer.on('requests', (_, r) => fn(r)),
  onDone: (fn) => ipcRenderer.on('done', (_, d) => fn(d)),
  onNote: (fn) => ipcRenderer.on('note', (_, n) => fn(n)),
  onSettings: (fn) => ipcRenderer.on('settings', (_, s) => fn(s)),
  onMedia: (fn) => ipcRenderer.on('media', (_, m) => fn(m)),
  onSessions: (fn) => ipcRenderer.on('sessions', (_, l) => fn(l)),
  onKey: (fn) => ipcRenderer.on('key', (_, k) => fn(k)),
  onLyrics: (fn) => ipcRenderer.on('lyrics', (_, l) => fn(l)),
  onLevel: (fn) => ipcRenderer.on('level', (_, v) => fn(v)),
  mediaCmd: (cmd) => ipcRenderer.send('media:cmd', cmd),
  answer: (id, decision) => ipcRenderer.send('answer', id, decision),
  refresh: () => ipcRenderer.send('refresh'),
  interactive: (on) => ipcRenderer.send('interactive', on),
  menu: () => ipcRenderer.send('menu'),
});
