// SPDX-License-Identifier: AGPL-3.0-only
import {useState} from 'react';
import {ArrowUpRight, Download, ImagePlus, RefreshCw, X} from 'lucide-react';
import type {Field, Model} from './catalog';
import {copy, type Locale} from './copy';
import {inferenceCopy} from './inference-copy';

export type Asset = {kind: 'image' | 'video' | 'audio' | 'link'; url: string; download?: string};
export type MediaJob = {
  id: string; state: 'sending' | 'processing' | 'ready' | 'failed' | 'unknown';
  assets?: Asset[]; text?: string; code?: string | null; charge_irt?: number | null; expired_at?: number;
};
export type Parameters = Record<string, unknown>;

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export async function normalizeImage(file: Blob) {
  if (!/^(image\/(?:jpeg|png|webp))$/.test(file.type) || file.size > 20_000_000) throw Error('Unsupported image.');
  const image = await createImageBitmap(file);
  try {
    const ratio = Math.min(1, 1024 / Math.max(image.width, image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * ratio));
    canvas.height = Math.max(1, Math.round(image.height * ratio));
    const context = canvas.getContext('2d');
    if (!context) throw Error('Image conversion unavailable.');
    context.fillStyle = '#fff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', .9);
  } finally { image.close(); }
}

function acceptFiles(media?: string) {
  if (media === 'audio') return 'audio/wav,audio/x-wav,.wav';
  if (media === 'video') return 'video/mp4,.mp4';
  const images = 'image/png,image/jpeg,image/webp';
  return media === 'reference' ? images + ',video/mp4' : images;
}

function valueIsSet(value: unknown) {
  return value !== undefined && value !== null && (typeof value !== 'string' || Boolean(value.trim()));
}

function validField(field: Field, value: unknown): boolean {
  if (!valueIsSet(value)) return !field.required;
  if (field.type === 'array') return Array.isArray(value) && value.length >= (field.minItems ?? (field.required ? 1 : 0))
    && value.length <= (field.maxItems ?? 8) && value.every(item => field.item && validField(field.item, item));
  if (field.type === 'object') return typeof value === 'object' && field.fields?.every(child =>
    validField(child, (value as Parameters)[child.name])) !== false;
  return true;
}

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => valueIsSet(entry)).map(([key, entry]) => [key, clean(entry)]));
  return value;
}

function labelFor(field: Field, locale: Locale) {
  const labels = {
    en: {prompt:'Prompt', text:'Text', input:'Input text', negative_prompt:'Negative prompt', image:'Image', images:'Images', image_urls:'Images',
      video:'Video', audio:'Audio', first_frame_image:'First frame', last_frame_image:'Last frame', duration:'Duration (seconds)',
      resolution:'Resolution', aspect_ratio:'Aspect ratio', size:'Size', voice:'Voice', language:'Language', media:'Media references', item:'Item'},
    fa: {prompt:'شرح درخواست', text:'متن', input:'متن ورودی', negative_prompt:'مواردی که نباید در خروجی باشند', image:'تصویر', images:'تصاویر',
      image_urls:'تصاویر', video:'ویدئو', audio:'صدا', first_frame_image:'فریم اول', last_frame_image:'فریم آخر', duration:'مدت (ثانیه)',
      resolution:'وضوح', aspect_ratio:'نسبت تصویر', size:'اندازه', voice:'صدا', language:'زبان', media:'رسانه‌های مرجع', item:'مورد'},
    tr: {prompt:'İstem', text:'Metin', input:'Girdi metni', negative_prompt:'Olumsuz istem', image:'Görsel', images:'Görseller',
      image_urls:'Görseller', video:'Video', audio:'Ses', first_frame_image:'İlk kare', last_frame_image:'Son kare', duration:'Süre (saniye)',
      resolution:'Çözünürlük', aspect_ratio:'En-boy oranı', size:'Boyut', voice:'Ses', language:'Dil', media:'Medya referansları', item:'Öğe'},
  }[locale] as Record<string, string>;
  const generic = field.name.replaceAll('_', ' ');
  return labels[field.name] || generic.charAt(0).toUpperCase() + generic.slice(1);
}

function NativeField({field, value, set, locale}: {field: Field; value: unknown; set: (value: unknown)=>void; locale: Locale}) {
  const f = inferenceCopy[locale];
  const [problem,setProblem]=useState(false);
  const label = labelFor(field,locale);
  const current = value ?? field.default;
  if (field.type === 'array' && field.item) {
    const entries = Array.isArray(value) ? value : [];
    const descriptor = field.item;
    return <fieldset className="native-field"><legend>{label}{field.required ? ' *' : ''}</legend>
      {entries.map((entry,index)=><div key={index} className="native-array-row">
        <NativeField field={descriptor} value={entry} set={next=>set(entries.map((item,i)=>i===index?next:item))} locale={locale}/>
        <button type="button" className="icon-button" aria-label={f.remove} onClick={()=>set(entries.filter((_,i)=>i!==index))}><X size={16}/></button>
      </div>)}
      <button type="button" className="secondary-button" disabled={entries.length >= (field.maxItems ?? 8)} onClick={()=>set([...entries,null])}>{f.add}</button>
    </fieldset>;
  }
  if (field.type === 'object') {
    const values = value && typeof value === 'object' ? value as Parameters : {};
    return <fieldset className="native-field"><legend>{label}{field.required ? ' *' : ''}</legend>
      {field.fields?.map(child=><NativeField key={child.name} locale={locale} field={child}
        value={values[child.name]} set={next=>set({...values,[child.name]:next})}/>)}
    </fieldset>;
  }
  if (field.type === 'file') return <label className="native-field">
    <span>{label}{field.required?' *':''}{current ? ' ✓' : ''}</span>
    <input type="file" accept={acceptFiles(field.media)} onChange={async event=>{
      const file=event.target.files?.[0];
      if (!file) return;
      setProblem(false);
      try {
        if (file.size>4_800_000) throw Error('Attachment too large.');
        const data=await readFile(file);
        const wavType=data.replace(/^data:audio\/(?:x-wav|wave);/, 'data:audio/wav;');
        if (!/^data:(image\/(?:png|jpeg|webp)|audio\/wav|video\/mp4);base64,/.test(wavType)) throw Error('Unsupported attachment.');
        set(wavType);
      } catch {setProblem(true);}
    }}/>
    {problem && <small role="alert">{f.imageError}</small>}
  </label>;
  if (field.enum?.length) return <label className="native-field"><span>{label}{field.required?' *':''}</span>
    <select value={String(current ?? '')} onChange={event=>set(field.enum?.find(item=>String(item)===event.target.value))}>
      <option value="">—</option>
      {field.enum.map(option=><option key={option} value={String(option)}>{option}</option>)}
    </select></label>;
  if (field.type==='boolean') return <label className="native-field native-check">
    <input type="checkbox" checked={Boolean(current)} onChange={event=>set(event.target.checked)}/>{label}</label>;
  if (field.type==='integer'||field.type==='number') return <label className="native-field"><span>{label}{field.required?' *':''}</span>
    <input type="number" min={field.minimum} max={field.maximum} step={field.multipleOf??(field.type==='integer'?1:'any')}
      value={typeof current==='number'?current:''} onChange={event=>set(event.target.value===''?undefined:event.target.valueAsNumber)}/>
  </label>;
  return <label className="native-field"><span>{label}{field.required?' *':''}</span>
    <input value={typeof current==='string'?current:''} maxLength={Math.min(8000,field.maxLength??8000)}
      onChange={event=>set(event.target.value)}/></label>;
}

export function MediaComposer({model, locale, text, setText, amount, quote, generate, isSending}: {
  model: Model; locale: Locale; text: string; setText: (value: string)=>void; amount: (value:number)=>string|null;
  quote: (values: Parameters)=>Promise<number>; generate: (values: Parameters, label:string, maximum:number)=>Promise<void>;
  isSending: boolean;
}) {
  const f=inferenceCopy[locale];
  const [values,setValues]=useState<Parameters>({});
  const [proposal,setProposal]=useState<{signature:string;amount:number}|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const fields=model.studio?.fields ?? [];
  const textField=['prompt','text','input'].map(name=>fields.find(field=>field.name===name && field.type==='string' && !field.enum)).find(Boolean);
  const remaining=fields.filter(field=>field!==textField);
  const parameters=clean({...values,...(textField&&text.trim()?{[textField.name]:text.trim()}: {})}) as Parameters;
  const signature=JSON.stringify(parameters);
  const price=proposal?.signature===signature?proposal.amount:null;
  const display=price===null?null:amount(price);
  if (!fields.length) return <div className="notice">{f.nothing}</div>;
  if (model.studio?.native_access===false) return <div className="notice">{f.renew}</div>;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy||isSending) return;
    setError('');
    if (!fields.every(field=>validField(field,parameters[field.name]??field.default))) {setError(f.missing);return;}
    if (new TextEncoder().encode(signature).length > 7_400_000) {setError(f.requestError);return;}
    setBusy(true);
    try {
      if (price===null) setProposal({signature,amount:await quote(parameters)});
      else if (display) {
        await generate(parameters,text.trim()||model.label,price);
        setProposal(null);
        setValues({});
      }
    } catch {setError(f.requestError);}
    finally {setBusy(false);}
  }
  return <form className="composer native-composer" onSubmit={submit} aria-busy={busy||isSending}>
    <fieldset disabled={busy||isSending}>
      {textField && <textarea aria-label={f.prompt} value={text} onChange={event=>setText(event.target.value)}
        placeholder={f.prompt} maxLength={Math.min(8000,textField.maxLength??8000)} rows={2}/>}
      {remaining.length>0 && <details className="native-options" open={remaining.some(field=>field.required)||!textField||undefined}>
        <summary>{f.options}</summary>
        <div className="native-grid">{remaining.map(field=><NativeField key={field.name} field={field} value={values[field.name]}
          locale={locale} set={next=>setValues(previous=>({...previous,[field.name]:next}))}/>)}</div>
      </details>}
      {error&&<div className="notice" role="alert">{error}</div>}
      <div className="native-actions">
        {price!==null&&<span role="status">{f.quoteLimit} · {display??f.unavailable}</span>}
        <button type="submit" className="secondary-button native-submit" disabled={busy||isSending||(price!==null&&!display)}>
          {busy ? (price===null?f.quote:f.generating) : price===null?f.quote:f.approve}
        </button>
      </div>
    </fieldset>
  </form>;
}

export function Thinking({locale}: {locale:Locale}) {
  return <div className="studio-thinking" role="status">
    <span className="studio-orb" aria-hidden="true"/><span>{inferenceCopy[locale].thinking}</span>
  </div>;
}

export function MediaResult({job,locale,amount,refresh}: {
  job:MediaJob;locale:Locale;amount:(value:number)=>string|null;refresh:()=>void;
}) {
  const f=inferenceCopy[locale];
  if (job.state==='sending'||job.state==='processing'||job.state==='unknown') return <div className="media-receipt" role="status">
    <p>{job.state==='unknown'?f.unknown:f.pending}</p>
    <button type="button" className="secondary-button" onClick={refresh}><RefreshCw size={14}/>{f.refresh}</button>
  </div>;
  if (job.state==='failed') return <div className="media-receipt" role="status">
    {job.code==='insufficient_funds'?f.noFunds:job.code==='quote_changed'?f.priceChanged:job.code==='insufficient_scope'?f.renew:f.failed}
  </div>;
  const expired=job.expired_at!==undefined&&job.expired_at*1000<Date.now();
  return <div className="media-receipt">
    {job.text && <div className="message-content" dir="auto">{job.text}</div>}
    {!job.text&&!job.assets?.length&&<p>{f.nothing}</p>}
    {job.assets?.map((asset,index)=><div className="media-asset" key={asset.url+index}>
      {expired&&asset.download ? <p>{f.expired}</p> : <>
        {asset.kind==='image' && <img src={asset.url} alt={f.output} loading="lazy"/>}
        {asset.kind==='video' && <video src={asset.url} controls playsInline preload="metadata" aria-label={f.output}/>}
        {asset.kind==='audio' && <audio src={asset.url} controls preload="metadata" aria-label={f.output}/>}
        {asset.download ? <a className="secondary-button" href={asset.download} download><Download size={15}/>{f.save}</a> :
          <a className="secondary-button" href={asset.url} target="_blank" rel="noopener noreferrer">{f.openResult}<ArrowUpRight size={15}/></a>}
      </>}
    </div>)}
    {typeof job.charge_irt==='number'&&<small>{copy[locale].charged} · {amount(job.charge_irt)??f.unavailable}</small>}
  </div>;
}

export function ImageAttachment({locale,source,remove,attach}: {
  locale:Locale;source:string|null;remove:()=>void;attach:(file:File)=>void;
}) {
  const f=inferenceCopy[locale];
  return source ? <div className="image-attachment"><img src={source} alt={f.draftImage}/><span>{f.draftImage}</span>
    <button type="button" className="icon-button" onClick={remove} aria-label={f.remove}><X size={16}/></button></div> :
    <label className="secondary-button attachment-button"><ImagePlus size={17}/>{f.vision}
      <input type="file" accept={acceptFiles()} onChange={event=>{ const file=event.target.files?.[0];if(file)attach(file); }}/></label>;
}
