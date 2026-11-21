// SPDX-License-Identifier: AGPL-3.0-only
import assert from 'node:assert/strict';
import test from 'node:test';
import {isWebInstallPrompt, requestWebInstall, shouldOfferInstall, type WebInstallPrompt} from '../src/install-state.ts';

const ordinaryBrowser = {standalone: false, iosStandalone: false, desktopBridge: false, userAgent: 'Chrome/150.0.0.0'};

test('only browser tabs offer web installation', () => {
  assert.equal(shouldOfferInstall(ordinaryBrowser), true);
  assert.equal(shouldOfferInstall({...ordinaryBrowser, standalone: true}), false);
  assert.equal(shouldOfferInstall({...ordinaryBrowser, iosStandalone: true}), false);
  assert.equal(shouldOfferInstall({...ordinaryBrowser, desktopBridge: true}), false);
  assert.equal(shouldOfferInstall({...ordinaryBrowser, userAgent: 'Chrome/150.0.0.0 Electron/39.0.0'}), false);
  assert.equal(shouldOfferInstall({...ordinaryBrowser, userAgent: 'Safari/605.1.15'}), true);
});

test('requires a browser event with both native prompt and user choice', async () => {
  assert.equal(isWebInstallPrompt(new Event('beforeinstallprompt')), false);
  assert.equal(isWebInstallPrompt(Object.assign(new Event('beforeinstallprompt'), {prompt: async () => {}})), false);
  let invocations = 0;
  const event = Object.assign(new Event('beforeinstallprompt'), {
    prompt: async () => { invocations += 1; },
    userChoice: Promise.resolve({outcome: 'accepted' as const}),
  });
  assert.equal(isWebInstallPrompt(event), true);
  assert.equal(invocations, 0); // No prompt just for inspecting/capturing the event.
  assert.equal(await requestWebInstall(event), 'accepted');
  assert.equal(invocations, 1);
});

test('native prompt cancellation/failure is handled without retrying it', async () => {
  let invocations = 0;
  const dismissed = Object.assign(new Event('beforeinstallprompt'), {
    prompt: async () => { invocations++; }, userChoice: Promise.resolve({outcome: 'dismissed' as const}),
  });
  const unavailable: WebInstallPrompt = Object.assign(new Event('beforeinstallprompt'), {
    prompt: async () => { invocations++; throw new Error('No native prompt'); },
    userChoice: Promise.resolve({outcome: 'dismissed' as const}),
  });
  assert.equal(await requestWebInstall(dismissed), 'dismissed');
  assert.equal(await requestWebInstall(unavailable), 'unavailable');
  assert.equal(invocations, 2);
});
