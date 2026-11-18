// SPDX-License-Identifier: AGPL-3.0-only
import {useId, useRef, useState} from 'react';
import {ArrowUpRight, ChevronDown, Download, ImagePlus, Paperclip, RefreshCw, SlidersHorizontal, X} from 'lucide-react';
import type {Field, Model} from './catalog';
import {copy, type Locale} from './copy';
import {enumLabel, fieldHint, fieldLabel, inferenceCopy} from './inference-copy';

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
  if (field.type === 'number' || field.type === 'integer') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (field.type === 'integer' && !Number.isInteger(value)) return false;
    if (field.minimum !== undefined && value < field.minimum) return false;
    if (field.maximum !== undefined && value > field.maximum) return false;
    if (field.multipleOf) {
      const scale = value / field.multipleOf;
      if (Math.abs(scale - Math.round(scale)) > 1e-8) return false;
    }
  }
  if (field.type === 'string' && typeof value === 'string') {
    const length = Array.from(value).length;
    return length >= (field.minLength ?? 0) && length <= (field.maxLength ?? 8000);
  }
  return true;
}

function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([, entry]) => valueIsSet(entry)).map(([key, entry]) => [key, clean(entry)]));
  return value;
}

function NativeField({field, value, set, locale}: {field: Field; value: unknown; set: (value: unknown)=>void; locale: Locale}) {
  const f = inferenceCopy[locale];
  const [problem, setProblem] = useState(false);
  const [filename, setFilename] = useState('');
  const hintId = useId();
  const label = fieldLabel(field, locale) + (field.required ? ' *' : '');
  const description = fieldHint(field, locale);
  const hint = description && <small className="native-hint" id={hintId}>{description}</small>;
  const accessibility = {'aria-describedby': description ? hintId : undefined, 'aria-required': field.required};
  const current = value ?? field.default;
  if (field.type === 'array' && field.item) {
    const entries = Array.isArray(value) ? value : [];
    const descriptor = field.item;
    return <fieldset className="native-field"><legend>{label}</legend>
      {entries.map((entry,index)=><div key={index} className="native-array-row">
        <NativeField field={descriptor} value={entry} set={next=>set(entries.map((item,i)=>i===index?next:item))} locale={locale}/>
        <button type="button" className="icon-button" aria-label={f.remove} onClick={()=>set(entries.filter((_,i)=>i!==index))}><X size={16}/></button>
      </div>)}
      <button type="button" className="secondary-button" disabled={entries.length >= (field.maxItems ?? 8)} onClick={()=>set([...entries,null])}>{f.add}</button>
    </fieldset>;
  }
  if (field.type === 'object') {
    const values = value && typeof value === 'object' ? value as Parameters : {};
    return <fieldset className="native-field"><legend>{label}</legend>
      {field.fields?.map(child=><NativeField key={child.name} locale={locale} field={child}
        value={values[child.name]} set={next=>set({...values,[child.name]:next})}/>)}
    </fieldset>;
  }
  if (field.type === 'file') return <label className="native-field">
    <span>{label}</span>
    <span className="native-file">
      <Paperclip size={15} aria-hidden="true"/>
      <span dir="auto">{current ? filename || f.fileReady : f.chooseFile}</span>
      <input type="file" accept={acceptFiles(field.media)} aria-label={label} {...accessibility} onChange={async event=>{
        const file = event.currentTarget.files?.[0];
        event.currentTarget.value = '';
        if (!file) return;
        setProblem(false);
        try {
          if (file.size > 4_800_000) throw Error('Attachment too large.');
          const data = await readFile(file);
          const wavType = data.replace(/^data:audio\/(?:x-wav|wave);/, 'data:audio/wav;');
          if (!/^data:(image\/(?:png|jpeg|webp)|audio\/wav|video\/mp4);base64,/.test(wavType)) throw Error('Unsupported attachment.');
          set(wavType);
          setFilename(file.name);
        } catch { setProblem(true); }
      }}/>
    </span>
    {hint}
    {problem && <small className="native-file-error" role="alert">{f.fileError}</small>}
  </label>;
  if (field.enum?.length) return <label className="native-field"><span>{label}</span>
    <select value={String(current ?? '')} {...accessibility} onChange={event=>set(field.enum?.find(item=>String(item)===event.target.value))}>
      <option value="">—</option>
      {field.enum.map(option=><option key={option} value={String(option)}>{enumLabel(field, option, locale)}</option>)}
    </select>
    {hint}
  </label>;
  if (field.type==='boolean') return <label className="native-field native-check">
    <input type="checkbox" checked={Boolean(current)} {...accessibility} onChange={event=>set(event.target.checked)}/>
    <span>{label}{hint}</span>
  </label>;
  if (field.type==='integer'||field.type==='number') return <label className="native-field"><span>{label}</span>
    <input type="number" min={field.minimum} max={field.maximum} step={field.multipleOf??(field.type==='integer'?1:'any')}
      value={typeof current==='number'?current:''} {...accessibility}
      onChange={event=>set(event.target.value===''?undefined:event.target.valueAsNumber)}/>
    {hint}
  </label>;
  return <label className="native-field"><span>{label}</span>
    <input value={typeof current==='string'?current:''} maxLength={Math.min(8000,field.maxLength??8000)}
      dir="auto" {...accessibility} onChange={event=>set(event.target.value)}/>
    {hint}
  </label>;
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
  const [optionsOpen, setOptionsOpen] = useState(() => !textField || remaining.some(field => field.required));
  const optionsId = useId();
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
    const invalid = fields.find(field => !validField(field, parameters[field.name] ?? field.default));
    if (invalid) {
      if (invalid !== textField) setOptionsOpen(true);
      setError(valueIsSet(parameters[invalid.name]) ? f.requestError : f.missing);
      return;
    }
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
  return <form className="composer native-composer" noValidate onSubmit={submit} aria-busy={busy||isSending}>
    <fieldset disabled={busy||isSending}>
      {textField && <textarea aria-label={f.prompt} aria-required={textField.required} value={text} onChange={event=>setText(event.target.value)}
        placeholder={f.prompt} maxLength={Math.min(8000,textField.maxLength??8000)} rows={2}/>}
      <div className="native-toolbar">
        {remaining.length > 0 && <button type="button" className="native-toggle" aria-expanded={optionsOpen}
          aria-controls={optionsId} onClick={() => setOptionsOpen(open => !open)}>
          <SlidersHorizontal size={16} aria-hidden="true"/>{f.options}<ChevronDown size={14} aria-hidden="true"/>
        </button>}
        <div className="native-actions">
          {price!==null&&<span role="status">{f.quoteLimit} · {display??f.unavailable}</span>}
          <button type="submit" className="secondary-button native-submit" disabled={busy||isSending||(price!==null&&!display)}>
            {busy ? (price===null?f.quote:f.generating) : price===null?f.quote:f.approve}
          </button>
        </div>
      </div>
      {remaining.length > 0 && <div id={optionsId} className="native-options" data-open={optionsOpen || undefined}
        inert={!optionsOpen} aria-hidden={!optionsOpen}>
        <div className="native-options-clip">
          <div className="native-grid">{remaining.map(field=><NativeField key={field.name} field={field} value={values[field.name]}
            locale={locale} set={next=>setValues(previous=>({...previous,[field.name]:next}))}/>)}</div>
        </div>
      </div>}
      {error&&<div className="notice native-error" role="alert">{error}</div>}
    </fieldset>
  </form>;
}

export function Thinking({text}: {text: string}) {
  return <div className="studio-thinking" role="status">
    <span className="studio-orb" aria-hidden="true"/><span>{text}</span>
  </div>;
}

export function MediaResult({job,locale,amount,refresh}: {
  job:MediaJob;locale:Locale;amount:(value:number)=>string|null;refresh:()=>void;
}) {
  const f=inferenceCopy[locale];
  if (job.state==='sending'||job.state==='processing'||job.state==='unknown') return <div className="media-receipt media-working">
    <Thinking text={job.state==='unknown' ? f.unknown : f.generating}/>
    {job.state!=='sending'&&<button type="button" className="secondary-button" onClick={refresh}><RefreshCw size={14}/>{f.refresh}</button>}
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

export function ImageAttachment({locale, disabled, attach}: {
  locale: Locale; disabled: boolean; attach: (file: File)=>void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const label = inferenceCopy[locale].vision;
  return <>
    <input ref={input} hidden type="file" accept={acceptFiles()} disabled={disabled} onChange={event => {
      const file = event.currentTarget.files?.[0];
      event.currentTarget.value = '';
      if (file) attach(file);
    }}/>
    <button type="button" className="icon-button attachment-button" disabled={disabled} onClick={() => input.current?.click()}
      aria-label={label} title={label}><ImagePlus size={18} aria-hidden="true"/></button>
  </>;
}

export function ImageAttachmentPreview({locale, source, remove}: {locale: Locale; source: string; remove: ()=>void}) {
  const f = inferenceCopy[locale];
  return <div className="image-attachment"><img src={source} alt=""/><span>{f.draftImage}</span>
    <button type="button" className="icon-button" onClick={remove} aria-label={f.remove}><X size={16}/></button>
  </div>;
}
