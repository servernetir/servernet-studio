// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 ServerNet contributors
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowUp, ArrowUpRight, ChartNoAxesColumnIncreasing, Code2, FolderOpen, Lightbulb, Menu, MessageSquare, Moon, PanelLeftClose, PanelLeftOpen, ShieldCheck, Sparkles, Sun, Wallet} from 'lucide-react';
import {copy, workspaceCopy, type Locale} from './copy';
import {priceText, readModels, supportsStudio, type Model} from './catalog';
import {ConversationLibrary, ModelCatalog, WorkspaceSidebar, localizedUrl, viewFromHash, type Account, type Chat, type View} from './workspace';
import {ImageAttachment, ImageAttachmentPreview, MediaComposer, MediaResult, Thinking, normalizeImage, type MediaJob, type Parameters} from './inference';
import {inferenceCopy} from './inference-copy';
import {connectorCopy} from './connector-copy';
import {ConnectedServices} from './connectors';
import {projectCopy} from './project-copy';
import {ChatContext, HistoryDialog, ProjectDialog, ProjectFolder, ProjectsHome, UsageDialog,
  projectIdFromHash, type Project, type ProjectChatState, type ProjectsState, type ProjectSettings} from './projects';
import './style.css';
import './workspace.css';
import './inference.css';

type Message = {role: string; content: string; media?: MediaJob; image?: string};
type Theme = 'light' | 'dark';
type WorkspaceDialog = {kind: 'project'; project: Project | null} | {kind: 'history' | 'usage'};
const LANGUAGE_KEY = 'servernet.studio.language';
const THEME_KEY = 'servernet.studio.theme';
const PERSONAL_CONVERSATIONS = '/api/conversations?unfiled=true';

function readPreference(key: string) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function savePreference(key: string, value: string) {
  try { localStorage.setItem(key, value); } catch { /* The choice still applies until this page closes. */ }
}

class ApiError extends Error {
  constructor(public status: number) { super('ServerNet request failed'); }
}

export function App() {
  const [locale, setLocale] = useState<Locale>(() => {
    const saved = readPreference(LANGUAGE_KEY);
    return saved === 'fa' || saved === 'tr' ? saved : 'en';
  });
  const [theme, setTheme] = useState<Theme>(() => readPreference(THEME_KEY) === 'light' ? 'light' : 'dark');
  const [view, setView] = useState(viewFromHash);
  const [projectPageId, setProjectPageId] = useState(projectIdFromHash);
  const [chatProjectId, setChatProjectId] = useState<string | null>(null);
  const [projects, setProjects] = useState<ProjectsState>({status: 'loading'});
  const [projectRefresh, setProjectRefresh] = useState(0);
  const [projectChats, setProjectChats] = useState<{id: string; chats: ProjectChatState} | null>(null);
  const [projectChatsRefresh, setProjectChatsRefresh] = useState(0);
  const [historyTurns, setHistoryTurns] = useState<number | null>(null);
  const [dialog, setDialog] = useState<WorkspaceDialog | null>(null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobile, setMobile] = useState(false);
  const [ready, setReady] = useState(false);
  const [signed, setSigned] = useState(false);
  const [csrf, setCsrf] = useState('');
  const [account, setAccount] = useState<Account | null>(null);
  const [models, setModels] = useState<Model[]>([]);
  const [model, setModel] = useState('');
  const [chats, setChats] = useState<Chat[]>([]);
  const [active, setActive] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [text, setText] = useState('');
  const [image, setImage] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const requestVersion = useRef(0);
  const conversationBody = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);
  const input = useRef<HTMLTextAreaElement>(null);
  const mobileToggle = useRef<HTMLButtonElement>(null);
  const mediaChecks = useRef(new Set<string>());

  const t = copy[locale];
  const w = workspaceCopy[locale];
  const f = inferenceCopy[locale];
  const p = projectCopy[locale];
  const projectList = projects.status === 'ready' ? projects.value : [];
  const chatProject = projectList.find(project => project.id === chatProjectId) ?? null;
  const pageProject = projectList.find(project => project.id === projectPageId) ?? null;
  const sidebarProjectId = view === 'chat' ? chatProjectId : view === 'projects' ? pageProject?.id ?? null : null;
  const selectableModels = models.filter(supportsStudio);
  const currentModel = models.find(entry => entry.id === model);
  const visionModel = models.find(entry=>entry.vision);
  const rate = account?.display?.eur_rate_irt ?? null;
  const amount = (value: number) => priceText(value, locale, rate);
  const number = (value: number) => new Intl.NumberFormat(locale).format(value);
  const consoleUrl = (path: string) => localizedUrl('https://console.servernet.cloud', locale, path);
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const ThemeIcon = nextTheme === 'light' ? Sun : Moon;
  const themeLabel = nextTheme === 'light' ? t.lightMode : t.darkMode;

  useLayoutEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = locale === 'fa' ? 'rtl' : 'ltr';
    document.documentElement.dataset.signInTheme = theme;
  }, [locale, theme]);

  useEffect(() => {
    const update = () => {
      setView(viewFromHash());
      setProjectPageId(projectIdFromHash());
      setMobile(false);
    };
    window.addEventListener('hashchange', update);
    return () => window.removeEventListener('hashchange', update);
  }, []);

  useEffect(() => {
    if (!mobile) return;
    document.querySelector<HTMLButtonElement>('#studio-sidebar .sidebar-close')?.focus();
    const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setMobile(false); };
    window.addEventListener('keydown', cancel);
    return () => {
      window.removeEventListener('keydown', cancel);
      if (mobileToggle.current?.getClientRects().length) mobileToggle.current.focus();
    };
  }, [mobile]);

  useEffect(() => {
    const panel=conversationBody.current;
    if (panel && stickToBottom.current) panel.scrollTop=panel.scrollHeight;
  }, [messages, view]);

  useEffect(() => {
    if (!signed) return;
    const controller = new AbortController();
    async function getSettings(path: string) {
      const response = await fetch(path, {signal: controller.signal});
      if (!response.ok) throw new ApiError(response.status);
      return response.json();
    }
    async function load() {
      const [projectResult, preferences] = await Promise.allSettled([
        getSettings('/api/projects'), getSettings('/api/preferences'),
      ]);
      if (controller.signal.aborted) return;
      setProjects(projectResult.status === 'fulfilled' && Array.isArray(projectResult.value)
        ? {status: 'ready', value: projectResult.value} : {status: 'error'});
      if (preferences.status === 'fulfilled' && Number.isInteger(preferences.value.history_turns)) {
        setHistoryTurns(preferences.value.history_turns);
      }
    }
    void load();
    return () => controller.abort();
  }, [signed, projectRefresh]);

  useEffect(() => {
    if (!signed || !sidebarProjectId) return;
    const id = sidebarProjectId;
    const controller = new AbortController();
    async function load() {
      try {
        const response = await fetch('/api/conversations?' + new URLSearchParams({project_id: id}), {signal: controller.signal});
        if (!response.ok) throw new ApiError(response.status);
        const value: Chat[] = await response.json();
        if (!controller.signal.aborted) setProjectChats({id, chats: {status: 'ready', value}});
      } catch {
        if (!controller.signal.aborted) setProjectChats({id, chats: {status: 'error'}});
      }
    }
    void load();
    return () => controller.abort();
  }, [signed, sidebarProjectId, projectChatsRefresh]);

  async function api(path: string, init: RequestInit = {}) {
    const response = await fetch(path, {
      ...init,
      headers: {'Content-Type': 'application/json', ...(init.method === 'POST' ? {'X-CSRF-Token': csrf} : {}), ...init.headers},
    });
    if (!response.ok) throw new ApiError(response.status);
    return response;
  }

  function fail(failure: unknown) {
    const status = failure instanceof ApiError ? failure.status : null;
    setError(status === 402 ? t.balanceLow : status === 401 ? t.loginExpired : t.error);
  }

  async function refresh() {
    try { setAccount(await (await api('/api/account')).json()); } catch (failure) { fail(failure); }
  }

  useEffect(() => {
    let live = true;
    async function initialize() {
      try {
        const response = await fetch('/api/session');
        if (response.status === 401) return;
        if (!response.ok) throw new ApiError(response.status);
        const session = await response.json();
        const [wallet, catalog, history] = await Promise.all(
          ['/api/account', '/api/models?catalog=true', PERSONAL_CONVERSATIONS].map(async path => (await api(path)).json()),
        );
        if (!live) return;
        const activeModels = readModels(catalog);
        setCsrf(session.csrf);
        setSigned(true);
        setAccount(wallet);
        setModels(activeModels);
        setModel(activeModels.find(entry => entry.category === 'chat')?.id ?? '');
        setChats(history);
      } catch (failure) {
        if (live) fail(failure);
      } finally {
        if (live) setReady(true);
      }
    }
    void initialize();
    return () => { live = false; };
  }, []);

  function navigate(target: View, projectId: string | null = null) {
    setView(target);
    setProjectPageId(projectId);
    setMobile(false);
    const hash = target === 'projects' && projectId ? `projects/${projectId}` : target;
    if (location.hash.slice(1) !== hash) location.hash = hash;
  }

  async function saveProject(draft: ProjectSettings) {
    const previous = dialog?.kind === 'project' ? dialog.project : null;
    const path = previous ? '/api/projects/' + previous.id : '/api/projects';
    const saved: Project = await (await api(path, {method: 'POST', body: JSON.stringify(draft)})).json();
    setProjects(current => {
      const value = current.status === 'ready' ? current.value : [];
      return {status: 'ready', value: previous ? value.map(project => project.id === saved.id ? saved : project) : [saved, ...value]};
    });
    setDialog(null);
    if (!previous) navigate('projects', saved.id);
  }

  async function saveHistory(turns: number) {
    const preferences = await (await api('/api/preferences', {method: 'POST', body: JSON.stringify({history_turns: turns})})).json();
    setHistoryTurns(preferences.history_turns);
    setDialog(null);
  }

  function useConnectionResult(result: string) {
    if (busy || pending) return;
    if (currentModel?.category !== 'chat') setModel(selectableModels.find(entry => entry.category === 'chat')?.id ?? '');
    setText(draft => [draft, result].filter(Boolean).join('\n\n').slice(0, 8000));
    navigate('chat');
  }

  useEffect(() => {
    if (!signed) return;
    const acceptCapture = (event: MessageEvent) => {
      if (event.source!==window || event.origin!==location.origin || event.data?.type!=='servernet.browser-capture.v1'
        || typeof event.data.image!=='string' || event.data.image.length>2_800_000
        || !/^data:image\/jpeg;base64,[a-zA-Z0-9+/]+={0,2}$/.test(event.data.image)) return;
      if (busy || !visionModel) {
        window.postMessage({type:'servernet.browser-capture.ack', id:event.data.id, accepted:false}, location.origin);
        return;
      }
      setImage(event.data.image);
      if (!currentModel?.vision) setModel(visionModel.id);
      setText(previous=>previous || f.analyze);
      navigate('chat');
      window.postMessage({type:'servernet.browser-capture.ack', id:event.data.id, accepted:true}, location.origin);
    };
    window.addEventListener('message', acceptCapture);
    return () => window.removeEventListener('message', acceptCapture);
  }, [signed, visionModel, currentModel, busy, locale]);

  async function attach(file: File) {
    if (!visionModel || busy) return;
    try {
      setImage(await normalizeImage(file));
      if (!currentModel?.vision) setModel(visionModel.id);
      input.current?.focus();
    } catch { setError(f.imageError); }
  }

  async function checkMedia(id: string) {
    if (mediaChecks.current.has(id)) return;
    mediaChecks.current.add(id);
    try {
      const job: MediaJob = await (await api('/api/media/'+id)).json();
      setMessages(previous=>previous.map(message=>message.media?.id===id?{...message,media:job}:message));
      if (job.state==='ready'||job.state==='failed') await refresh();
    } catch (failure) { if (failure instanceof ApiError && failure.status===401) fail(failure); }
    finally { mediaChecks.current.delete(id); }
  }

  const processingIds = messages.filter(message=>message.media?.state==='processing'||message.media?.state==='sending')
    .map(message=>message.media!.id).join(',');
  const unresolvedMedia = messages.some(message => message.media?.state === 'unknown' || message.media?.state === 'sending');
  useEffect(() => {
    if (!processingIds || !signed) return;
    const timer=window.setInterval(()=>processingIds.split(',').forEach(id=>{void checkMedia(id);}), 8000);
    return ()=>window.clearInterval(timer);
  }, [processingIds, signed]);

  function changeTheme() {
    setTheme(nextTheme);
    savePreference(THEME_KEY, nextTheme);
  }

  async function open(chat: Chat) {
    if (busy) return;
    const version = ++requestVersion.current;
    setError('');
    try {
      const detail = await (await api('/api/conversations/' + chat.id)).json();
      if (version !== requestVersion.current) return;
      setActive(chat.id);
      const ownerProject = detail.project_id ?? chat.project_id ?? null;
      if (chatProjectId !== ownerProject) {
        setText('');
        setImage(null);
      }
      setChatProjectId(ownerProject);
      setMessages(detail.messages);
      setPending(Boolean(detail.pending));
      stickToBottom.current = true;
      navigate('chat');
    } catch (failure) {
      if (version === requestVersion.current) fail(failure);
    }
  }

  function fresh(projectId: string | null = null) {
    if (busy) return;
    ++requestVersion.current;
    setActive('');
    setChatProjectId(projectId);
    setMessages([]);
    setPending(false);
    setError('');
    setText('');
    setImage(null);
    stickToBottom.current = true;
    navigate('chat');
    input.current?.focus();
  }

  async function createConversation(): Promise<Chat> {
    const chat: Chat = await (await api('/api/conversations', {method: 'POST', body: JSON.stringify({project_id: chatProjectId})})).json();
    if (chatProjectId) {
      const id = chatProjectId;
      setProjectChats(current => {
        const previous = current?.id === id && current.chats.status === 'ready' ? current.chats.value : [];
        return {id, chats: {status: 'ready', value: [chat, ...previous]}};
      });
    } else setChats(previous => [chat, ...previous]);
    return chat;
  }

  async function refreshConversations() {
    if (chatProjectId) setProjectChatsRefresh(version => version + 1);
    else setChats(await (await api(PERSONAL_CONVERSATIONS)).json());
  }

  async function send() {
    if (busy || pending || !model || !text.trim() || (image && !currentModel?.vision)) return;
    ++requestVersion.current;
    const message = text.trim();
    setError('');
    setBusy(true);
    setText('');
    const sentImage=image;
    setImage(null);
    stickToBottom.current = true;
    const previous = [...messages, {role: 'user', content: message, image: sentImage ?? undefined}];
    setMessages([...previous, {role: 'assistant', content: ''}]);
    let id = active;
    let received = '';
    let finished = false;
    let frame: number | null = null;
    try {
      if (!id) {
        const chat = await createConversation();
        id = chat.id;
        setActive(id);
      }
      const requestId = crypto.randomUUID().replaceAll('-', '');
      const response = await api('/api/chat', {
        method: 'POST',
        body: JSON.stringify({conversation_id: id, request_id: requestId, model, message, ...(sentImage ? {image:sentImage}:{})}),
      });
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const chunk = await reader.read();
        buffer += decoder.decode(chunk.value, {stream: !chunk.done});
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) !== -1) {
          const lines = buffer.slice(0, boundary).split('\n');
          buffer = buffer.slice(boundary + 2);
          const name = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
          const raw = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
          if (!raw) continue;
          const value = JSON.parse(raw);
          if (name === 'delta') {
            received += value.text;
            if (frame===null) frame=requestAnimationFrame(()=>{
              frame=null;
              if (!finished) setMessages([...previous, {role:'assistant',content:received}]);
            });
          }
          if (name === 'done') {
            finished = true;
            setMessages([...previous, {role: 'assistant', content: value.text}]);
          }
          if (name === 'error') throw new Error('Unconfirmed request');
        }
        if (chunk.done) break;
      }
      if (!finished) throw new Error('Incomplete stream');
      await refreshConversations();
      await refresh();
    } catch (failure) {
      fail(failure);
      if (id) {
        try {
          const detail = await (await api('/api/conversations/' + id)).json();
          setPending(Boolean(detail.pending));
          setMessages(detail.messages);
        } catch {
          setPending(true);
        }
      } else {
        setMessages(messages);
        setText(message);
        setImage(sentImage);
      }
    } finally {
      if (frame!==null) cancelAnimationFrame(frame);
      setBusy(false);
    }
  }

  async function quoteMedia(parameters: Parameters) {
    const response=await api('/api/media/quote',{method:'POST',body:JSON.stringify({model,category:currentModel?.category,parameters})});
    return (await response.json()).max_hold_irt as number;
  }

  async function generateMedia(parameters: Parameters,label: string,max: number) {
    if (busy || pending || unresolvedMedia || !currentModel || currentModel.category==='chat') return;
    ++requestVersion.current;
    setBusy(true);
    setError('');
    stickToBottom.current = true;
    let id=active;
    const requestId=crypto.randomUUID().replaceAll('-', '');
    try {
      if (!id) {
        const chat=await createConversation();
        id=chat.id;
        setActive(id);
      }
      const previous=[...messages,{role:'user',content:label}];
      setMessages([...previous,{role:'assistant',content:'',media:{id:requestId,state:'sending'}}]);
      const job:MediaJob=await (await api('/api/media',{method:'POST',body:JSON.stringify({
        model,category:currentModel.category,parameters,label,conversation_id:id,request_id:requestId,max_hold_irt:max,
      })})).json();
      setMessages([...previous,{role:'assistant',content:'',media:job}]);
      setText('');
      await refreshConversations();
      await refresh();
    } catch (failure) {
      fail(failure);
      if (id) {
        try {
          const detail=await (await api('/api/conversations/'+id)).json();
          setMessages(detail.messages);
        } catch {
          setMessages(previous=>previous.map(message=>message.media?.id===requestId?
            {...message,media:{id:requestId,state:'unknown'}}:message));
        }
      }
    } finally { setBusy(false); }
  }

  async function logout() {
    try {
      await api('/api/logout', {method: 'POST'});
      ++requestVersion.current;
      setSigned(false);
      setAccount(null);
      setMessages([]);
      setChats([]);
      setProjects({status: 'loading'});
      setProjectChats(null);
      setChatProjectId(null);
      setHistoryTurns(null);
      setDialog(null);
      setCsrf('');
      setActive('');
      setError('');
      setText('');
      setImage(null);
      setPending(false);
      navigate('chat');
    } catch (failure) {
      fail(failure);
    }
  }

  const languages = <select className="language" aria-label="Language / زبان" value={locale} onChange={event => {
    const next = event.target.value as Locale;
    setLocale(next);
    savePreference(LANGUAGE_KEY, next);
  }}>
    <option value="en">English</option><option value="fa">فارسی</option><option value="tr">Türkçe</option>
  </select>;
  const brand = <div className="brand"><img src="/servernet.svg" alt=""/><div>
    <b>ServerNet <span>Studio</span></b>{!signed && <small>{t.tagline}</small>}
  </div></div>;

  if (!ready) return <div className="loading"><img src="/servernet.svg" alt="ServerNet"/>{t.loading}</div>;
  if (!signed) {
    const loginUrl = (method: string) => '/auth/start?' + new URLSearchParams({lang: locale, method, theme});
    return <main className="login-page">
      <nav>
        {brand}
        <div className="login-settings">
          {languages}
          <button type="button" className="theme-toggle" onClick={changeTheme}><ThemeIcon size={16} aria-hidden="true"/>{themeLabel}</button>
        </div>
      </nav>
      <div className="login-grid">
        <section className="login-copy">
          <div className="eyebrow"><Sparkles size={15}/> SERVERNET AI</div>
          <h1>{t.loginTitle}</h1>
          <p>{t.loginSub}</p>
          <div className="login-points"><span><ShieldCheck size={19}/>{t.central}</span><span><Wallet size={19}/>{t.foot}</span></div>
        </section>
        <section className="login-card">
          <div className="logo-orbit"><img src="/servernet.svg" alt=""/></div>
          <h2>ServerNet Studio</h2>
          <p>{t.tagline}</p>
          {error && <div className="notice" role="alert">{error}</div>}
          <a className="primary login-button" href={loginUrl('account')}>{t.login}<ArrowUpRight size={18}/></a>
          <a className="google-button" href={loginUrl('google')}>{t.google}</a>
          <a className="register" href={loginUrl('register')}>{t.register}</a>
        </section>
      </div>
      <footer><span>ServerNet Studio</span><a href="/legal">{t.legal}</a></footer>
    </main>;
  }

  const sidebarLabel = collapsed ? w.expand : w.collapse;
  const SidebarIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
  const currentProjectChats: ProjectChatState = projectChats && projectChats.id === sidebarProjectId ? projectChats.chats : {status: 'loading'};
  const recentChats = sidebarProjectId ? currentProjectChats.status === 'ready' ? currentProjectChats.value : [] : chats;
  const displayedView = view === 'connectors' ? connectorCopy[locale].heading : view === 'projects' ? pageProject?.name ?? p.title
    : view === 'models' ? w.catalog : view === 'library' ? w.history : w[view];
  return <div className="workspace">
    <WorkspaceSidebar brand={brand} locale={locale} view={view} open={mobile} collapsed={collapsed} chats={recentChats}
      active={active} account={account} busy={busy} withinProject={Boolean(sidebarProjectId)} close={() => setMobile(false)}
      navigate={target => {if (target === 'chat' && chatProjectId) fresh(); else navigate(target);}}
      fresh={() => fresh(sidebarProjectId)} openChat={open} refreshBalance={refresh} logout={logout}/>
    <button type="button" className="backdrop" data-open={mobile||undefined} tabIndex={mobile ? 0 : -1}
      aria-label={t.close} onClick={() => setMobile(false)}/>
    <main className="main-panel">
      <header className="workspace-header">
        <div className="workspace-header-left">
          <button type="button" className="desktop-toggle icon-button" aria-controls="studio-sidebar" aria-expanded={!collapsed}
            aria-label={sidebarLabel} title={sidebarLabel} onClick={() => setCollapsed(!collapsed)}><SidebarIcon size={19}/></button>
          <button ref={mobileToggle} type="button" className="mobile-toggle icon-button" aria-controls="studio-sidebar" aria-expanded={mobile}
            aria-label={w.expand} onClick={() => setMobile(true)}><Menu size={21}/></button>
          {view === 'chat'
            ? <div className="model-selector">
              <span className="model-dot" aria-hidden="true"/>
              <select aria-label={f.model} value={model} onChange={event => setModel(event.target.value)} disabled={busy || !selectableModels.length}>
                {selectableModels.length ? selectableModels.map(entry => <option key={entry.id} value={entry.id}>{entry.label}</option>) : <option value="">{t.noModels}</option>}
              </select>
            </div>
            : <span className="header-location">{displayedView}</span>}
        </div>
        <div className="workspace-header-right">
          {languages}
          <button type="button" className="icon-button" onClick={changeTheme} aria-label={themeLabel} title={themeLabel}><ThemeIcon size={18}/></button>
          {account && <button type="button" className="usage" title={p.usage} aria-label={p.usage} onClick={() => setDialog({kind: 'usage'})}>
            <ChartNoAxesColumnIncreasing size={16} aria-hidden="true"/>
            <span>{number(account.ai.prompt_tokens_month + account.ai.completion_tokens_month)} {t.token}</span>
          </button>}
        </div>
      </header>
      {view === 'library' ? <ConversationLibrary locale={locale} chats={chats} busy={busy} open={open}/>
        : view === 'connectors' ? <ConnectedServices locale={locale} csrf={csrf} useInChat={!busy && !pending ? useConnectionResult : undefined}/>
        : view === 'projects' ? pageProject
          ? <ProjectFolder key={pageProject.id} locale={locale} project={pageProject} conversations={currentProjectChats} busy={busy} openChat={open}
            newChat={() => fresh(pageProject.id)} edit={() => setDialog({kind: 'project', project: pageProject})} back={() => navigate('projects')}
            retry={() => {setProjectChats({id: pageProject.id, chats: {status: 'loading'}}); setProjectChatsRefresh(version => version + 1);}}/>
          : <ProjectsHome locale={locale} projects={projects} busy={busy} missing={Boolean(projectPageId)}
            create={() => setDialog({kind: 'project', project: null})} open={project => navigate('projects', project.id)}
            retry={() => {setProjects({status: 'loading'}); setProjectRefresh(version => version + 1);}}/>
        : view !== 'chat' ? <ModelCatalog key={view} locale={locale} models={models} view={view} busy={busy} rate={rate}
          choose={id => { fresh(); setModel(id); }}/>
        : <>
          <div className="conversation-body" ref={conversationBody} onScroll={event=>{
            const panel=event.currentTarget;
            stickToBottom.current=panel.scrollHeight-panel.scrollTop-panel.clientHeight<120;
          }}>
            {messages.length === 0 ? <div className="welcome">
              <span className="welcome-icon">{chatProject ? <FolderOpen size={28} aria-hidden="true"/> : <img src="/servernet.svg" alt=""/>}</span>
              <h1 dir="auto">{chatProject?.name ?? t.title}</h1>
              <p>{chatProject ? p.projectEmpty : t.subtitle}</p>
              <div className="suggestions">
                {[MessageSquare, Code2, Lightbulb].map((Icon, index) => <button type="button" key={index}
                  onClick={() => { setText(t.prompts[index]); input.current?.focus(); }} disabled={!model}>
                  <Icon size={18}/><span>{t.ideas[index]}</span><ArrowUpRight size={15}/>
                </button>)}
              </div>
            </div> : <div className="messages">
              {messages.map((message, index) => {
                const media = message.media;
                const waiting = !media && message.role === 'assistant' && !message.content && busy;
                const working = waiting || media?.state === 'sending' || media?.state === 'processing' || media?.state === 'unknown';
                return <article key={index} className={'message ' + message.role + (working ? ' message-working' : '')}>
                  {!working && <div className="message-avatar">{message.role === 'assistant' ? <img src="/servernet.svg" alt=""/> : account?.customer.name.charAt(0)}</div>}
                  <div>
                    {!working && <b>{message.role === 'assistant' ? t.assistant : t.you}</b>}
                    {message.image&&<img className="sent-image" src={message.image} alt={f.draftImage}/>}
                    {media ? <MediaResult job={media} locale={locale} refresh={()=>{void checkMedia(media.id);}}/> :
                      waiting ? <Thinking text={f.thinking}/> : <div className="message-content" dir="auto">{message.content}</div>}
                  </div>
                </article>;
              })}
            </div>}
          </div>
          <div className="composer-area">
            {(error || pending) && <div className="notice" role="alert">
              {pending ? t.unknown : error} <a href={consoleUrl('account/ai')} target="_blank" rel="noopener noreferrer">{t.console} ↗</a>
            </div>}
            {!model && <div className="notice">{t.noModels}</div>}
            {(!chatProjectId || chatProject) && <ChatContext locale={locale} project={chatProject} historyTurns={historyTurns} working={busy}
              open={() => navigate('projects', chatProjectId)} edit={() => setDialog(chatProject ? {kind: 'project', project: chatProject} : {kind: 'history'})}/>}
            {currentModel&&currentModel.category!=='chat' ?
              <MediaComposer key={currentModel.id} model={currentModel} locale={locale} text={text} setText={setText}
                amount={amount} quote={quoteMedia} generate={generateMedia} isSending={busy || pending || unresolvedMedia}/> :
              <form className="composer" onSubmit={event => { event.preventDefault(); void send(); }}>
              {image&&<ImageAttachmentPreview locale={locale} source={image} remove={()=>setImage(null)}/>}
              {image&&!currentModel?.vision&&<div className="notice">{f.useVision}</div>}
              <textarea ref={input} value={text} onChange={event => setText(event.target.value)} placeholder={t.placeholder} aria-label={t.placeholder}
                maxLength={8000} rows={2} disabled={busy || pending || !model} onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    void send();
                  }
                }}/>
              <div className="composer-bottom">
                {visionModel&&<ImageAttachment locale={locale} disabled={busy||pending||!model} attach={file=>{void attach(file);}}/>}
                <button type="submit" className="send" aria-label={t.send} title={t.send}
                  disabled={busy || pending || !model || !text.trim() || Boolean(image&&!currentModel?.vision)}><ArrowUp size={19}/></button>
              </div>
            </form>}
            <p className="composer-foot">{t.foot}</p>
          </div>
        </>}
      {view !== 'chat' && error && <div className="workspace-error notice" role="alert">{error}</div>}
    </main>
    {dialog?.kind === 'project' && <ProjectDialog locale={locale} project={dialog.project} save={saveProject} close={() => setDialog(null)}/>}
    {dialog?.kind === 'history' && historyTurns !== null && <HistoryDialog locale={locale} historyTurns={historyTurns}
      save={saveHistory} close={() => setDialog(null)}/>}
    {dialog?.kind === 'usage' && account && <UsageDialog locale={locale} usage={account.ai} spend={amount(account.ai.spent_month)}
      dashboard={consoleUrl('account/ai')} close={() => setDialog(null)}/>}
  </div>;
}

createRoot(document.getElementById('root')!).render(<App/>);
