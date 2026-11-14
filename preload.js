/* preload.js — jembatan aman antara index.html dan main process */
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('electronAPI', {
  isElectron: true,
  updateSplash: sp => ipcRenderer.invoke('update-splash', { version: sp.version, htmlUrl: sp.htmlUrl, htmlSha256: sp.htmlSha256, imgUrl: sp.imgUrl, imgSha256: sp.imgSha256 }),
  applyUpdate: info => ipcRenderer.invoke('apply-update', { version: info.version, htmlUrl: info.htmlUrl, sha256: info.sha256 })
});
