// SPDX-License-Identifier: AGPL-3.0-only
import {useState, type ReactNode} from 'react';
import {
  ArrowUpRight, AudioLines, Boxes, Clapperboard, Download, Images, KeyRound, LibraryBig,
  LogOut, MessageSquare, Plug, Plus, RefreshCw, Search, Wallet, X,
} from 'lucide-react';
import {copy, workspaceCopy, type Locale} from './copy';
import {priceText, pricingUnit, supportsStudio, type Model} from './catalog';
import {inferenceCopy} from './inference-copy';

export type Chat = {id: string; title: string};
export type Account = {
  customer: {name: string};
  wallet: {currency: string; unit: string; available: number; reserved: number};
  ai: {spent_month: number; prompt_tokens_month: number; completion_tokens_month: number};
  display?: {eur_rate_irt: number | null; native: boolean};
};
export type View = 'chat' | 'models' | 'library' | 'image' | 'video' | 'audio' | 'tools';

const viewIcons = {
  chat: MessageSquare, models: Boxes, library: LibraryBig, image: Images, video: Clapperboard, audio: AudioLines, tools: Plug,
};

export function viewFromHash(): View {
  const hash = location.hash.slice(1);
  return Object.hasOwn(viewIcons, hash) ? hash as View : 'chat';
}

export function localizedUrl(origin: string, locale: Locale, path: string) {
  return `${origin}/${locale === 'fa' ? '' : `${locale}/`}${path}`;
}

function chatTitle(chat: Chat, locale: Locale) {
  return chat.title === 'New conversation' ? copy[locale].new : chat.title;
}

type SidebarProps = {
  brand: ReactNode;
  locale: Locale;
  view: View;
  open: boolean;
  collapsed: boolean;
  chats: Chat[];
  active: string;
  account: Account | null;
  busy: boolean;
  close: () => void;
  navigate: (view: View) => void;
  fresh: () => void;
  openChat: (chat: Chat) => void;
  refreshBalance: () => void;
  logout: () => void;
};

export function WorkspaceSidebar(props: SidebarProps) {
  const {locale, view, chats, active, account, busy} = props;
  const t = copy[locale], w = workspaceCopy[locale];
  const f = inferenceCopy[locale];
  const rate = account?.display?.eur_rate_irt ?? null;
  const consoleUrl = (path: string) => localizedUrl('https://console.servernet.cloud', locale, path);

  function navLink(target: View, title: string) {
    const Icon = viewIcons[target];
    return <button type="button" className="nav-link" onClick={() => props.navigate(target)} aria-current={view === target ? 'page' : undefined}>
      <Icon size={17} aria-hidden="true"/><span>{title}</span>
    </button>;
  }

  return <aside id="studio-sidebar" className={`sidebar${props.open ? ' is-open' : ''}${props.collapsed ? ' is-collapsed' : ''}`}>
    <div className="sidebar-brand">
      {props.brand}
      <button type="button" className="sidebar-close icon-button" onClick={props.close} aria-label={t.close}><X size={18}/></button>
    </div>
    <button type="button" className="new-chat" onClick={props.fresh} disabled={busy}><Plus size={18}/>{t.new}</button>
    <div className="sidebar-scroll">
      <nav className="workspace-nav" aria-label={w.navigation}>
        <div className="nav-group">
          {navLink('chat', w.chat)}
          {navLink('models', w.catalog)}
          {navLink('library', w.history)}
        </div>
        <div className="nav-group">
          <h2 className="nav-label">{w.media}</h2>
          {navLink('image', w.image)}
          {navLink('video', w.video)}
          {navLink('audio', w.audio)}
        </div>
        <a className="nav-link api-link" href={consoleUrl('account/ai')} target="_blank" rel="noopener noreferrer">
          <KeyRound size={17} aria-hidden="true"/><span>{w.api}</span><ArrowUpRight size={13} aria-hidden="true"/>
        </a>
        {navLink('tools', f.tools)}
      </nav>
      {chats.length > 0 && <section className="recent-chats" aria-label={w.recent}>
        <h2 className="nav-label">{w.recent}</h2>
        {chats.slice(0, 5).map(chat => <button type="button" key={chat.id} className="recent-chat" onClick={() => props.openChat(chat)}
          aria-current={view === 'chat' && chat.id === active ? 'true' : undefined} disabled={busy}>
          <MessageSquare size={14} aria-hidden="true"/><span dir="auto">{chatTitle(chat, locale)}</span>
        </button>)}
      </section>}
    </div>
    <div className="sidebar-footer">
      <div className="wallet-card">
        <div className="wallet-label">
          <Wallet size={15} aria-hidden="true"/>{t.wallet}
          <button type="button" className="icon-button" onClick={props.refreshBalance} aria-label={t.retryAccount}><RefreshCw size={13}/></button>
        </div>
        <div className="wallet-total">
          <strong aria-label={t.available}>{account ? priceText(account.wallet.available, locale, rate, true) ?? '—' : '—'}</strong>
          <a href={consoleUrl('account/topup')} target="_blank" rel="noopener noreferrer" aria-label={t.topup} title={t.topup}><Plus size={17}/></a>
        </div>
        {Boolean(account?.wallet.reserved) && <small>{t.held} · {priceText(account!.wallet.reserved, locale, rate) ?? '—'}</small>}
      </div>
      <div className="profile">
        <div className="avatar" aria-hidden="true">{account?.customer.name.charAt(0)}</div>
        <span dir="auto">{account?.customer.name}</span>
        <button type="button" className="icon-button" onClick={props.logout} disabled={busy} aria-label={t.logout} title={t.logout}><LogOut size={17}/></button>
      </div>
      <a className="legal-link" href="/legal">{t.legal}</a>
    </div>
  </aside>;
}

function SearchField({label, value, onChange}: {label: string; value: string; onChange: (value: string) => void}) {
  return <label className="search-field">
    <Search size={17} aria-hidden="true"/>
    <input type="search" aria-label={label} placeholder={label} value={value} onChange={event => onChange(event.target.value)} />
  </label>;
}

export function ModelCatalog({locale, models, view, busy, choose, rate}: {
  locale: Locale;
  models: Model[];
  view: 'models' | 'image' | 'video' | 'audio';
  busy: boolean;
  choose: (id: string) => void;
  rate: number | null;
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const w = workspaceCopy[locale];
  const f = inferenceCopy[locale];
  const siteUrl = (path: string) => localizedUrl('https://servernet.cloud', locale, path);
  const catalog = models.filter(model => view === 'models' || model.category === view || (view === 'audio' && model.category === 'music'));
  const matched = catalog.filter(model => `${model.label} ${model.id}`.toLowerCase().includes(query));
  return <section className="tool-view catalog-view" aria-labelledby="catalog-title">
    <header className="tool-heading">
      <div>
        <h1 id="catalog-title">{view === 'models' ? w.catalog : w[view]}</h1>
        <p>{f.modelsIntro}</p>
      </div>
      <a className="secondary-button" href={siteUrl(view === 'models' ? 'ai/models' : `ai/models?type=${view}`)} target="_blank" rel="noopener noreferrer">
        {w.browseCatalog}<ArrowUpRight size={16}/>
      </a>
    </header>
    <SearchField label={w.searchModels} value={search} onChange={setSearch}/>
    {matched.length === 0 ? <p className="empty-state" role="status">{catalog.length === 0 ? w.noCategoryModels : w.noResults}</p> :
      <div className="catalog-list">
        {matched.map(model => {
          const category = model.category === 'classification' ? f.classify : w[model.category];
          const Icon = viewIcons[model.category === 'music' ? 'audio' : model.category === 'classification' ? 'models' : model.category];
          const pricing=model.pricing;
          return <article className="catalog-row" key={model.id}>
            <div className="catalog-model">
              <span className="model-icon"><Icon size={18} aria-hidden="true"/></span>
              <div>
                <h2 dir="auto">{model.label}</h2>
                <small>{category}{model.vision ? ' · ' + f.vision : ''}</small>
              </div>
            </div>
            <div className="catalog-price">
              {model.free ? <strong className="free-price">{f.free}</strong> :
                pricing?.unit==='tokens' && typeof pricing.input_irt==='number' && typeof pricing.output_irt==='number' ? <>
                  <span>{f.input} {priceText(pricing.input_irt, locale, rate) ?? '—'} · {f.output} {priceText(pricing.output_irt, locale, rate) ?? '—'}</span>
                  <small>{f.perMillion}</small>
                </> : typeof pricing?.amount_irt==='number' ? <>
                  <span>{priceText(pricing.amount_irt, locale, rate) ?? f.unavailable}</span>
                  <small>{f.referencePrice} · {pricingUnit(pricing.unit, pricing.quantity, locale)}</small>
                </> : <small>—</small>}
            </div>
            <div className="catalog-actions">
              {supportsStudio(model) && <button type="button" className="secondary-button catalog-primary"
                onClick={() => choose(model.id)} disabled={busy}>{model.category==='chat'?f.chat:f.generate}</button>}
              <details className="catalog-api">
                <summary className="secondary-button">{f.api}</summary>
                <div className="api-data"><small>{w.modelId}</small><code dir="ltr">{model.id}</code>
                  <code dir="ltr">POST {model.endpoint || '/v1/chat/completions'}</code>
                  <a href={siteUrl('ai/docs')} target="_blank" rel="noopener noreferrer">{w.apiDocs}<ArrowUpRight size={14}/></a>
                </div>
              </details>
            </div>
          </article>;
        })}
      </div>}
  </section>;
}

export function StudioTools({locale}:{locale:Locale}) {
  const f = inferenceCopy[locale];
  const [checking,setChecking]=useState(false);
  const [status,setStatus]=useState<'ready'|'error'|null>(null);
  async function check() {
    setChecking(true);
    setStatus(null);
    try {
      const response=await fetch('/api/tools/mcp');
      if (!response.ok || !(await response.json()).tools.some((tool:{name:string})=>tool.name==='list_models')) throw Error('MCP unavailable');
      setStatus('ready');
    } catch {setStatus('error');}
    finally {setChecking(false);}
  }
  return <section className="tool-view tools-view">
    <header className="tool-heading"><h1>{f.toolsHeading}</h1></header>
    <section>
      <h2>{f.browserHeading}</h2><p>{f.browserText}</p>
      <a className="secondary-button" href="https://studio.servernet.cloud/studio-chrome-extension.zip"
        target="_blank" rel="noopener noreferrer"><Download size={16}/>{f.extension}</a>
      <p className="install-hint">{f.install}</p>
    </section>
    <section>
      <h2>{f.mcpHeading}</h2><p>{f.mcpText}</p>
      <input className="mcp-url" dir="ltr" readOnly aria-label={f.mcpHeading} value="https://servernet.cloud/v1/studio/mcp"
        onFocus={event=>event.target.select()}/>
      <a className="secondary-button" href={localizedUrl('https://console.servernet.cloud', locale, 'account/ai')}
        target="_blank" rel="noopener noreferrer">{f.mcpKey}<ArrowUpRight size={16}/></a>
      {' '}<button type="button" className="secondary-button" onClick={()=>{void check();}} disabled={checking}>{f.testMcp}</button>
      {status&&<p role="status">{status==='ready'?f.mcpReady:f.mcpError}</p>}
    </section>
  </section>;
}

export function ConversationLibrary({chats, locale, busy, open}: {
  chats: Chat[]; locale: Locale; busy: boolean; open: (chat: Chat) => void;
}) {
  const [search, setSearch] = useState('');
  const t = copy[locale], w = workspaceCopy[locale];
  const query = search.trim().toLocaleLowerCase(locale);
  const matched = chats.filter(chat => chatTitle(chat, locale).toLocaleLowerCase(locale).includes(query));
  return <section className="tool-view" aria-labelledby="library-title">
    <header className="tool-heading">
      <div><h1 id="library-title">{w.history}</h1><p>{w.historyDescription}</p></div>
    </header>
    <SearchField label={w.searchChats} value={search} onChange={setSearch}/>
    {matched.length === 0 ? <p className="empty-state" role="status">{chats.length === 0 ? t.empty : w.noResults}</p> :
      <ul className="library-list">
        {matched.map(chat => <li key={chat.id} className="library-row">
          <button type="button" className="library-chat" onClick={() => open(chat)} disabled={busy} title={w.openChat}>
            <span className="model-icon"><MessageSquare size={17}/></span><span dir="auto">{chatTitle(chat, locale)}</span>
          </button>
          <a className="secondary-button" href={`/api/conversations/${chat.id}/export`} download>
            <Download size={16} aria-hidden="true"/>{w.saveChat}
          </a>
        </li>)}
      </ul>}
  </section>;
}
