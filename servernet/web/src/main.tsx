// SPDX-License-Identifier: AGPL-3.0-only
// Copyright 2026 ServerNet contributors
import React, {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ArrowUp, ArrowUpRight, Wallet, Plus, MessageSquare, LogOut, Sparkles, Code2, Lightbulb, RefreshCw, Menu, X, ShieldCheck, Sun, Moon} from 'lucide-react';
import {copy, type Locale} from './copy';
import './style.css';

type Chat = {id:string,title:string};
type Message = {role:string,content:string};
type Account = {customer:{name:string},wallet:{currency:string,unit:string,available:number,reserved:number},ai:{spent_month:number,prompt_tokens_month:number,completion_tokens_month:number}};
const LANGUAGE_KEY = 'servernet.studio.language';
const THEME_KEY = 'servernet.studio.theme';

function readPreference(key: string) {
 try { return localStorage.getItem(key); } catch { return null; }
}

function savePreference(key: string, value: string) {
 try { localStorage.setItem(key, value); } catch { /* The choice still applies until this page closes. */ }
}

class ApiError extends Error {constructor(public status:number){super('ServerNet request failed');}}
export function App(){
 const [locale,setLocale]=useState<Locale>(()=>{
  const saved=readPreference(LANGUAGE_KEY);
  return saved==='fa'||saved==='tr'?saved:'en';
 });
 const [theme,setTheme]=useState(()=>(readPreference(THEME_KEY)==='light'?'light':'dark'));
 const t=copy[locale], rtl=locale==='fa';
 const [ready,setReady]=useState(false),[signed,setSigned]=useState(false),[csrf,setCsrf]=useState('');
 const [account,setAccount]=useState<Account|null>(null),[models,setModels]=useState<string[]>([]),[model,setModel]=useState('');
 const [chats,setChats]=useState<Chat[]>([]),[active,setActive]=useState(''),[messages,setMessages]=useState<Message[]>([]);
 const [text,setText]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState(''),[pending,setPending]=useState(false),[charge,setCharge]=useState<number|null>(null),[mobile,setMobile]=useState(false);
 const bottom=useRef<HTMLDivElement>(null),input=useRef<HTMLTextAreaElement>(null);
 const requestVersion=useRef(0);
 const fmt=(n:number)=>new Intl.NumberFormat(locale==='fa'?'fa-IR':locale==='tr'?'tr-TR':'en-US').format(n);
 const consolePath=(path:string)=>`https://console.servernet.cloud/${locale==='fa'?'':locale+'/'}${path}`;
 useLayoutEffect(()=>{
  document.documentElement.lang=locale;
  document.documentElement.dir=rtl?'rtl':'ltr';
  document.documentElement.dataset.signInTheme=theme;
 },[locale,rtl,theme]);
 async function api(path:string, init:RequestInit={}){
  const r=await fetch(path,{...init,headers:{'Content-Type':'application/json',...(init.method==='POST'?{'X-CSRF-Token':csrf}:{}),...init.headers}});
  if(!r.ok)throw new ApiError(r.status); return r;
 }
 function fail(e:unknown){setError(e instanceof ApiError&&e.status===402?t.balanceLow:e instanceof ApiError&&e.status===401?t.loginExpired:t.error);}
 async function refresh(){try{const a=await (await api('/api/account')).json();setAccount(a);}catch(e){fail(e);}}
 useEffect(()=>{let live=true;(async()=>{try{
  const r=await fetch('/api/session');if(r.status===401)return;if(!r.ok)throw new ApiError(r.status);const s=await r.json();
  const responses=await Promise.all(['/api/account','/api/models','/api/conversations'].map(p=>fetch(p)));
  if(responses.some(r=>!r.ok))throw new ApiError(responses.find(r=>!r.ok)!.status);
  const [a,m,c]=await Promise.all(responses.map(r=>r.json()));if(!live)return;
  setCsrf(s.csrf);setSigned(true);setAccount(a);setModels(m.data.map((x:{id:string})=>x.id));setModel(m.data[0]?.id??'');setChats(c);
 }catch(e){if(live)fail(e);}finally{if(live)setReady(true);}})();return()=>{live=false};},[]);
 useEffect(()=>{bottom.current?.scrollIntoView({behavior:'smooth'});},[messages]);
 async function open(c:Chat){if(busy)return;const version=++requestVersion.current;setError('');try{const d=await(await api('/api/conversations/'+c.id)).json();if(version!==requestVersion.current)return;setActive(c.id);setMessages(d.messages);setPending(Boolean(d.pending));setCharge(null);setMobile(false);}catch(e){fail(e);}}
 function fresh(){if(busy)return;++requestVersion.current;setActive('');setMessages([]);setPending(false);setError('');setCharge(null);setText('');setMobile(false);input.current?.focus();}
 async function send(){
  if(busy||pending||!model||!text.trim())return;
  const message=text.trim();setError('');setBusy(true);setCharge(null);setText('');
  let id=active,received='',finished=false;
  try{
   if(!id){const c=await(await api('/api/conversations',{method:'POST'})).json();id=c.id;setActive(id);setChats(p=>[c,...p]);}
   const previous=[...messages,{role:'user',content:message}];setMessages([...previous,{role:'assistant',content:''}]);
   const requestId=crypto.randomUUID().replaceAll('-','');
   const response=await api('/api/chat',{method:'POST',body:JSON.stringify({conversation_id:id,request_id:requestId,model,message})});
   const reader=response.body!.getReader(), decoder=new TextDecoder();let buffer='';
   while(true){const r=await reader.read();buffer+=decoder.decode(r.value,{stream:!r.done});let boundary:number;
    while((boundary=buffer.indexOf('\n\n'))!==-1){const block=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);const name=block.split('\n').find(l=>l.startsWith('event:'))?.slice(6).trim();const raw=block.split('\n').filter(l=>l.startsWith('data:')).map(l=>l.slice(5).trim()).join('\n');if(!raw)continue;const value=JSON.parse(raw);
     if(name==='delta'){received+=value.text;setMessages([...previous,{role:'assistant',content:received}]);}
     if(name==='done'){finished=true;setMessages([...previous,{role:'assistant',content:value.text}]);setCharge(value.charge_irt);}
     if(name==='error')throw new Error('Unconfirmed request');
    }
    if(r.done)break;
   }
   if(!finished)throw new Error('Incomplete stream');
   setChats(await(await api('/api/conversations')).json());await refresh();
  }catch(e){fail(e);if(id){try{const d=await(await api('/api/conversations/'+id)).json();setPending(Boolean(d.pending));setMessages(d.messages);}catch{setPending(true);}}}
  finally{setBusy(false);}
 }
 async function logout(){try{await api('/api/logout',{method:'POST'});setSigned(false);setAccount(null);setMessages([]);setChats([]);setCsrf('');setActive('');setError('');}catch(e){fail(e);}}
 const langs=<select className="language" aria-label="Language / زبان" value={locale} onChange={e=>{
  const next=e.target.value as Locale;
  setLocale(next);
  savePreference(LANGUAGE_KEY,next);
 }}><option value="en">English</option><option value="fa">فارسی</option><option value="tr">Türkçe</option></select>;
 const brand=<div className="brand"><img src="/servernet.svg" alt=""/><div><b>ServerNet <span>Studio</span></b><small>{t.tagline}</small></div></div>;
 if(!ready)return <div className="loading"><img src="/servernet.svg" alt="ServerNet"/>{t.loading}</div>;
 if(!signed){
  const nextTheme=theme==='dark'?'light':'dark';
  return <main className="login-page">
   <nav>
    {brand}
    <div className="login-settings">
     {langs}
     <button type="button" className="theme-toggle" onClick={()=>{
      setTheme(nextTheme);
      savePreference(THEME_KEY,nextTheme);
     }}>
      {nextTheme==='light'?<Sun size={16} aria-hidden="true"/>:<Moon size={16} aria-hidden="true"/>}
      {nextTheme==='light'?t.lightMode:t.darkMode}
     </button>
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
     {error&&<div className="notice" role="alert">{error}</div>}
     <a className="primary login-button" href={"/auth/start?lang="+locale}>{t.login}<ArrowUpRight size={18}/></a>
     <a className="google-button" href={"/auth/start?method=google&lang="+locale}>{t.google}</a>
     <a className="register" href={"/auth/start?method=register&lang="+locale}>{t.register}</a>
    </section>
   </div>
   <footer><span>ServerNet Studio</span><a href="/legal">{t.legal}</a></footer>
  </main>;
 }
 return <div className="workspace"><aside className={mobile?'sidebar open':'sidebar'}>{brand}<button className="mobile-close" onClick={()=>setMobile(false)} aria-label={t.close}><X/></button><button className="new-chat" onClick={fresh} disabled={busy}><Plus size={18}/>{t.new}</button><div className="nav-label">{t.chats}</div><div className="chat-list">{chats.length===0?<p className="empty-list">{t.empty}</p>:chats.map(c=><button key={c.id} className={c.id===active?'chat active':'chat'} onClick={()=>open(c)} disabled={busy}><MessageSquare size={15}/><span>{c.title==='New conversation'?t.new:c.title}</span></button>)}</div><div className="wallet-card"><div className="wallet-label"><Wallet size={16}/>{t.wallet}<button onClick={refresh} aria-label={t.retryAccount}><RefreshCw size={13}/></button></div><small>{t.available}</small><strong>{fmt(account?.wallet.available??0)} <span>{t.toman}</span></strong>{Boolean(account?.wallet.reserved)&&<small>{t.held}: {fmt(account!.wallet.reserved)} {t.toman}</small>}<a href={consolePath('account/topup')} target="_blank" rel="noopener noreferrer">{t.topup}<Plus size={15}/></a></div><a className="console-link" href={consolePath('account/ai')} target="_blank" rel="noopener noreferrer">{t.console}<ArrowUpRight size={16}/></a><div className="profile"><div className="avatar">{account?.customer.name.charAt(0)}</div><span>{account?.customer.name}</span><button onClick={logout} disabled={busy} aria-label={t.logout}><LogOut size={17}/></button></div><a className="legal-link" href="/legal">{t.legal}</a></aside>{mobile&&<button className="backdrop" aria-label={t.close} onClick={()=>setMobile(false)}/>}
 <main className="main-panel"><header><div className="model-selector"><button className="hamburger" onClick={()=>setMobile(true)} aria-label={t.menu}><Menu/></button><span className="model-dot"/><select aria-label={t.model} value={model} onChange={e=>setModel(e.target.value)} disabled={busy}>{models.length?models.map(m=><option key={m}>{m}</option>):<option>{t.noModels}</option>}</select></div><div className="header-right">{langs}<span className="usage"><span>{t.usage}</span><b>{fmt((account?.ai.prompt_tokens_month??0)+(account?.ai.completion_tokens_month??0))} {t.token}</b></span></div></header>
 <div className="conversation-body">{messages.length===0?<div className="welcome"><div className="eyebrow"><span/> SERVERNET INTELLIGENCE</div><h1>{t.title}</h1><p>{t.subtitle}</p><div className="suggestions">{[MessageSquare,Code2,Lightbulb].map((Icon,i)=><button key={i} onClick={()=>{setText(t.prompts[i]);input.current?.focus();}} disabled={!model}><Icon size={20}/><span>{t.ideas[i]}</span><ArrowUpRight size={15}/></button>)}</div><div className="welcome-note"><ShieldCheck size={15}/>{t.foot}</div></div>:<div className="messages">{messages.map((m,i)=><article key={i} className={'message '+m.role}><div className="message-avatar">{m.role==='assistant'?<img src="/servernet.svg" alt=""/>:account?.customer.name.charAt(0)}</div><div><b>{m.role==='assistant'?t.assistant:t.you}</b><div className="message-content" dir="auto">{m.content||t.writing}</div></div></article>)}<div ref={bottom}/></div>}</div>
 <div className="composer-area">{(error||pending)&&<div className="notice" role="alert">{pending?t.unknown:error} <a href={consolePath('account/ai')} target="_blank" rel="noopener noreferrer">{t.console} ↗</a></div>}{!model&&<div className="notice">{t.noModels}</div>}{charge!==null&&<div className="charge">{t.charged}: {fmt(charge)} {t.toman}</div>}<form className="composer" onSubmit={e=>{e.preventDefault();void send();}}><textarea ref={input} value={text} onChange={e=>setText(e.target.value)} placeholder={t.placeholder} maxLength={8000} rows={2} disabled={busy||pending||!model} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}}}/><div className="composer-bottom"><span>ServerNet AI Gateway</span><button type="submit" className="send" aria-label={t.send} disabled={busy||pending||!model||!text.trim()}><ArrowUp size={20}/></button></div></form><p className="composer-foot">{t.foot}</p></div>
 </main></div>;
}
createRoot(document.getElementById('root')!).render(<App/>);
