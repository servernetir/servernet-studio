// SPDX-License-Identifier: AGPL-3.0-only
import {useEffect, useRef, useState, type FormEvent} from 'react';
import {Globe, Laptop, Mail, Plus, Server, Unplug} from 'lucide-react';
import type {Locale} from './copy';
import {connectorCopy} from './connector-copy';
import './connectors.css';

const kinds = ['ssh', 'https_token', 'gmail', 'desktop'] as const;
const icons = {ssh: Server, https_token: Globe, gmail: Mail, desktop: Laptop};
type Kind = typeof kinds[number];
type ManualKind = 'ssh' | 'https_token';
type Connector = {
  id: string;
  kind: Kind;
  name: string;
  target: string;
  port: number | null;
  username: string | null;
  status: 'saved' | 'connected' | 'unreachable';
  last_checked_at: string | number | null;
};
type ConnectorList = {data: Connector[]; available: Kind[]};
type Operation = 'check' | 'remove' | 'save' | 'gmail';

class ConnectionError extends Error {
  constructor(readonly status: number) { super('Connection request failed'); }
}

async function request<T>(path: string, {method = 'GET', csrf = '', body, signal}: {
  method?: 'GET' | 'POST' | 'DELETE'; csrf?: string; body?: object; signal?: AbortSignal;
} = {}): Promise<T> {
  const response = await fetch('/api/connectors' + path, {
    method, signal,
    headers: {...(method !== 'GET' && {'X-CSRF-Token': csrf}), ...(body && {'Content-Type': 'application/json'})},
    body: body && JSON.stringify(body),
  });
  if (!response.ok) throw new ConnectionError(response.status);
  return response.json();
}

function errorKey(error: unknown) {
  const status = error instanceof ConnectionError ? error.status : null;
  switch (status) {
    case 401: case 403: return 'denied';
    case 409: return 'duplicate';
    case 422: return 'invalid';
    case 429: return 'rateLimited';
    default: return 'error';
  }
}

function CheckTime({value, locale}: {value: string | number; locale: Locale}) {
  const date = new Date(typeof value === 'number' ? value * 1000 : value);
  if (Number.isNaN(date.getTime())) return null;
  return <time dateTime={date.toISOString()}>{new Intl.DateTimeFormat(locale, {dateStyle: 'medium', timeStyle: 'short'}).format(date)}</time>;
}

export function ConnectedServices({locale, csrf, useInChat}: {locale: Locale; csrf: string; useInChat?: (text: string) => void}) {
  const t = connectorCopy[locale];
  const [connections, setConnections] = useState<ConnectorList | null>(null);
  const [error, setError] = useState<ReturnType<typeof errorKey> | null>(null);
  const [notice, setNotice] = useState<'added' | 'removed' | 'gmailSuccess' | 'gmailError' | 'gmailDenied' | 'gmailRemoveGrant' | null>(null);
  const [load, setLoad] = useState(0);
  const [form, setForm] = useState<ManualKind | null>(null);
  const [pending, setPending] = useState<{id: string; action: Operation} | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [unread, setUnread] = useState<Record<string, number>>({});
  const inFlight = useRef(false);
  const inDesktop = /\bElectron\//.test(navigator.userAgent);

  useEffect(() => {
    const controller = new AbortController();
    request<ConnectorList>('', {signal: controller.signal}).then(setConnections, problem => {
      if (!controller.signal.aborted) setError(errorKey(problem));
    });
    return () => controller.abort();
  }, [load]);

  useEffect(() => {
    const current = new URL(location.href);
    const result = current.searchParams.get('gmail');
    if (result === 'connected' || result === 'denied' || result === 'error') {
      setNotice(result === 'connected' ? 'gmailSuccess' : result === 'denied' ? 'gmailDenied' : 'gmailError');
      current.searchParams.delete('gmail');
      history.replaceState(history.state, '', current);
    }
  }, []);

  function setOrReplace(connection: Connector) {
    setConnections(current => current && {
      ...current,
      data: current.data.some(record => record.id === connection.id)
        ? current.data.map(record => record.id === connection.id ? connection : record)
        : [connection, ...current.data],
    });
  }

  async function run(id: string, action: Operation, work: () => Promise<void>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending({id, action});
    setError(null);
    setNotice(null);
    try { await work(); }
    catch (problem) { setError(errorKey(problem)); }
    finally {
      inFlight.current = false;
      setPending(null);
    }
  }

  function save(event: FormEvent<HTMLFormElement>, kind: ManualKind) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const text = (name: string) => String(fields.get(name) ?? '');
    const body = {
      kind, name: text('name').trim(), target: text('target').trim(), secret: text('secret').trim(),
      ...(kind === 'ssh' && {
        port: Number(text('port')), username: text('username').trim(), host_key_sha256: text('fingerprint').trim(),
      }),
    };
    void run('', 'save', async () => {
      setOrReplace(await request<Connector>('', {method: 'POST', csrf, body}));
      setNotice('added');
      setForm(null);
    });
  }

  function check(entry: Connector) {
    setConfirm(null);
    void run(entry.id, 'check', async () => {
      const path = '/' + encodeURIComponent(entry.id);
      if (entry.kind === 'gmail') {
        setUnread(current => {
          const next = {...current};
          delete next[entry.id];
          return next;
        });
        try {
          const result = await request<{unread: number; connection: Connector}>(path + '/gmail/inbox', {method: 'POST', csrf});
          setUnread(current => ({...current, [entry.id]: result.unread}));
          setOrReplace(result.connection);
        } catch (problem) {
          if (problem instanceof ConnectionError && problem.status === 502) setLoad(count => count + 1);
          throw problem;
        }
      } else {
        setOrReplace(await request<Connector>(path + '/check', {method: 'POST', csrf}));
      }
    });
  }

  function remove(entry: Connector) {
    void run(entry.id, 'remove', async () => {
      const result = await request<{provider_revoked?: boolean}>('/' + encodeURIComponent(entry.id), {method: 'DELETE', csrf});
      setConnections(current => current && {...current, data: current.data.filter(record => record.id !== entry.id)});
      setConfirm(null);
      setNotice(result.provider_revoked === false ? 'gmailRemoveGrant' : 'removed');
    });
  }

  function startGmail() {
    void run('', 'gmail', async () => {
      const {authorization_url} = await request<{authorization_url: string}>('/gmail/start', {method: 'POST', csrf});
      const redirect = new URL(authorization_url);
      if (redirect.origin !== 'https://accounts.google.com') throw new Error('Invalid authorization origin');
      location.assign(redirect);
    });
  }

  function shareResult(entry: Connector) {
    const count = unread[entry.id];
    const result = entry.kind === 'gmail' && count !== undefined
      ? t.unread + ' · ' + new Intl.NumberFormat(locale).format(count)
      : t[entry.status];
    useInChat?.(t.resultLabel + '\n' + (entry.kind === 'gmail' ? t.gmail : entry.name) + ' · ' + result);
  }

  const descriptions = {ssh: t.sshDetail, https_token: t.httpsDetail, gmail: t.gmailDetail, desktop: t.desktopDetail};
  return <section className="tool-view connections-view" aria-labelledby="connections-heading">
    <header className="tool-heading">
      <div><h1 id="connections-heading">{t.heading}</h1><p>{t.intro}</p></div>
    </header>
    {notice && <p className="connections-status" role={notice === 'gmailError' ? 'alert' : 'status'}>{t[notice]}
      {(notice === 'gmailRemoveGrant' || notice === 'gmailError') && <> <a href="https://myaccount.google.com/connections" target="_blank" rel="noopener noreferrer">{t.googleGrants}</a></>}
    </p>}
    {error && <p className="notice" role="alert">{t[error]}</p>}
    {!connections ? error
      ? <button type="button" className="secondary-button" onClick={() => {setError(null); setLoad(count => count + 1);}}>{t.retry}</button>
      : <p className="connections-status" role="status">{t.loading}</p>
      : <>
        <section className="connections-section" aria-labelledby="connections-saved">
          <h2 id="connections-saved">{t.savedHeading}</h2>
          {connections.data.length ? <ul className="connection-list">
            {connections.data.map(entry => {
              const Icon = icons[entry.kind];
              return <li className="connection-row" key={entry.id}>
                <div className="connection-identity">
                  <span className="model-icon"><Icon size={18} aria-hidden="true"/></span>
                  <div>
                    <div className="connection-title"><strong dir="auto">{entry.name}</strong><span role="status" data-status={entry.status}>{t[entry.status]}</span></div>
                    {entry.kind !== 'gmail' && <bdi className="connection-target" dir="ltr">
                      {entry.username ? entry.username + '@' : ''}{entry.target}{entry.port ? ':' + entry.port : ''}
                    </bdi>}
                    {entry.last_checked_at && <small>{t.lastChecked} · <CheckTime value={entry.last_checked_at} locale={locale}/></small>}
                    {unread[entry.id] !== undefined && <small role="status">{t.unread} · {new Intl.NumberFormat(locale).format(unread[entry.id])}</small>}
                  </div>
                </div>
                {confirm === entry.id ? <div className="connection-actions" role="group" aria-label={t.confirm}>
                  <span>{t.confirm}</span>
                  <button type="button" className="secondary-button" onClick={() => setConfirm(null)} disabled={!!pending}>{t.cancel}</button>
                  <button type="button" className="secondary-button connection-remove" onClick={() => remove(entry)} disabled={!!pending}>
                    {pending?.id === entry.id ? t.removing : t.revoke}
                  </button>
                </div> : <div className="connection-actions">
                  {useInChat && (entry.kind === 'gmail' ? unread[entry.id] !== undefined : entry.last_checked_at !== null) &&
                    <button type="button" className="secondary-button" onClick={() => shareResult(entry)} disabled={!!pending}>{t.useInChat}</button>}
                  <button type="button" className="secondary-button" onClick={() => check(entry)} disabled={!!pending}>
                    {pending?.id === entry.id ? t.checking : entry.kind === 'gmail' ? t.checkInbox : t.check}
                  </button>
                  <button type="button" className="icon-button" onClick={() => setConfirm(entry.id)} disabled={!!pending}
                    aria-label={t.revoke + ' ' + entry.name} title={t.revoke}><Unplug size={17} aria-hidden="true"/></button>
                </div>}
              </li>;
            })}
          </ul> : <p className="connections-empty">{t.empty}</p>}
        </section>
        <section className="connections-section" aria-labelledby="connections-add">
          <h2 id="connections-add">{t.addHeading}</h2>
          <div className="connection-options">
            {kinds.map(kind => {
              const Icon = icons[kind];
              const available = connections.available.includes(kind);
              return <article className="connection-option" key={kind}>
                <div className="connection-option-top"><span className="model-icon"><Icon size={18} aria-hidden="true"/></span>
                  <h3>{t[kind]}</h3></div>
                <p>{descriptions[kind]}</p>
                {!available ? <span className="connection-unavailable">{t.unavailable}</span>
                  : kind === 'gmail' ? inDesktop
                    ? <a className="secondary-button" href="https://studio.servernet.cloud/#connectors" target="_blank" rel="noopener noreferrer">{t.openBrowser}</a>
                    : <button type="button" className="secondary-button" disabled={!!pending} onClick={startGmail}>{t.connect}</button>
                  : (kind === 'ssh' || kind === 'https_token') && <button type="button" className="secondary-button" disabled={!!pending}
                    aria-expanded={form === kind} aria-controls="connection-form" onClick={() => setForm(form === kind ? null : kind)}>
                    <Plus size={15} aria-hidden="true"/>{t.addHeading}
                  </button>}
              </article>;
            })}
          </div>
          {form && <form key={form} id="connection-form" className="connection-form" onSubmit={event => save(event, form)} autoComplete="off">
            <h3>{t[form]}</h3>
            <div className="connection-fields">
              <label>{t.name}<input name="name" required maxLength={80} dir="auto" autoFocus/></label>
              <label>{form === 'ssh' ? t.host : t.endpoint}
                <input name="target" type={form === 'https_token' ? 'url' : 'text'} dir="ltr" required maxLength={260}
                  placeholder={form === 'ssh' ? 'server.example.com' : 'https://api.example.com'} spellCheck={false}/>
              </label>
              {form === 'ssh' && <>
                <label>{t.username}<input name="username" dir="ltr" maxLength={64} required spellCheck={false}/></label>
                <label>{t.port}<input name="port" type="text" dir="ltr" value="22" readOnly/></label>
                <label className="connection-wide">{t.fingerprint}
                  <input name="fingerprint" dir="ltr" placeholder="SHA256:…" maxLength={56} required spellCheck={false}/>
                  <small>{t.fingerprintHint}</small>
                </label>
              </>}
              <label className="connection-wide">{form === 'ssh' ? t.privateKey : t.token}
                {form === 'ssh' ? <textarea name="secret" dir="ltr" rows={4} minLength={8} maxLength={16000} required spellCheck={false}/>
                  : <input name="secret" type="password" dir="ltr" minLength={8} maxLength={4096} required autoComplete="new-password"/>}
                <small>{form === 'ssh' && t.keyHint + ' '}{t.secretHint}</small>
              </label>
            </div>
            <div className="connection-actions">
              <button type="submit" className="secondary-button catalog-primary" disabled={!!pending}>{pending?.action === 'save' ? t.saving : t.save}</button>
              <button type="button" className="secondary-button" onClick={() => setForm(null)} disabled={!!pending}>{t.cancel}</button>
            </div>
          </form>}
        </section>
      </>}
  </section>;
}
