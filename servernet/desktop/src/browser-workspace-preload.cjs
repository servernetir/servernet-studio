// SPDX-License-Identifier: AGPL-3.0-only
const {contextBridge, ipcRenderer} = require('electron');

if (process.isMainFrame && location.origin === 'https://studio.servernet.cloud' && location.pathname === '/') {
  contextBridge.exposeInMainWorld('servernetDesktop', {
    status: () => ipcRenderer.invoke('studio-browser:status'),
    openWorkspace: url => ipcRenderer.invoke('studio-browser:open', url),
    perform: action => ipcRenderer.invoke('studio-browser:perform', action),
    closeWorkspace: () => ipcRenderer.invoke('studio-browser:close'),
  });
}
