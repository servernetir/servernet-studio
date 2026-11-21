// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect, useId, useLayoutEffect, useRef, useState} from 'react';
import {Download, X} from 'lucide-react';
import type {Locale} from './copy';
import {installCopy} from './install-copy';
import {isWebInstallPrompt, requestWebInstall, shouldOfferInstall, type WebInstallPrompt} from './install-state';
import './install.css';

function eligible() {
  return shouldOfferInstall({
    standalone: window.matchMedia('(display-mode: standalone)').matches,
    iosStandalone: (navigator as Navigator & {standalone?: boolean}).standalone === true,
    desktopBridge: Boolean(window.servernetDesktop),
    userAgent: navigator.userAgent,
  });
}

// Keep the browser's one-shot event at App level so switching between signed-in
// and signed-out views never loses it. There is deliberately no service worker.
export function useWebInstall() {
  const [visible, setVisible] = useState(eligible);
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  const prompt = useRef<WebInstallPrompt | null>(null);

  useEffect(() => {
    const display = window.matchMedia('(display-mode: standalone)');
    function update() {
      const canOffer = eligible();
      setVisible(canOffer);
      if (!canOffer) { setManual(false); prompt.current = null; }
    }
    function capture(event: Event) {
      if (!eligible() || !isWebInstallPrompt(event)) return;
      event.preventDefault();
      prompt.current = event;
    }
    function installed() {
      prompt.current = null;
      setVisible(false);
      setManual(false);
    }
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
    display.addEventListener?.('change', update);
    return () => {
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', installed);
      display.removeEventListener?.('change', update);
    };
  }, []);

  async function install() {
    if (busy || !visible) return;
    const event = prompt.current;
    if (!event) { setManual(true); return; }
    prompt.current = null;
    setBusy(true);
    try {
      if (await requestWebInstall(event) === 'unavailable' && eligible()) setManual(true);
    } finally { setBusy(false); }
  }

  return {visible, manual, busy, install, close: () => setManual(false)};
}

type InstallState = ReturnType<typeof useWebInstall>;

export function InstallButton({locale, state, sidebar = false}: {locale: Locale; state: InstallState; sidebar?: boolean}) {
  if (!state.visible) return null;
  return <button type="button" className={sidebar ? 'nav-link' : 'web-install-button'} onClick={() => {void state.install();}} disabled={state.busy}>
    <Download size={17} aria-hidden="true"/><span>{installCopy[locale].button}</span>
  </button>;
}

export function InstallDialog({locale, state}: {locale: Locale; state: InstallState}) {
  const t = installCopy[locale];
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  useLayoutEffect(() => {
    const element = dialog.current;
    if (!element || !state.manual) return;
    element.showModal();
    return () => { if (element.open) element.close(); };
  }, [state.manual]);
  if (!state.visible || !state.manual) return null;
  return <dialog className="web-install-dialog" ref={dialog} aria-labelledby={title} onCancel={event => {event.preventDefault(); state.close();}}>
    <header><img src="/servernet.svg" alt=""/><h2 id={title}>{t.title}</h2>
      <button type="button" className="web-install-close" onClick={state.close} aria-label={t.close}><X size={20}/></button>
    </header>
    <p>{t.description}</p>
    <ul className="web-install-guide">
      <li><strong dir="ltr">Chrome (Windows, macOS, Android)</strong><span>{t.chrome}</span></li>
      <li><strong dir="ltr">Microsoft Edge</strong><span>{t.edge}</span></li>
      <li><strong dir="ltr">Safari (macOS)</strong><span>{t.mac}</span></li>
      <li><strong dir="ltr">Safari (iPhone / iPad)</strong><span>{t.ios}</span></li>
    </ul>
    <p className="web-install-note">{t.fallback}</p>
    <p className="web-install-note">{t.limits}</p>
    <div className="web-install-actions"><button type="button" onClick={state.close}>{t.done}</button></div>
  </dialog>;
}
