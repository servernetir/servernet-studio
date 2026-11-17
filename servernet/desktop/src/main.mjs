// SPDX-License-Identifier: AGPL-3.0-only
import {app, BrowserWindow, Menu, dialog, shell, net, clipboard} from 'electron';
import {fileURLToPath} from 'node:url';
import {setTimeout as sleep} from 'node:timers/promises';
import updater from 'electron-updater';
import {ORIGIN, UPDATE_FEED, DOWNLOADS, signinOptions, internal, external} from './policy.mjs';
import {signIn} from './signin.mjs';

app.setName('ServerNet Studio');
if (!app.requestSingleInstanceLock()) app.quit();
let window, login, updating = false;
const offline = fileURLToPath(new URL('./offline.html', import.meta.url));
const ownPage = () => window && (internal(window.webContents.getURL()) || window.webContents.getURL() === new URL('./offline.html', import.meta.url).href);
const labels = {fa:['اتصال سرورنت','کد اتصال برنامه','کد زیر را کپی کنید و در صفحهٔ مرورگر وارد کنید. فقط اتصال همین برنامه را تأیید کنید.','کپی کد و ادامه','انصراف','اتصال ممکن نشد. اینترنت و وضعیت سرویس را بررسی کنید.','بررسی نسخهٔ جدید','اتصال دوباره','دریافت نسخهٔ جدید','نسخهٔ جدید آماده است. دانلود شود؟','نسخهٔ شما به‌روز است.','دانلود تمام شد. برنامه برای نصب نسخهٔ جدید بسته شود؟'],
 en:['ServerNet connection','Desktop connection code','Copy this code and enter it in the browser. Approve only this desktop app.','Copy code and continue','Cancel','Unable to connect. Check your connection and service status.','Check for updates','Reconnect','New version','Download the new version?','You are up to date.','Download finished. Close the app and install the update?'],
 tr:['ServerNet bağlantısı','Uygulama bağlantı kodu','Bu kodu kopyalayıp tarayıcıya girin. Yalnızca bu uygulamayı onaylayın.','Kopyala ve devam et','İptal','Bağlantı kurulamadı. Bağlantınızı ve hizmet durumunu kontrol edin.','Güncellemeleri denetle','Yeniden bağlan','Yeni sürüm','Yeni sürüm indirilsin mi?','Uygulamanız güncel.','İndirme tamamlandı. Güncellemek için uygulama kapatılsın mı?']};
const words = (lang) => labels[lang] || labels.en;
const locale = () => app.getLocale().split('-')[0];

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
    confirmCode:async(code)=>{ const result=await dialog.showMessageBox(window,{type:'info',title:t[1],message:code,detail:t[2],buttons:[t[3],t[4]],defaultId:0,cancelId:1});
      if(result.response!==0) return false; clipboard.writeText(code); return true; },
    open:(value)=>shell.openExternal(value), setCookie:(cookie)=>window.webContents.session.cookies.set(cookie),
    complete:async(value)=>{await window.webContents.session.cookies.flushStore(); await window.loadURL(value); window.show(); window.focus();},
  }, controller.signal); } catch { if(!controller.signal.aborted && window && !window.isDestroyed()) await dialog.showMessageBox(window,{type:'error',title:t[0],message:t[5]}); }
  finally { if(login === controller) login = null; }
}
async function checkUpdates() {
  if(updating || !app.isPackaged) return;
  updating=true; const t=words(locale());
  try {
    const result=await updater.autoUpdater.checkForUpdates();
    if(!result || result.updateInfo.version === app.getVersion()) { await dialog.showMessageBox(window,{message:t[10]}); return; }
    const answer=await dialog.showMessageBox(window,{message:t[8],detail:t[9],buttons:[t[3],t[4]],cancelId:1});
    if(answer.response!==0) return;
    await updater.autoUpdater.downloadUpdate();
    const install=await dialog.showMessageBox(window,{message:t[11],buttons:[t[3],t[4]],cancelId:1});
    if(install.response===0) updater.autoUpdater.quitAndInstall(false,true);
  } catch { await dialog.showMessageBox(window,{type:'error',message:t[5]}); } finally {updating=false;}
}
async function createWindow() {
  window = new BrowserWindow({width:1280,height:850,minWidth:390,minHeight:600,title:'ServerNet Studio',
    backgroundColor:'#f7f9fc',icon:fileURLToPath(new URL('../build/icon.png',import.meta.url)),
    webPreferences:{nodeIntegration:false,nodeIntegrationInWorker:false,contextIsolation:true,sandbox:true,
      webSecurity:true,allowRunningInsecureContent:false,webviewTag:false,spellcheck:false,partition:'persist:servernet-studio'}});
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
  contents.setWindowOpenHandler(({url})=>{if(ownPage()&&external(url))void shell.openExternal(url);return{action:'deny'};});
  session.on('will-download',event=>event.preventDefault());
  window.on('closed',()=>{login?.abort();window=null;});
  contents.on('did-fail-load',(_event,code,_description,_url,isMainFrame)=>{
    if(isMainFrame && code!==-3 && window) void window.loadFile(offline);
  });
  const t=words(locale());
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform==='darwin'?[{role:'appMenu'}]:[]),
    {label:'ServerNet',submenu:[{label:t[7],click:()=>{login?.abort();void window.loadURL(ORIGIN);}},{label:t[6],click:checkUpdates},
      {label:'Downloads / دانلود',click:()=>shell.openExternal(DOWNLOADS)},
      {label:'Legal / مجوزها',click:()=>shell.openExternal(ORIGIN+'/legal')},{type:'separator'},{role:'quit'}]},
    {role:'editMenu'}, {role:'viewMenu',submenu:[{role:'resetZoom'},{role:'zoomIn'},{role:'zoomOut'},{role:'togglefullscreen'}]},
  ]));
  await window.loadURL(ORIGIN).catch(()=>{});
}
app.on('second-instance',()=>{if(window){if(window.isMinimized())window.restore();window.focus();}});
app.on('window-all-closed',()=>{if(process.platform!=='darwin')app.quit();});
app.on('before-quit',()=>login?.abort());
app.whenReady().then(async()=>{
  updater.autoUpdater.logger=null; updater.autoUpdater.autoDownload=false; updater.autoUpdater.autoInstallOnAppQuit=false;
  updater.autoUpdater.allowPrerelease=false; updater.autoUpdater.allowDowngrade=false;
  updater.autoUpdater.setFeedURL({provider:'generic',url:UPDATE_FEED});
  updater.autoUpdater.on('error',()=>{});
  await createWindow(); app.on('activate',()=>{if(!window)void createWindow();});
});
