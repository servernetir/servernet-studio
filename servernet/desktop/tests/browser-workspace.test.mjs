// SPDX-License-Identifier: AGPL-3.0-only
import {EventEmitter} from 'node:events';
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {installBrowserWorkspace, workspaceAction, workspaceAddress} from '../src/browser-workspace.mjs';
import {ORIGIN} from '../src/policy.mjs';

function fixture(approve = () => ({response: 1})) {
  let clock = 0, cookie = true;
  const calls = [], windows = [], handlers = {}, typed = [];
  const frame = {url: ORIGIN + '/#connectors'};
  const contents = {mainFrame: frame, session: {cookies: {get: async () => cookie ? [{hostOnly: true, secure: true, httpOnly: true}] : []}}};
  const owner = {isDestroyed: () => false, webContents: contents};
  const trustedEvent = {sender: contents, senderFrame: frame};

  class FakeWindow extends EventEmitter {
    constructor(options) {
      super();
      this.options = options;
      this.viewport = {width: 820, height: 480};
      this.closed = false;
      this.focused = false;
      const session = Object.assign(new EventEmitter(), {
        setPermissionRequestHandler: handler => { session.requestPermission = handler; },
        setPermissionCheckHandler: handler => { session.mayUsePermission = handler; },
        clearStorageData: async () => { session.cleared = true; },
      });
      this.webContents = Object.assign(new EventEmitter(), {
        session,
        getURL: () => this.currentUrl,
        isLoadingMainFrame: () => false,
        setWindowOpenHandler: handler => { this.popup = handler; },
        insertText: async text => { typed.push({text}); },
        sendInputEvent: event => { typed.push(event); },
      });
      windows.push(this);
    }
    isDestroyed() { return this.closed; }
    isMinimized() { return false; }
    isFocused() { return this.focused; }
    focus() { this.focused = true; }
    show() { this.shown = true; }
    getContentBounds() { return this.viewport; }
    async loadURL(url) { this.currentUrl = url; }
    destroy() { this.closed = true; this.emit('closed'); }
  }

  const disconnect = installBrowserWorkspace({
    ipcMain: {handle: (name, listener) => { handlers[name] = listener; }}, BrowserWindow: FakeWindow,
    dialog: {showMessageBox: async (...args) => { calls.push(args); return approve(...args); }},
    studioWindow: () => owner, locale: () => 'en', now: () => clock,
  });
  return {
    calls, windows, typed, frame, trustedEvent, disconnect,
    invoke: (action, value, sender = trustedEvent) => { clock += 1000; return handlers[`studio-browser:${action}`](sender, value); },
    logout: () => { cookie = false; },
  };
}

test('only a signed-in Studio main frame can use the local workspace bridge', async () => {
  const f = fixture();
  const otherContents = {mainFrame: f.frame};
  await assert.rejects(f.invoke('status', undefined, {...f.trustedEvent, sender: otherContents}), /access denied/);
  await assert.rejects(f.invoke('status', undefined, {...f.trustedEvent, senderFrame: {...f.frame}}), /access denied/);
  f.frame.url = ORIGIN + '/legal';
  await assert.rejects(f.invoke('status'), /access denied/);
  f.frame.url = ORIGIN + '/#connectors';
  f.logout();
  await assert.rejects(f.invoke('open', 'https://example.test/'), /access denied/);
  assert.equal(f.calls.length, 0);
});

test('workspace addresses and input stay inside the HTTPS page and its viewport', () => {
  for (const value of ['http://example.test', 'https://me@example.test', 'https://example.test\n', 'file:///tmp/a', ORIGIN]) {
    assert.equal(workspaceAddress(value), null);
  }
  assert.equal(workspaceAddress('https://example.test/a').origin, 'https://example.test');
  for (const action of [null, {kind: 'click', x: 820, y: 0}, {kind: 'click', x: -1, y: 5},
    {kind: 'click', x: 1.5, y: 5}, {kind: 'type', text: 'foo\nbar'}, {kind: 'type', text: '\u202Eabc'},
    {kind: 'type', text: '️🙂'.repeat(350)}, {kind: 'keypress', key: 'Enter'}, {kind: 'script', text: '1'}]) {
    assert.throws(() => workspaceAction(action, {width: 820, height: 480}), /Invalid browser workspace action/);
  }
  assert.deepEqual(workspaceAction({kind: 'type', text: 'سلام'}, {width: 820, height: 480}), {kind: 'type', text: 'سلام'});
});

test('a local approval opens an isolated browser and limits redirects, permissions and popups', async () => {
  const f = fixture();
  const status = await f.invoke('open', 'https://example.test/start');
  assert.deepEqual(status, {connected: true, origin: 'https://example.test', width: 820, height: 480});
  const [win] = f.windows;
  assert.equal(win.shown, true);
  assert.equal(win.options.webPreferences.sandbox, true);
  assert.match(win.options.webPreferences.partition, /^studio-browser-/);
  assert.equal(win.options.webPreferences.preload, undefined);
  assert.equal(win.webContents.session.mayUsePermission(), false);
  assert.deepEqual(win.popup(), {action: 'deny'});
  for (const [url, isMainFrame, expected] of [
    ['https://example.test/page', true, false], ['https://example.test/page', false, true],
    ['https://elsewhere.test/layout', true, true], ['myprotocol://launch', true, true],
  ]) {
    for (const event of ['will-frame-navigate', 'will-redirect']) {
      let blocked = false;
      win.webContents.emit(event, {url, isMainFrame, preventDefault: () => { blocked = true; }});
      assert.equal(blocked, expected);
    }
  }
  const revoked = await f.invoke('close');
  assert.equal(revoked.connected, false);
  assert.equal(win.closed, true);
  assert.equal(win.webContents.session.cleared, true);
});

test('denied, stale and approved actions are handled individually', async () => {
  let choice = 1, moved = false;
  const f = fixture(() => {
    if (moved) f.windows[0].webContents.emit('did-start-navigation');
    return {response: choice};
  });
  await f.invoke('open', 'https://example.test/');
  choice = 0;
  assert.deepEqual(await f.invoke('perform', {kind: 'type', text: 'do not apply'}), {performed: false});
  choice = 1;
  moved = true;
  assert.deepEqual(await f.invoke('perform', {kind: 'click', x: 200, y: 300}), {performed: false});
  assert.equal(f.typed.length, 0);
  moved = false;
  assert.deepEqual(await f.invoke('perform', {kind: 'click', x: 200, y: 300}), {performed: true});
  assert.deepEqual(await f.invoke('perform', {kind: 'type', text: 'approved'}), {performed: true});
  assert.deepEqual(f.typed, [
    {type: 'mouseDown', x: 200, y: 300, button: 'left', clickCount: 1},
    {type: 'mouseUp', x: 200, y: 300, button: 'left', clickCount: 1}, {text: 'approved'},
  ]);
  assert.equal(f.calls.length, 5);
  assert.match(f.calls[4][1].detail, /https:\/\/example.test[\s\S]+approved/);
});

test('revoking an in-flight approval prevents a workspace from opening', async () => {
  let release, started;
  const entered = new Promise(resolve => { started = resolve; });
  const f = fixture(() => new Promise(resolve => { release = resolve; started(); }));
  const pending = f.invoke('open', 'https://example.test/');
  await entered;
  f.disconnect();
  release({response: 1});
  assert.equal((await pending).connected, false);
  assert.equal(f.windows.length, 0);
});
