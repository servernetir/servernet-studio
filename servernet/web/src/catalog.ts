// SPDX-License-Identifier: AGPL-3.0-only
const categories = ['chat', 'image', 'video', 'audio', 'music'] as const;
type ModelCategory = (typeof categories)[number];

export type Model = {
  id: string;
  category: ModelCategory;
  context_length: number | null;
  label: string;
};

const modelNames: Record<string, string> = {
  gpt: 'GPT', gemini: 'Gemini', claude: 'Claude', deepseek: 'DeepSeek',
  qwen: 'Qwen', llama: 'Llama', grok: 'Grok', kimi: 'Kimi', mistral: 'Mistral',
  gemma: 'Gemma', flux: 'FLUX', wan: 'Wan', veo: 'Veo', sora: 'Sora',
  glm: 'GLM', minimax: 'MiniMax', whisper: 'Whisper', ltx: 'LTX', tts: 'TTS',
};

export function shortModelName(id: string) {
  const name = id.split('/').at(-1) || id;
  const short = name
    .replace(/^(openai|anthropic|google|meta|x-ai|alibaba|z-ai)[-_]/i, '')
    .replace(/^(claude|gemini|qwen|wan|glm|gpt|llama|mistral|deepseek)(\d)/i, '$1-$2')
    .replace(/^(claude|gemini|qwen|wan|glm|gpt|llama|mistral|veo)([-_](?:sonnet|opus|haiku))?[-_](\d)[-_](\d)(?=$|[-_:])/i, '$1$2-$3.$4');
  return short
    .split(/[-_:]+/)
    .filter(Boolean)
    .map(part => {
      const key = part.toLowerCase();
      if (Object.hasOwn(modelNames, key)) return modelNames[key];
      if (/^\d+(?:\.\d+)?[bkmt]$/i.test(part)) return part.toUpperCase();
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join(' ') || id;
}

export function readModels(payload: {data: Array<{id: string; category?: ModelCategory; context_length?: number}>}): Model[] {
  const entries = payload.data
    .filter(entry => typeof entry.id === 'string' && entry.id && categories.includes(entry.category ?? 'chat'))
    .map(entry => ({
      id: entry.id,
      category: entry.category ?? 'chat',
      context_length: entry.context_length ?? null,
      label: shortModelName(entry.id),
    }));
  const labelCounts = new Map<string, number>();
  for (const entry of entries) labelCounts.set(entry.label, (labelCounts.get(entry.label) ?? 0) + 1);
  return entries.map(entry => {
    if (labelCounts.get(entry.label) === 1) return entry;
    const provider = entry.id.includes('/') ? entry.id.split('/').at(-2) : entry.id;
    return {...entry, label: `${entry.label} · ${provider}`};
  });
}
