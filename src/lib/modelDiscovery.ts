import { PROVIDERS } from './providers';
import type { ModelOption, ProviderId } from './types';

interface RawModelRecord {
  id?: string;
  name?: string;
  display_name?: string;
  active?: boolean;
  context_window?: number;
  context_length?: number;
  max_completion_tokens?: number;
  max_output_tokens?: number;
  created?: number;
  created_at?: string;
  top_provider?: {
    context_length?: number;
    max_completion_tokens?: number;
  };
}

const NON_CHAT_MODEL_PATTERNS: RegExp[] = [
  /^whisper/i,
  /distil-whisper/i,
  /^tts-/i,
  /playai-tts/i,
  /orpheus/i,
  /^dall-e/i,
  /^gpt-image/i,
  /text-embedding/i,
  /embedding/i,
  /^embed-/i,
  /moderation/i,
  /llama-guard/i,
  /prompt-guard/i,
  /safeguard/i,
  /^babbage/i,
  /^davinci/i,
  /^curie/i,
  /^ada($|-)/i,
  /^sora/i,
  /transcribe/i,
  /realtime/i,
  /rerank/i,
  /flux/i,
  /stable-diffusion/i,
  /imagen/i,
  /veo/i,
];

const REASONING_MODEL_PATTERN =
  /(^|\/)(o1|o3|o4)([-.:]|$)|deepseek-r1|deepseek-reasoner|qwq|qwen3|gpt-oss|thinking|claude-(3-7|sonnet-4|opus-4)/i;

const NO_TEMPERATURE_PATTERN = /(^|\/)(o1|o3|o4)([-.:]|$)/i;

export function formatContextWindow(tokens?: number): string {
  if (!tokens || !Number.isFinite(tokens) || tokens <= 0) return '—';
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return Number.isInteger(m) ? `${m}M` : `${m.toFixed(1)}M`;
  }
  if (tokens >= 1000) {
    return `${Math.round(tokens / 1000)}K`;
  }
  return String(Math.round(tokens));
}

export function isChatCapableModelId(providerId: ProviderId, modelId: string): boolean {
  const id = modelId.trim();
  if (!id) return false;

  if (NON_CHAT_MODEL_PATTERNS.some((pattern) => pattern.test(id))) {
    return false;
  }

  // OpenAI /v1/models includes many legacy/non-chat/audio/computer-use utility IDs
  if (providerId === 'openai') {
    if (/(audio|search-preview|codex-mini-latest)/i.test(id)) return false;
    return /^(gpt-|o1|o3|o4|chatgpt-)/i.test(id);
  }

  return true;
}

function buildCuratedLookup(providerId: ProviderId): Map<string, ModelOption> {
  const provider = PROVIDERS.find((p) => p.id === providerId);
  const map = new Map<string, ModelOption>();
  if (!provider) return map;
  for (const model of provider.models) {
    if (model.id !== 'custom-model') {
      map.set(model.id, model);
    }
  }
  return map;
}

function extractRawModels(payload: unknown): RawModelRecord[] {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    return payload.filter((item): item is RawModelRecord => Boolean(item && typeof item === 'object'));
  }
  if (typeof payload === 'object') {
    const obj = payload as { data?: unknown; models?: unknown };
    if (Array.isArray(obj.data)) {
      return obj.data.filter(
        (item): item is RawModelRecord => Boolean(item && typeof item === 'object')
      );
    }
    if (Array.isArray(obj.models)) {
      return obj.models.filter(
        (item): item is RawModelRecord => Boolean(item && typeof item === 'object')
      );
    }
  }
  return [];
}

/**
 * Normalizes heterogeneous upstream `/models` responses from Groq, OpenAI,
 * Anthropic, OpenRouter, or any OpenAI-compatible Custom endpoint into clean,
 * deduplicated, chat-capable ModelOption entries.
 */
export function normalizeProviderModels(
  providerId: ProviderId,
  payload: unknown
): ModelOption[] {
  const rawList = extractRawModels(payload);
  const curatedMap = buildCuratedLookup(providerId);
  const seen = new Set<string>();
  const normalized: Array<{
    option: ModelOption;
    isCurated: boolean;
    curatedIndex: number;
    createdScore: number;
  }> = [];

  const curatedOrder = Array.from(curatedMap.keys());

  for (const raw of rawList) {
    const id = typeof raw.id === 'string' ? raw.id.trim() : '';
    if (!id || seen.has(id)) continue;
    if (raw.active === false) continue;
    if (!isChatCapableModelId(providerId, id)) continue;

    seen.add(id);
    const curated = curatedMap.get(id);

    const rawContext =
      raw.context_window ?? raw.context_length ?? raw.top_provider?.context_length;
    const rawMaxOutput =
      raw.max_completion_tokens ??
      raw.max_output_tokens ??
      raw.top_provider?.max_completion_tokens;

    const rawLabel =
      (typeof raw.display_name === 'string' && raw.display_name.trim()) ||
      (typeof raw.name === 'string' && raw.name.trim()) ||
      '';

    const option: ModelOption = {
      id,
      label: curated?.label ?? (rawLabel || id),
      contextWindow:
        rawContext && rawContext > 0
          ? formatContextWindow(rawContext)
          : curated?.contextWindow ?? '—',
      maxOutputTokens:
        rawMaxOutput && rawMaxOutput > 0
          ? Math.min(rawMaxOutput, 131072)
          : curated?.maxOutputTokens ?? 16384,
      supportsReasoning: curated?.supportsReasoning ?? REASONING_MODEL_PATTERN.test(id),
      nativeBrowserSearch:
        curated?.nativeBrowserSearch ??
        (providerId === 'groq' &&
          (id.startsWith('openai/gpt-oss') || id.startsWith('groq/compound'))),
      supportsTemperature:
        curated?.supportsTemperature ?? !NO_TEMPERATURE_PATTERN.test(id),
    };

    let createdScore = 0;
    if (typeof raw.created === 'number' && Number.isFinite(raw.created)) {
      createdScore = raw.created;
    } else if (typeof raw.created_at === 'string') {
      const parsedTs = Date.parse(raw.created_at);
      if (!Number.isNaN(parsedTs)) createdScore = Math.floor(parsedTs / 1000);
    }

    normalized.push({
      option,
      isCurated: Boolean(curated),
      curatedIndex: curated ? curatedOrder.indexOf(id) : Number.MAX_SAFE_INTEGER,
      createdScore,
    });
  }

  // Sort curated flagship models first (preserving familiar order), then newest/alphabetical
  normalized.sort((a, b) => {
    if (a.isCurated !== b.isCurated) return a.isCurated ? -1 : 1;
    if (a.isCurated && b.isCurated) return a.curatedIndex - b.curatedIndex;
    if (a.createdScore !== b.createdScore) return b.createdScore - a.createdScore;
    return a.option.id.localeCompare(b.option.id);
  });

  return normalized.map((entry) => entry.option);
}

/**
 * Filters a list of models by search query against both model ID and display label.
 */
export function filterModelsByQuery(models: ModelOption[], query: string): ModelOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return models;
  return models.filter(
    (m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)
  );
}
