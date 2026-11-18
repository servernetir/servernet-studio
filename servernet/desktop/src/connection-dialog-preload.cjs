// SPDX-License-Identifier: AGPL-3.0-only
const {ipcRenderer} = require('electron');

ipcRenderer.once('studio-connection-dialog:show', (_event, {code, lang, theme, text}) => {
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.documentElement.dataset.theme = theme;
  document.getElementById('connection-code').textContent = code;
  for (const key of ['title', 'instructions', 'codeLabel', 'continue', 'cancel', 'hint']) {
    document.getElementById(key).textContent = text[key];
  }
  for (const action of ['continue', 'cancel']) {
    document.getElementById(action).addEventListener('click', () => ipcRenderer.send('studio-connection-dialog:action', action));
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      ipcRenderer.send('studio-connection-dialog:action', 'cancel');
    }
  });
  document.body.hidden = false;
  document.getElementById('continue').focus();
});
