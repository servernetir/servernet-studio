// SPDX-License-Identifier: AGPL-3.0-only
import {useId, useLayoutEffect, useRef, useState, type ReactNode} from 'react';
import {ArrowUpRight, Folder, FolderOpen, Plus, Settings2, X} from 'lucide-react';
import {type Locale} from './copy';
import {projectCopy} from './project-copy';
import {ConversationLibrary, type Account, type Chat} from './workspace';
import './projects.css';

export const DEFAULT_HISTORY_TURNS = 12;
const MAX_HISTORY_TURNS = 32;

export type ProjectSettings = {
  name: string;
  description: string;
  instructions: string;
  context_scope: 'project' | 'all';
  history_turns: number;
};
export type Project = ProjectSettings & {id: string};

type LoadState<T> = {status: 'loading' | 'error'} | {status: 'ready'; value: T};
export type ProjectsState = LoadState<Project[]>;
export type ProjectChatState = LoadState<Chat[]>;

export function projectIdFromHash() {
  return location.hash.match(/^#projects\/([a-zA-Z0-9_-]{1,80})$/)?.[1] ?? null;
}

function scopeLabel(project: Project, locale: Locale) {
  const t = projectCopy[locale];
  return project.context_scope === 'all' ? t.allScope : t.projectScope;
}

function historyLabel(turns: number, locale: Locale) {
  const t = projectCopy[locale];
  return turns === 0 ? t.noHistory : t.historyLimit.replace('{n}', new Intl.NumberFormat(locale).format(turns));
}

export function ProjectsHome({locale, projects, busy, create, open, retry, missing}: {
  locale: Locale;
  projects: ProjectsState;
  busy: boolean;
  create: () => void;
  open: (project: Project) => void;
  retry: () => void;
  missing: boolean;
}) {
  const t = projectCopy[locale];
  return <section className="tool-view" aria-labelledby="projects-title">
    <header className="tool-heading">
      <div><h1 id="projects-title">{t.title}</h1><p>{t.intro}</p></div>
      <button type="button" className="secondary-button project-primary" onClick={create} disabled={busy || projects.status !== 'ready'}>
        <Plus size={16} aria-hidden="true"/>{t.newProject}
      </button>
    </header>
    {projects.status === 'loading' && <p className="empty-state" role="status">{t.loading}</p>}
    {projects.status === 'error' && <div className="empty-state project-load-error" role="alert">
      <span>{t.loadError}</span><button type="button" className="secondary-button" onClick={retry}>{t.retry}</button>
    </div>}
    {projects.status === 'ready' && <>
      {missing && <p className="notice" role="alert">{t.missing}</p>}
      {projects.value.length === 0 ? <p className="empty-state">{t.empty}</p> : <div className="project-grid">
        {projects.value.map(project => <button type="button" key={project.id} className="project-card" onClick={() => open(project)}>
          <span className="model-icon"><Folder size={19} aria-hidden="true"/></span>
          <strong dir="auto">{project.name}</strong>
          {project.description && <span className="project-summary" dir="auto">{project.description}</span>}
          <span className="project-meta"><span>{scopeLabel(project, locale)}</span><span>{historyLabel(project.history_turns, locale)}</span></span>
        </button>)}
      </div>}
    </>}
  </section>;
}

export function ProjectFolder({locale, project, conversations, busy, openChat, newChat, edit, back, retry}: {
  locale: Locale;
  project: Project;
  conversations: ProjectChatState;
  busy: boolean;
  openChat: (chat: Chat) => void;
  newChat: () => void;
  edit: () => void;
  back: () => void;
  retry: () => void;
}) {
  const t = projectCopy[locale];

  return <section className="tool-view" aria-labelledby="project-title">
    <button type="button" className="project-back" onClick={back}><Folder size={15} aria-hidden="true"/>{t.back}</button>
    <header className="tool-heading">
      <div className="project-identity">
        <span className="model-icon"><FolderOpen size={20} aria-hidden="true"/></span>
        <div>
          <h1 id="project-title" dir="auto">{project.name}</h1>
          {project.description && <p dir="auto">{project.description}</p>}
          <div className="project-meta"><span>{scopeLabel(project, locale)}</span><span>{historyLabel(project.history_turns, locale)}</span></div>
        </div>
      </div>
      <div className="project-actions">
        <button type="button" className="secondary-button" onClick={edit} disabled={busy}><Settings2 size={15} aria-hidden="true"/>{t.settings}</button>
        <button type="button" className="secondary-button project-primary" onClick={newChat} disabled={busy}>
          <Plus size={16} aria-hidden="true"/>{t.newChat}
        </button>
      </div>
    </header>
    {conversations.status === 'loading' && <p className="empty-state" role="status">{t.chatsLoading}</p>}
    {conversations.status === 'error' && <div className="empty-state project-load-error" role="alert">
      <span>{t.chatsError}</span>
      <button type="button" className="secondary-button" onClick={retry}>{t.retry}</button>
    </div>}
    {conversations.status === 'ready' && <ConversationLibrary locale={locale} chats={conversations.value} busy={busy}
      title={t.conversations} emptyLabel={t.emptyChats} open={openChat}/>}
  </section>;
}

function Dialog({title, closeLabel, busy = false, close, children}: {
  title: string; closeLabel: string; busy?: boolean; close: () => void; children: ReactNode;
}) {
  const id = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  useLayoutEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return <dialog ref={dialog} className="project-dialog" aria-labelledby={id} onCancel={event => {
    event.preventDefault();
    if (!busy) close();
  }}>
    <header>
      <h2 id={id}>{title}</h2>
      <button type="button" className="icon-button" onClick={close} disabled={busy} aria-label={closeLabel}><X size={19} aria-hidden="true"/></button>
    </header>
    {children}
  </dialog>;
}

function HistoryControl({locale, turns, change}: {locale: Locale; turns: number; change: (turns: number) => void}) {
  const t = projectCopy[locale];
  const id = useId();
  return <div className="project-history-control">
    <div><label htmlFor={id}>{t.history}</label><output htmlFor={id}>{historyLabel(turns, locale)}</output></div>
    <input id={id} type="range" min={0} max={MAX_HISTORY_TURNS} value={turns} aria-valuetext={historyLabel(turns, locale)}
      aria-describedby={id + '-hint'} onChange={event => change(Number(event.target.value))}/>
    <small id={id + '-hint'}>{t.historyHint} {t.historyLimitHint}</small>
  </div>;
}

export function ProjectDialog({locale, project, save, close}: {
  locale: Locale;
  project: Project | null;
  save: (project: ProjectSettings) => Promise<void>;
  close: () => void;
}) {
  const t = projectCopy[locale];
  const [draft, setDraft] = useState<ProjectSettings>(() => ({
    name: project?.name ?? '', description: project?.description ?? '', instructions: project?.instructions ?? '',
    context_scope: project?.context_scope ?? 'project', history_turns: project?.history_turns ?? DEFAULT_HISTORY_TURNS,
  }));
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function submit() {
    if (busy || !draft.name.trim()) return;
    setBusy(true);
    setFailed(false);
    try { await save({...draft, name: draft.name.trim()}); } catch { setFailed(true); }
    finally { setBusy(false); }
  }

  return <Dialog title={project ? t.settings : t.newProject} closeLabel={t.close} busy={busy} close={close}>
    <form className="project-form" onSubmit={event => {event.preventDefault(); void submit();}}>
      <label>{t.name}
        <input autoFocus maxLength={80} required dir="auto" value={draft.name} placeholder={t.nameHint}
          onChange={event => setDraft({...draft, name: event.target.value})}/>
      </label>
      <label>{t.description}
        <textarea maxLength={500} dir="auto" rows={2} value={draft.description} onChange={event => setDraft({...draft, description: event.target.value})}/>
      </label>
      <label>{t.instructions}
        <textarea maxLength={1800} rows={3} dir="auto" value={draft.instructions} placeholder={t.instructionsHint}
          onChange={event => setDraft({...draft, instructions: event.target.value})}/>
      </label>
      <fieldset className="project-scope">
        <legend>{t.scope}</legend>
        <label>
          <input name="project-scope" type="radio" checked={draft.context_scope === 'project'}
            onChange={() => setDraft({...draft, context_scope: 'project'})}/>
          <span><strong>{t.projectScope}</strong><small>{t.projectHint}</small></span>
        </label>
        <label>
          <input name="project-scope" type="radio" checked={draft.context_scope === 'all'}
            onChange={() => setDraft({...draft, context_scope: 'all'})}/>
          <span><strong>{t.allScope}</strong><small>{t.allHint}</small></span>
        </label>
      </fieldset>
      <HistoryControl locale={locale} turns={draft.history_turns} change={turns => setDraft({...draft, history_turns: turns})}/>
      {failed && <p className="notice" role="alert">{t.saveError}</p>}
      <footer className="project-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={close}>{t.cancel}</button>
        <button type="submit" className="secondary-button project-primary" disabled={busy || !draft.name.trim()}>
          {busy ? t.saving : project ? t.save : t.create}
        </button>
      </footer>
    </form>
  </Dialog>;
}

export function HistoryDialog({locale, historyTurns, save, close}: {
  locale: Locale; historyTurns: number; save: (turns: number) => Promise<void>; close: () => void;
}) {
  const t = projectCopy[locale];
  const [draft, setDraft] = useState(historyTurns);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  async function submit() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    try { await save(draft); } catch { setFailed(true); }
    finally { setBusy(false); }
  }
  return <Dialog title={t.contextSettings} closeLabel={t.close} busy={busy} close={close}>
    <form className="project-form" onSubmit={event => {event.preventDefault(); void submit();}}>
      <HistoryControl locale={locale} turns={draft} change={setDraft}/>
      {failed && <p className="notice" role="alert">{t.saveError}</p>}
      <footer className="project-actions">
        <button type="button" className="secondary-button" disabled={busy} onClick={close}>{t.cancel}</button>
        <button type="submit" className="secondary-button project-primary" disabled={busy}>{busy ? t.saving : t.save}</button>
      </footer>
    </form>
  </Dialog>;
}

export function UsageDialog({locale, usage, spend, dashboard, close}: {
  locale: Locale; usage: Account['ai']; spend: string | null; dashboard: string; close: () => void;
}) {
  const t = projectCopy[locale];
  const number = new Intl.NumberFormat(locale);
  return <Dialog title={t.usage} closeLabel={t.close} close={close}>
    <dl className="usage-metrics">
      <div><dt>{t.inputTokens}</dt><dd>{number.format(usage.prompt_tokens_month)}<small>{t.inputHint}</small></dd></div>
      <div><dt>{t.outputTokens}</dt><dd>{number.format(usage.completion_tokens_month)}<small>{t.outputHint}</small></dd></div>
      {spend !== null && <div><dt>{t.monthlyCost}</dt><dd>{spend}</dd></div>}
    </dl>
    <p className="usage-hint">{t.usageHint}</p>
    <footer className="project-actions">
      <a className="secondary-button" href={dashboard} target="_blank" rel="noopener noreferrer">{t.manageUsage}<ArrowUpRight size={15} aria-hidden="true"/></a>
    </footer>
  </Dialog>;
}

export function ChatContext({locale, project, historyTurns, working, open, edit}: {
  locale: Locale; project: Project | null; historyTurns: number | null; working: boolean; open: () => void; edit: () => void;
}) {
  const t = projectCopy[locale];
  const turns = project?.history_turns ?? historyTurns;
  if (!project && turns === null) return null;
  return <div className="chat-context">
    {project ? <button type="button" className="context-chip" onClick={open} disabled={working} title={scopeLabel(project, locale)}>
      <Folder size={14} aria-hidden="true"/><span dir="auto">{project.name}</span>
    </button> : <span className="context-origin">{t.outside}</span>}
    <button type="button" className="context-chip" onClick={edit} disabled={working} aria-label={t.contextSettings} title={t.contextSettings}>
      <Settings2 size={14} aria-hidden="true"/>
      {turns === null ? t.history : historyLabel(turns, locale)}
    </button>
  </div>;
}
