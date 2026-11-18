// SPDX-License-Identifier: AGPL-3.0-only
// Exercise the packaged dialog's local document and sandboxed preload with fixture codes.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {app, BrowserWindow, clipboard} from 'electron';
import {confirmConnection} from '../src/connection-dialog.mjs';

let stage = 'starting Electron';
const timeout = setTimeout(() => {
  console.error('Connection dialog smoke check timed out while ' + stage);
  app.exit(1);
}, 30000);
await app.whenReady();
const parent = new BrowserWindow({width: 520, height: 460, webPreferences: {sandbox: true}});
const code = 'ABCD-1234';
const originalClipboard = clipboard.readText();

async function testDialog(config, expected, action) {
  stage = 'opening the ' + config.lang + ' dialog';
  const controller = new AbortController();
  const result = confirmConnection(parent, code, config, controller.signal);
  const opened = result.then(() => { throw Error('The dialog closed before loading.'); });
  const popup = BrowserWindow.getAllWindows().find(window => window.getParentWindow() === parent);
  assert.ok(popup?.isModal());
  await Promise.race([once(popup.webContents, 'did-finish-load'), opened]);
  stage = 'checking the ' + config.lang + ' dialog content';
  for (let attempt = 0; attempt < 100; attempt++) {
    if (popup.isDestroyed()) throw Error('The dialog closed before it could display its content.');
    const page = await popup.webContents.executeJavaScript(`
      document.body && !document.body.hidden ? ({
        code: document.getElementById('connection-code')?.textContent,
        direction: document.documentElement.dir,
        theme: document.documentElement.dataset.theme,
        fits: document.documentElement.scrollHeight <= window.innerHeight,
        node: typeof require,
      }) : null
    `);
    if (!page?.code) {
      await sleep(50);
      continue;
    }
    assert.deepEqual(page, {code, direction: expected, theme: config.theme, fits: true, node: 'undefined'});
    stage = 'checking ' + action + ' in the ' + config.lang + ' dialog';
    if (action === 'abort') controller.abort();
    else if (action === 'escape') {
      void popup.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))").catch(() => {});
    } else {
      void popup.webContents.executeJavaScript("document.getElementById('continue').click()").catch(() => {});
    }
    assert.equal(await result, action === 'continue');
    console.log('Verified ' + config.lang + ' / ' + config.theme + ' / ' + action);
    return;
  }
  controller.abort();
  throw Error('The dialog did not display the connection code.');
}

try {
  await testDialog({lang: 'en', theme: 'dark'}, 'ltr', 'continue');
  assert.equal(clipboard.readText(), code);
  await testDialog({lang: 'fa', theme: 'light'}, 'rtl', 'escape');
  await testDialog({lang: 'tr', theme: 'dark'}, 'ltr', 'abort');
  console.log('Connection dialog rendered in all three languages. Copy, cancellation and abort checks passed.');
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  clipboard.writeText(originalClipboard);
  clearTimeout(timeout);
  app.exit(process.exitCode || 0);
}
