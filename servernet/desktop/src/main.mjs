// SPDX-License-Identifier: AGPL-3.0-only
import {app, BrowserWindow, Menu, dialog, shell, net, ipcMain} from 'electron';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import updater from 'electron-updater';
import {COOKIE, ORIGIN, UPDATE_FEED, DOWNLOADS, signinOptions, internal, external, conversationExport, mediaExport} from './policy.mjs';
import {signIn} from './signin.mjs';
import {confirmConnection} from './connection-dialog.mjs';
import {installBrowserWorkspace, workspacePreload} from './browser-workspace.mjs';

app.setName('ServerNet Studio');
if (!app.requestSingleInstanceLock()) app.quit();
let window, login, updating = false;
const offline = fileURLToPath(new URL('./offline.html', import.meta.url));
const ownPage = () => window && (internal(window.webContents.getURL()) || window.webContents.getURL() === new URL('./offline.html', import.meta.url).href);
const labels = {
  fa: {
    connection: 'اتصال سرورنت', failed: 'اتصال ممکن نشد. اینترنت و وضعیت سرویس را بررسی کنید.',
    continue: 'ادامه', cancel: 'انصراف', update: 'بررسی نسخهٔ جدید', reconnect: 'اتصال دوباره',
    newVersion: 'دریافت نسخهٔ جدید', download: 'نسخهٔ جدید آماده است. دانلود شود؟',
    current: 'نسخهٔ شما به‌روز است.', install: 'دانلود تمام شد. برنامه برای نصب نسخهٔ جدید بسته شود؟',
  },
  en: {
    connection: 'ServerNet connection', failed: 'Unable to connect. Check your connection and service status.',
    continue: 'Continue', cancel: 'Cancel', update: 'Check for updates', reconnect: 'Reconnect',
    newVersion: 'New version', download: 'Download the new version?',
    current: 'You are up to date.', install: 'Download finished. Close the app and install the update?',
  },
  tr: {
    connection: 'ServerNet bağlantısı', failed: 'Bağlantı kurulamadı. Bağlantınızı ve hizmet durumunu kontrol edin.',
    continue: 'Devam et', cancel: 'İptal', update: 'Güncellemeleri denetle', reconnect: 'Yeniden bağlan',
    newVersion: 'Yeni sürüm', download: 'Yeni sürüm indirilsin mi?',
    current: 'Uygulamanız güncel.', install: 'İndirme tamamlandı. Güncellemek için uygulama kapatılsın mı?',
  },
};
const words = (lang) => labels[lang] || labels.en;
const locale = () => app.getLocale().split('-')[0];
const disconnectWorkspace = installBrowserWorkspace({ipcMain, BrowserWindow, dialog, studioWindow: () => window, locale});

async function post(path, body, signal) {
  const response = await net.fetch(ORIGIN + path, {method:'POST', redirect:'error', credentials:'omit',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify(body),
    signal:AbortSignal.any([signal, AbortSignal.timeout(20000)])});
  if (Number(response.headers.get('content-length')) > 8000) throw Error('Response too large.');
  const reader = response.body.getReader(); let text = '', size = 0;
  const decoder = new TextDecoder();
  while (true) { const part = await reader.read(); if (part.done) break; size += part.value.length;
    if(size > 8000) { await reader.cancel(); throw Error('Response too large.'); } text += decoder.decode(part.value,{stream:true}); }
  text += decoder.decode();
  return {status:response.status, data:JSON.parse(text)};
}
async function startLogin(options) {
  if(login || !ownPage()) return;
  login = new AbortController(); const controller = login, t = words(options.lang);
  try { await signIn(options, {
    post, now:Date.now, sleep:(ms,signal)=>sleep(ms,undefined,{signal}),
    confirmCode:code=>confirmConnection(window, code, options, controller.signal),
    open:(value)=>shell.openExternal(value), setCookie:(cookie)=>window.webContents.session.cookies.set(cookie),
    complete:async(value)=>{await window.webContents.session.cookies.flushStore(); await window.loadURL(value); window.show(); window.focus();},
  }, controller.signal); } catch { if(!controller.signal.aborted && window && !window.isDestroyed()) await dialog.showMessageBox(window,{type:'error',title:t.connection,message:t.failed}); }
  finally { if(login === controller) login = null; }
}
async function checkUpdates() {
  if(updating || !app.isPackaged) return;
  updating=true; const t=words(locale());
  try {
    const result=await updater.autoUpdater.checkForUpdates();
    if(!result || result.updateInfo.version === app.getVersion()) { await dialog.showMessageBox(window,{message:t.current}); return; }
    const answer=await dialog.showMessageBox(window,{message:t.newVersion,detail:t.download,buttons:[t.continue,t.cancel],cancelId:1});
    if(answer.response!==0) return;
    await updater.autoUpdater.downloadUpdate();
    const install=await dialog.showMessageBox(window,{message:t.install,buttons:[t.continue,t.cancel],cancelId:1});
    if(install.response===0) updater.autoUpdater.quitAndInstall(false,true);
  } catch { await dialog.showMessageBox(window,{type:'error',message:t.failed}); } finally {updating=false;}
}
async function createWindow() {
  window = new BrowserWindow({width:1280,height:850,minWidth:390,minHeight:600,title:'ServerNet Studio',
    backgroundColor:'#0b1324',icon:fileURLToPath(new URL('../build/icon.png',import.meta.url)),
    webPreferences:{nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,
      webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,spellcheck:false,partition:'persist:servernet-studio',
      preload:fileURLToPath(workspacePreload)}});
  const contents=window.webContents, session=contents.session;
  session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  session.setPermissionCheckHandler(()=>false);
  contents.on('will-attach-webview', event=>event.preventDefault());
  contents.on('will-navigate',(event,value)=>{
    const options=signinOptions(value);
    if(options){event.preventDefault(); void startLogin(options);return;}
    if(!internal(value)){event.preventDefault();if(ownPage()&&external(value)) void shell.openExternal(value);}
  });
  contents.on('will-frame-navigate',(event)=>{if(!event.isMainFrame)event.preventDefault();});
  contents.on('will-redirect',(event,value)=>{if(!internal(value))event.preventDefault();});
  contents.on('did-start-navigation', event => {
    if (event.isMainFrame && !event.isSameDocument) disconnectWorkspace();
  });
  contents.setWindowOpenHandler(({url})=>{if(ownPage()&&external(url))void shell.openExternal(url);return{action:'deny'};});
  function onDownload(event, item, sender) {
    const mime=item.getMimeType();
    const filename = sender === contents && ownPage() && item.getURLChain().length === 1
      ? (mime==='text/plain' ? conversationExport(item.getURL()) : mediaExport(item.getURL(),mime)) : null;
    if (!filename) {
      event.preventDefault();
      return;
    }
    item.setSaveDialogOptions({defaultPath: filename, filters: [{name: 'Studio', extensions: [filename.split('.').at(-1)]}]});
  }
  function onSessionChange(_event, cookie, _cause, removed) {
    if (removed && cookie.name === COOKIE && cookie.domain === new URL(ORIGIN).hostname) disconnectWorkspace();
  }
  session.on('will-download', onDownload);
  session.cookies.on('changed', onSessionChange);
  window.on('closed',()=>{
    session.removeListener('will-download', onDownload);
    session.cookies.removeListener('changed', onSessionChange);
    disconnectWorkspace(); login?.abort(); window=null;
  });
  contents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{
    if(isMainFrame && code!==-3 && window) void window.loadFile(offline);
  });
  const t=words(locale());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{role:'appMenu'}]:[]),
    {label:'ServerNet',submenu:[{label:t.reconnect,click:()=>{login?.abort();void window.loadURL(ORIGIN);}},{label:t.update,click:checkUpdates},
      {label:'Downloads / دانلود',click:()=>shell.openExternal(DOWNLOADS)},
      {label:'Legal / مجوزها',click:()=>shell.openExternal(ORIGIN+'/legal')},{type:'separator'},{role:'quit'}]},
    {role:'editMenu'}, {role:'viewMenu',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
  ]));
  await window.loadURL(ORIGIN).catch(()=>{});
}
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('before-quit',()=>{disconnectWorkspace();login?.abort();});
app.whenReady().then(async()=>{
  updater.autoUpdater.logger=null; updater.autoUpdater.autoDownload=false; updater.autoUpdater.autoInstallOnAppQuit=false;
  updater.autoUpdater.allowPrerelease=false; updater.autoUpdater.allowDowngrade=false;
  updater.autoUpdater.setFeedURL({provider:'generic',url:UPDATE_FEED});
  updater.autoUpdater.on('error',()=>{});
  await createWindow(); app.on('activate',()=>{if(!window)void createWindow();});
});
