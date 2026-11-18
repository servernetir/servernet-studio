// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect, useState, type FormEvent} from 'react';
import {Download, Laptop, MousePointer2, X} from 'lucide-react';
import {connectorCopy} from './connector-copy';
import type {Locale} from './copy';

type Workspace = {connected: boolean; origin: string | null; width: number; height: number};
type Action = {kind: 'click'; x: number; y: number} | {kind: 'type'; text: string};
interface DesktopBridge {
  status(): Promise<Workspace>;
  openWorkspace(url: string): Promise<Workspace>;
  closeWorkspace(): Promise<Workspace>;
  perform(action: Action): Promise<{performed: boolean}>;
}

declare global {
  interface Window { servernetDesktop?: DesktopBridge }
}

const copy = {
  en: {
    download: 'Desktop downloads', url: 'Website address', open: 'Connect browser',
    close: 'Disconnect', active: 'Browser connected', click: 'Click', type: 'Type',
    action: 'Action', coordinates: 'Position in the browser viewport', text: 'Text to type',
    apply: 'Request approval', ready: 'Action sent', declined: 'Action was cancelled or could not be applied.',
    editable: 'Select a text field in the browser workspace first.',
  },
  fa: {
    download: 'دانلود برنامهٔ دسکتاپ', url: 'نشانی وب‌سایت', open: 'اتصال مرورگر',
    close: 'قطع اتصال', active: 'مرورگر متصل است', click: 'کلیک', type: 'تایپ',
    action: 'عملیات', coordinates: 'موقعیت در پنجرهٔ مرورگر', text: 'متن برای تایپ',
    apply: 'درخواست تأیید', ready: 'عملیات ارسال شد', declined: 'عملیات لغو شد یا قابل اجرا نبود.',
    editable: 'اول یک فیلد متنی در مرورگر متصل انتخاب کنید.',
  },
  tr: {
    download: 'Masaüstü indirmeleri', url: 'Web sitesi adresi', open: 'Tarayıcıyı bağla',
    close: 'Bağlantıyı kes', active: 'Tarayıcı bağlı', click: 'Tıkla', type: 'Yaz',
    action: 'İşlem', coordinates: 'Tarayıcı görünümündeki konum', text: 'Yazılacak metin',
    apply: 'Onay iste', ready: 'İşlem gönderildi', declined: 'İşlem iptal edildi veya uygulanamadı.',
    editable: 'Önce bağlı tarayıcıda bir metin alanı seçin.',
  },
};

export function DesktopConnection({locale}: {locale: Locale}) {
  const title = connectorCopy[locale];
  const t = copy[locale];
  const bridge = window.servernetDesktop;
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<Action['kind']>('click');
  const [result, setResult] = useState<'ready' | 'declined' | 'error' | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let current = true;
    const refresh = () => {
      void bridge.status().then(next => { if (current) setWorkspace(next); }, () => undefined);
    };
    refresh();
    window.addEventListener('focus', refresh);
    return () => {
      current = false;
      window.removeEventListener('focus', refresh);
    };
  }, [bridge]);

  async function run(work: (desktop: DesktopBridge) => Promise<void>) {
    if (!bridge || busy) return;
    setBusy(true);
    setResult(null);
    try { await work(bridge); }
    catch { setResult('error'); }
    finally { setBusy(false); }
  }

  function connect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const url = String(new FormData(event.currentTarget).get('url') ?? '').trim();
    void run(async desktop => {
      const next = await desktop.openWorkspace(url);
      setWorkspace(next);
      if (!next.connected) setResult('declined');
    });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = new FormData(form);
    const input: Action = action === 'click'
      ? {kind: 'click', x: Number(fields.get('x')), y: Number(fields.get('y'))}
      : {kind: 'type', text: String(fields.get('text') ?? '')};
    void run(async desktop => {
      const outcome = await desktop.perform(input);
      setResult(outcome.performed ? 'ready' : 'declined');
      if (outcome.performed && input.kind === 'type') form.reset();
      setWorkspace(await desktop.status());
    });
  }

  const download = 'https://servernet.cloud' + (locale === 'fa' ? '' : '/' + locale) + '/studio/download';
  return <article className="connection-option desktop-connection">
    <div className="connection-option-top"><span className="model-icon"><Laptop size={18} aria-hidden="true"/></span><h3>{title.desktop}</h3></div>
    <p>{title.desktopDetail}</p>
    {!bridge ? <a className="secondary-button" href={download} target="_blank" rel="noopener noreferrer"><Download size={16} aria-hidden="true"/>{t.download}</a>
      : workspace?.connected ? <>
        <div className="desktop-workspace-status">
          <div><strong>{t.active}</strong><bdi dir="ltr">{workspace.origin}</bdi></div>
          <button type="button" className="secondary-button" disabled={busy} onClick={() => void run(async desktop => {
            setWorkspace(await desktop.closeWorkspace());
          })}><X size={15} aria-hidden="true"/>{t.close}</button>
        </div>
        <form className="connection-fields desktop-fields" onSubmit={submit}>
          <label className="connection-wide">{t.action}<select value={action} onChange={event => setAction(event.target.value as Action['kind'])}>
            <option value="click">{t.click}</option><option value="type">{t.type}</option>
          </select></label>
          {action === 'click' ? <>
            <small className="connection-wide">{t.coordinates} <bdi dir="ltr">{workspace.width} × {workspace.height}</bdi></small>
            <label>X<input dir="ltr" name="x" type="number" min={0} max={workspace.width - 1} step={1} required/></label>
            <label>Y<input dir="ltr" name="y" type="number" min={0} max={workspace.height - 1} step={1} required/></label>
          </> : <label className="connection-wide">{t.text}
            <input name="text" maxLength={350} required autoComplete="off"/>
            <small>{t.editable}</small>
          </label>}
          <button className="secondary-button connection-wide" type="submit" disabled={busy || !workspace.width || !workspace.height}>{t.apply}</button>
        </form>
      </> : <form className="connection-fields desktop-fields" onSubmit={connect}>
        <label className="connection-wide">{t.url}<input name="url" type="url" dir="ltr" pattern="https://.*" placeholder="https://example.com" maxLength={2048} required/></label>
        <button className="secondary-button connection-wide" type="submit" disabled={busy}><MousePointer2 size={15} aria-hidden="true"/>{t.open}</button>
      </form>}
    {result && <small role="status">{result === 'error' ? title.error : t[result]}</small>}
  </article>;
}
