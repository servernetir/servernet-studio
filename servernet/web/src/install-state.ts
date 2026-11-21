// SPDX-License-Identifier: AGPL-3.0-only

export type WebInstallPrompt = Event & {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{outcome: 'accepted' | 'dismissed'}>;
};

export function isWebInstallPrompt(event: Event): event is WebInstallPrompt {
  const candidate = event as Partial<WebInstallPrompt>;
  return typeof candidate.prompt === 'function' && typeof candidate.userChoice?.then === 'function';
}

export function shouldOfferInstall(context: {
  standalone: boolean; iosStandalone: boolean; desktopBridge: boolean; userAgent: string;
}): boolean {
  return !context.standalone && !context.iosStandalone && !context.desktopBridge && !/\bElectron\//i.test(context.userAgent);
}

/** Called only from an explicit user gesture. Browsers allow a prompt event once. */
export async function requestWebInstall(event: WebInstallPrompt): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  try {
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch {
    return 'unavailable';
  }
}
