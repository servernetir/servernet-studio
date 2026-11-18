// SPDX-License-Identifier: AGPL-3.0-only
import {randomUUID} from 'node:crypto';
import {COOKIE, ORIGIN, url} from './policy.mjs';

export const workspacePreload = new URL('./browser-workspace-preload.cjs', import.meta.url);
const idle = {connected: false, origin: null, width: 0, height: 0};

const labels = {
  en: {
    title: 'Studio browser workspace', open: 'Open an isolated browser workspace?',
    openDetail: 'Studio opens this HTTPS site in a separate window. Your existing browser sessions stay separate. Close the window to disconnect.',
    action: 'Allow this one action in the browser workspace?',
    click: (x, y) => `Click at (${x}, ${y})`, type: text => `Type the following text:\n${text}`,
    cancel: 'Cancel', allow: 'Allow once',
  },
  fa: {
    title: 'فضای مرورگر استودیو', open: 'فضای مرورگر مجزا باز شود؟',
    openDetail: 'استودیو این سایت HTTPS را در پنجره‌ای مجزا باز می‌کند. نشست‌های فعلی مرورگر جدا می‌مانند. برای قطع اتصال، پنجره را ببندید.',
    action: 'این اقدام در فضای مرورگر تأیید شود؟',
    click: (x, y) => `کلیک در نقطهٔ (${x}, ${y})`, type: text => `درج متن زیر:\n${text}`,
    cancel: 'انصراف', allow: 'فقط همین بار',
  },
  tr: {
    title: 'Studio tarayıcı çalışma alanı', open: 'Yalıtılmış tarayıcı çalışma alanı açılsın mı?',
    openDetail: 'Studio bu HTTPS sitesini ayrı bir pencerede açar. Mevcut tarayıcı oturumlarınız ayrı kalır. Bağlantıyı kesmek için pencereyi kapatın.',
    action: 'Tarayıcı çalışma alanında bu tek eyleme izin verilsin mi?',
    click: (x, y) => `(${x}, ${y}) noktasına tıkla`, type: text => `Şu metni yaz:\n${text}`,
    cancel: 'İptal', allow: 'Bir kez izin ver',
  },
};

export function workspaceAddress(value) {
  if (typeof value !== 'string' || value.length > 2048 || /[\s\x00-\x1f\x7f]/u.test(value)) return null;
  const parsed = url(value);
  return parsed?.protocol === 'https:' && parsed.origin !== ORIGIN ? parsed : null;
}

export function workspaceAction(input, {width, height}) {
  if (input?.kind === 'click' && Number.isInteger(input.x) && Number.isInteger(input.y)
      && input.x >= 0 && input.y >= 0 && input.x < width && input.y < height) {
    return {kind: 'click', x: input.x, y: input.y};
  }
  if (input?.kind === 'type' && typeof input.text === 'string' && input.text.trim()
      && input.text.length <= 700 && [...input.text].length <= 350
      && !/[\p{Cc}\p{Cs}\p{Zl}\p{Zp}\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/u.test(input.text)) {
    return {kind: 'type', text: input.text};
  }
  throw Error('Invalid browser workspace action.');
}

function senderIsStudio(event, owner) {
  if (!owner || owner.isDestroyed() || event.sender !== owner.webContents) return false;
  const frame = event.senderFrame;
  if (!frame || frame !== owner.webContents.mainFrame) return false;
  const parsed = url(frame.url);
  return parsed?.origin === ORIGIN && parsed.pathname === '/';
}

function isLive(scope) {
  if (!scope || scope.win.isDestroyed() || scope.win.webContents.isLoadingMainFrame()) return false;
  return workspaceAddress(scope.win.webContents.getURL())?.origin === scope.origin;
}

export function installBrowserWorkspace({ipcMain, BrowserWindow, dialog, studioWindow, locale, now = () => performance.now()}) {
  let scope, generation = 0, busy = false, lastPrompt = -Infinity;

  function disconnect() {
    generation++;
    const active = scope;
    scope = null;
    if (active && !active.win.isDestroyed()) active.win.destroy();
  }

  function status() {
    if (!isLive(scope)) return idle;
    const {width, height} = scope.win.getContentBounds();
    return {connected: true, origin: scope.origin, width, height};
  }

  async function confirm(window, labelsForLocale, message, detail) {
    lastPrompt = now();
    const result = await dialog.showMessageBox(window, {
      type: 'warning', title: labelsForLocale.title, message, detail,
      buttons: [labelsForLocale.cancel, labelsForLocale.allow], defaultId: 0, cancelId: 0, noLink: true,
    });
    return result.response === 1;
  }

  async function isAuthorized(event) {
    if (!senderIsStudio(event, studioWindow())) return false;
    const cookies = await event.sender.session.cookies.get({url: ORIGIN, name: COOKIE});
    return senderIsStudio(event, studioWindow()) && cookies.some(cookie => cookie.hostOnly && cookie.secure && cookie.httpOnly);
  }

  function createWindow(address, t) {
    const win = new BrowserWindow({
      title: `${t.title} · ${address.origin}`, width: 960, height: 700, minWidth: 390, minHeight: 300,
      show: false, fullscreenable: false,
      webPreferences: {
        nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, webviewTag: false,
        allowRunningInsecureContent: false, devTools: false, safeDialogs: true, partition: `studio-browser-${randomUUID()}`,
      },
    });
    const contents = win.webContents;
    const session = contents.session;
    const active = {win, origin: address.origin, revision: 0};
    session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    session.setPermissionCheckHandler(() => false);
    session.on('will-download', event => event.preventDefault());
    contents.setWindowOpenHandler(() => ({action: 'deny'}));
    contents.on('will-attach-webview', event => event.preventDefault());
    const limitNavigation = event => {
      if (!event.isMainFrame || workspaceAddress(event.url)?.origin !== active.origin) event.preventDefault();
    };
    contents.on('will-frame-navigate', limitNavigation);
    contents.on('will-redirect', limitNavigation);
    contents.on('did-start-navigation', () => { active.revision++; });
    contents.on('render-process-gone', () => { if (scope === active) disconnect(); });
    win.on('page-title-updated', event => event.preventDefault());
    win.on('closed', () => {
      if (scope === active) scope = null;
      void session.clearStorageData().catch(() => {});
    });
    return active;
  }

  async function open(event, address, t) {
    const target = workspaceAddress(address);
    if (!target) throw Error('Enter a valid HTTPS address.');
    if (scope) throw Error('Disconnect the existing workspace first.');
    const requestGeneration = generation;
    if (!await confirm(studioWindow(), t, t.open, `${target.href}\n\n${t.openDetail}`)) return status();
    if (!await isAuthorized(event) || requestGeneration !== generation) return status();
    const active = createWindow(target, t);
    scope = active;
    const timeout = setTimeout(() => { if (scope === active) disconnect(); }, 20000);
    try {
      await active.win.loadURL(target.href);
      if (scope !== active || !isLive(active)) throw Error('Browser workspace navigation was blocked.');
      active.win.show();
      return status();
    } catch {
      if (scope === active) disconnect();
      throw Error('Could not load the approved HTTPS address.');
    } finally {
      clearTimeout(timeout);
    }
  }

  async function perform(event, input, t) {
    const active = scope;
    if (!isLive(active) || active.win.isMinimized()) return {performed: false};
    const viewport = active.win.getContentBounds();
    const action = workspaceAction(input, viewport);
    const revision = active.revision;
    const detail = action.kind === 'type' ? t.type(action.text) : t.click(action.x, action.y);
    if (!await confirm(active.win, t, t.action, `${active.origin}\n\n${detail}`)) return {performed: false};
    if (!await isAuthorized(event) || scope !== active || !isLive(active) || active.revision !== revision) return {performed: false};
    const currentViewport = active.win.getContentBounds();
    if (currentViewport.width !== viewport.width || currentViewport.height !== viewport.height) return {performed: false};
    active.win.focus();
    if (!active.win.isFocused()) return {performed: false};
    const contents = active.win.webContents;
    if (action.kind === 'type') await contents.insertText(action.text);
    else {
      const position = {x: action.x, y: action.y, button: 'left', clickCount: 1};
      contents.sendInputEvent({type: 'mouseDown', ...position});
      contents.sendInputEvent({type: 'mouseUp', ...position});
    }
    return {performed: true};
  }

  function handler(action) {
    return async (event, value) => {
      if (!await isAuthorized(event)) throw Error('Browser workspace access denied.');
      if (action === status) return status();
      if (action === disconnect) {
        disconnect();
        return status();
      }
      if (busy || now() - lastPrompt < 600) throw Error('A browser workspace permission request is already active.');
      busy = true;
      try { return await action(event, value, labels[locale()] || labels.en); }
      finally { busy = false; }
    };
  }

  ipcMain.handle('studio-browser:status', handler(status));
  ipcMain.handle('studio-browser:open', handler(open));
  ipcMain.handle('studio-browser:perform', handler(perform));
  ipcMain.handle('studio-browser:close', handler(disconnect));
  return disconnect;
}
