// SPDX-License-Identifier: AGPL-3.0-only
// Exercise the packaged dialog's local document and sandboxed preload with fixture codes.
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {setTimeout as sleep} from 'node:timers/promises';
import {app, BrowserWindow, clipboard} from 'electron';
import {confirmConnection} from '../src/connection-dialog.mjs';

const timeout = setTimeout(() => app.exit(1), 20000);
await app.whenReady();
const parent = new BrowserWindow({width: 520, height: 460, webPreferences: {sandbox: true}});
const code = 'ABCD-1234';
const originalClipboard = clipboard.readText();

async function testDialog(config, expected, action) {
  const controller = new AbortController();
  const result = confirmConnection(parent, code, config, controller.signal);
  const popup = BrowserWindow.getAllWindows().find(window => window.getParentWindow() === parent);
  assert.ok(popup?.isModal());
  await once(popup.webContents, 'did-finish-load');
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
    if (action === 'abort') controller.abort();
    else if (action === 'escape') {
      await popup.webContents.executeJavaScript("document.dispatchEvent(new KeyboardEvent('keydown', {key:'Escape'}))");
    } else {
      await popup.webContents.executeJavaScript("document.getElementById('continue').click()");
    }
    assert.equal(await result, action === 'continue');
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
