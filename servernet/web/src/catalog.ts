// SPDX-License-Identifier: AGPL-3.0-only
import type {Locale} from './copy';

const categories = ['chat', 'image', 'video', 'audio', 'music', 'classification'] as const;
type Category = (typeof categories)[number];

export type Field = {
  name: string;
  required: boolean;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'array' | 'object' | 'file';
  media?: string;
  item?: Field;
  fields?: Field[];
  enum?: Array<string | number>;
  default?: unknown;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
  minimum?: number;
  maximum?: number;
  multipleOf?: number;
};

type Pricing = {unit: string; quantity: number; input_irt?: number; output_irt?: number; amount_irt?: number};
export type Model = {
  id: string;
  category: Category;
  context_length: number | null;
  label: string;
  vision?: boolean;
  free?: boolean;
  pricing?: Pricing | null;
  studio?: {native_access: boolean; fields: Field[] | null} | null;
  endpoint?: string;
};

const names: Record<string, string> = {
  gpt: 'GPT', gemini: 'Gemini', claude: 'Claude', deepseek: 'DeepSeek', qwen: 'Qwen',
  llama: 'Llama', grok: 'Grok', kimi: 'Kimi', mistral: 'Mistral', gemma: 'Gemma',
  flux: 'FLUX', wan: 'Wan', veo: 'Veo', sora: 'Sora', glm: 'GLM', minimax: 'MiniMax',
  whisper: 'Whisper', ltx: 'LTX', tts: 'TTS',
};

export function shortModelName(id: string, canonicalName?: string) {
  const name = (canonicalName?.trim() || id).split('/').filter(Boolean).at(-1) || id;
  const source = name
    .replace(/^[\s]*(?:openai|google|meta|x-ai|alibaba|z-ai|anthropic|antrohpic)[-_\s]+/i, '')
    .replace(/(?:[-_:\s]+[a-f0-9]{9,16}|[-_\s]+(?=[a-z0-9]{8,16}$)(?=[a-z0-9]*\d{2})(?=[a-z0-9]*[a-z])[\da-f][a-z0-9]+)$/i, '')
    .replace(/^(claude|gemini|qwen|wan|glm|gpt|llama|mistral|deepseek)(\d)/i, '$1-$2')
    .replace(/^(claude|gemini|qwen|wan|glm|gpt|llama|mistral|veo|opus|sonnet|haiku)([-_\s]+(?:sonnet|opus|haiku))?[-_\s]+(\d)[-_\s]+(\d)(?=$|[-_:\s])/i, '$1$2-$3.$4');
  let words = source.split(/[-_:\s]+/).filter(Boolean);
  if (words.some(word => /^(opus|sonnet|haiku)$/i.test(word))) {
    words = words.filter(word => !/^(claude|cloude|cloud|anthropic|antrohpic)$/i.test(word));
  }
  return words.filter((word, index) => index === 0 || word.toLowerCase() !== words[index - 1].toLowerCase())
    .map(word => {
      const key = word.toLowerCase();
      if (Object.hasOwn(names, key)) return names[key];
      if (/^\d+(?:\.\d+)?[bkmt]$/i.test(word)) return word.toUpperCase();
      return word.charAt(0).toUpperCase() + word.slice(1);
    }).join(' ') || id;
}

export function readModels(payload: {data: Array<Partial<Model> & {name?: string}>}): Model[] {
  return payload.data
    .filter(entry => typeof entry.id === 'string' && entry.id && categories.includes(entry.category ?? 'chat'))
    .map(entry => ({
      ...entry,
      id: entry.id!,
      category: entry.category ?? 'chat',
      context_length: entry.context_length ?? null,
      label: shortModelName(entry.id!, entry.name),
    }));
}

export function supportsStudio(model: Model) {
  return model.category === 'chat' || Boolean(model.studio?.fields?.length);
}

export function priceText(irt: number, locale: Locale, rate: number | null, available = false) {
  if (locale === 'fa') return new Intl.NumberFormat('fa-IR').format(irt) + ' تومان';
  if (irt !== 0 && (!rate || rate < 1)) return null;
  const eur = rate ? (available ? Math.floor : Math.ceil)((irt * 10000) / rate) / 10000 : 0;
  return new Intl.NumberFormat(locale === 'tr' ? 'tr-TR' : 'en-IE', {
    style: 'currency', currency: 'EUR', maximumFractionDigits: 4,
  }).format(eur);
}

export function pricingUnit(unit: string, quantity: number, locale: Locale) {
  const labels = {
    en: ['request','image','output seconds','input seconds','characters','tokens','frames','first megapixel','units'],
    fa: ['درخواست','تصویر','ثانیهٔ خروجی','ثانیهٔ ورودی','کاراکتر','توکن','فریم','مگاپیکسل اول','واحد'],
    tr: ['istek','görsel','çıktı saniyesi','girdi saniyesi','karakter','token','kare','ilk megapiksel','birim'],
  }[locale];
  const code = ['call','image_units','output_length','input_length','input_character_length','input_tokens','frame_units','first_megapixel']
    .indexOf(unit === 'video_tokens' ? 'input_tokens' : unit);
  return new Intl.NumberFormat(locale).format(quantity) + ' ' + labels[code<0?8:code];
}
