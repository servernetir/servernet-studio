// SPDX-License-Identifier: AGPL-3.0-only
import {BrowserWindow, clipboard, ipcMain} from 'electron';
import {fileURLToPath} from 'node:url';

const page = new URL('./connection-dialog.html', import.meta.url);
const preload = fileURLToPath(new URL('./connection-dialog-preload.cjs', import.meta.url));
const actionChannel = 'studio-connection-dialog:action';
const text = {
  en: {
    title: 'Connect this device',
    instructions: 'Paste this code in your browser to finish signing in to Studio.',
    codeLabel: 'Connection code',
    continue: 'Copy code and open browser',
    cancel: 'Cancel',
    hint: 'Use this code only for a sign-in you started.',
  },
  fa: {
    title: 'اتصال این دستگاه',
    instructions: 'برای تکمیل ورود به استودیو، این کد را در مرورگر وارد کنید.',
    codeLabel: 'کد اتصال',
    continue: 'کپی کد و باز کردن مرورگر',
    cancel: 'انصراف',
    hint: 'این کد را فقط برای ورودی که خودتان آغاز کرده‌اید، استفاده کنید.',
  },
  tr: {
    title: 'Bu cihazı bağlayın',
    instructions: 'Studio’da oturum açmayı tamamlamak için bu kodu tarayıcınıza yapıştırın.',
    codeLabel: 'Bağlantı kodu',
    continue: 'Kodu kopyala ve tarayıcıyı aç',
    cancel: 'İptal',
    hint: 'Bu kodu yalnızca başlattığınız bir giriş için kullanın.',
  },
};

export function confirmConnection(parent, code, {lang, theme}, signal) {
  if (signal.aborted || parent.isDestroyed()) return Promise.resolve(false);
  return new Promise((resolve, reject) => {
    const modal = new BrowserWindow({
      parent, modal: true, show: false, frame: false, resizable: false,
      minimizable: false, maximizable: false, useContentSize: true,
      width: 460, height: 398, title: 'ServerNet Studio',
      backgroundColor: theme === 'light' ? '#f7faff' : '#101b30',
      webPreferences: {
        preload, nodeIntegration: false, contextIsolation: true, sandbox: true,
        webSecurity: true, webviewTag: false, devTools: false, partition: 'studio-connection-dialog',
      },
    });
    const contents = modal.webContents;
    let finished = false;
    function finish(confirmed, error) {
      if (finished) return;
      finished = true;
      ipcMain.removeListener(actionChannel, onAction);
      signal.removeEventListener('abort', cancel);
      if (!modal.isDestroyed()) modal.close();
      if (error) reject(error);
      else resolve(confirmed);
    }
    function cancel() {
      finish(false);
    }
    function onAction(event, action) {
      if (event.sender !== contents || event.senderFrame !== contents.mainFrame || event.senderFrame.url !== page.href) return;
      if (action === 'cancel') cancel();
      if (action !== 'continue' || finished || signal.aborted) return;
      clipboard.writeText(code);
      finish(true);
    }
    ipcMain.on(actionChannel, onAction);
    signal.addEventListener('abort', cancel, {once: true});
    modal.on('closed', cancel);
    contents.on('will-frame-navigate', event => event.preventDefault());
    contents.on('will-redirect', event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({action: 'deny'}));
    contents.once('did-finish-load', () => {
      contents.send('studio-connection-dialog:show', {code, lang, theme, text: text[lang] ?? text.en});
      modal.show();
    });
    void modal.loadFile(fileURLToPath(page)).catch(error => finish(false, error));
  });
}
