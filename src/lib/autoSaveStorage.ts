import { DEFAULT_PLAYGROUND_PARAMS, PROVIDERS, getDefaultModelForProvider } from './providers';
import type { StorageLike } from './keyStorage';
import type {
  AutoSavedChatState,
  ChatMessage,
  PlaygroundParams,
  ProviderId,
} from './types';

export const AUTOSAVE_STORAGE_KEY = 'kool_playground_autosave_v1';
export const AUTOSAVE_INTERVAL_MS = 5000;
export const AUTOSAVE_DEBOUNCE_MS = 800;
const MAX_AUTOSAVED_MESSAGES = 120;

const VALID_PROVIDER_IDS = new Set<ProviderId>(PROVIDERS.map((p) => p.id));

export type AutoSaveSnapshotInput = Omit<AutoSavedChatState, 'version' | 'savedAt'>;

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isDefaultParams(params: PlaygroundParams): boolean {
  return (
    params.temperature === DEFAULT_PLAYGROUND_PARAMS.temperature &&
    params.maxTokens === DEFAULT_PLAYGROUND_PARAMS.maxTokens &&
    params.topP === DEFAULT_PLAYGROUND_PARAMS.topP &&
    params.frequencyPenalty === DEFAULT_PLAYGROUND_PARAMS.frequencyPenalty &&
    params.presencePenalty === DEFAULT_PLAYGROUND_PARAMS.presencePenalty &&
    params.seed === DEFAULT_PLAYGROUND_PARAMS.seed &&
    params.stopSequences.length === DEFAULT_PLAYGROUND_PARAMS.stopSequences.length &&
    params.stream === DEFAULT_PLAYGROUND_PARAMS.stream &&
    params.jsonMode === DEFAULT_PLAYGROUND_PARAMS.jsonMode &&
    params.browserSearch === DEFAULT_PLAYGROUND_PARAMS.browserSearch &&
    params.reasoningEffort === DEFAULT_PLAYGROUND_PARAMS.reasoningEffort
  );
}

/**
 * Returns true if the current workspace contains any conversation history,
 * draft input, system prompt, linked session, custom model override, or
 * non-default parameter tweaks worth preserving across page reloads.
 */
export function hasMeaningfulChatState(state: AutoSaveSnapshotInput): boolean {
  if (state.messages.length > 0) return true;
  if (state.composerText.trim().length > 0) return true;
  if (state.systemPrompt.trim().length > 0) return true;
  if (state.activeSessionId !== null) return true;
  if (state.customModelId.trim().length > 0) return true;
  if (!isDefaultParams(state.params)) return true;
  return false;
}

/**
 * Produces a deterministic fingerprint (excluding timestamps) so periodic
 * auto-save ticks skip redundant localStorage writes when nothing changed.
 */
export function createAutoSaveFingerprint(state: AutoSaveSnapshotInput): string {
  return JSON.stringify({
    provider: state.provider,
    model: state.model,
    customBaseUrl: state.customBaseUrl,
    customModelId: state.customModelId,
    systemPrompt: state.systemPrompt,
    composerText: state.composerText,
    params: state.params,
    activeSessionId: state.activeSessionId,
    messages: state.messages,
  });
}

function sanitizeParams(raw: unknown): PlaygroundParams {
  if (!raw || typeof raw !== 'object') {
    return { ...DEFAULT_PLAYGROUND_PARAMS, stopSequences: [] };
  }
  const obj = raw as Partial<PlaygroundParams>;
  const reasoningEffort =
    obj.reasoningEffort === 'default' ||
    obj.reasoningEffort === 'low' ||
    obj.reasoningEffort === 'medium' ||
    obj.reasoningEffort === 'high'
      ? obj.reasoningEffort
      : DEFAULT_PLAYGROUND_PARAMS.reasoningEffort;

  return {
    temperature:
      typeof obj.temperature === 'number' && Number.isFinite(obj.temperature)
        ? obj.temperature
        : DEFAULT_PLAYGROUND_PARAMS.temperature,
    maxTokens:
      typeof obj.maxTokens === 'number' && Number.isFinite(obj.maxTokens) && obj.maxTokens > 0
        ? obj.maxTokens
        : DEFAULT_PLAYGROUND_PARAMS.maxTokens,
    topP:
      typeof obj.topP === 'number' && Number.isFinite(obj.topP)
        ? obj.topP
        : DEFAULT_PLAYGROUND_PARAMS.topP,
    frequencyPenalty:
      typeof obj.frequencyPenalty === 'number' && Number.isFinite(obj.frequencyPenalty)
        ? obj.frequencyPenalty
        : DEFAULT_PLAYGROUND_PARAMS.frequencyPenalty,
    presencePenalty:
      typeof obj.presencePenalty === 'number' && Number.isFinite(obj.presencePenalty)
        ? obj.presencePenalty
        : DEFAULT_PLAYGROUND_PARAMS.presencePenalty,
    seed: typeof obj.seed === 'string' ? obj.seed : DEFAULT_PLAYGROUND_PARAMS.seed,
    stopSequences: Array.isArray(obj.stopSequences)
      ? obj.stopSequences.filter((s): s is string => typeof s === 'string').slice(0, 4)
      : [],
    stream: typeof obj.stream === 'boolean' ? obj.stream : DEFAULT_PLAYGROUND_PARAMS.stream,
    jsonMode: typeof obj.jsonMode === 'boolean' ? obj.jsonMode : DEFAULT_PLAYGROUND_PARAMS.jsonMode,
    browserSearch:
      typeof obj.browserSearch === 'boolean'
        ? obj.browserSearch
        : DEFAULT_PLAYGROUND_PARAMS.browserSearch,
    reasoningEffort,
  };
}

function sanitizeMessages(raw: unknown): ChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const valid: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const msg = item as Partial<ChatMessage>;
    if (typeof msg.id !== 'string' || !msg.id) continue;
    if (msg.role !== 'user' && msg.role !== 'assistant') continue;
    if (typeof msg.content !== 'string') continue;

    valid.push({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      thinking: typeof msg.thinking === 'string' ? msg.thinking : undefined,
      citations: Array.isArray(msg.citations) ? msg.citations : undefined,
      metrics: msg.metrics && typeof msg.metrics === 'object' ? msg.metrics : undefined,
      paramsSnapshot:
        msg.paramsSnapshot && typeof msg.paramsSnapshot === 'object'
          ? msg.paramsSnapshot
          : undefined,
      modelUsed: typeof msg.modelUsed === 'string' ? msg.modelUsed : undefined,
      providerUsed:
        typeof msg.providerUsed === 'string' && VALID_PROVIDER_IDS.has(msg.providerUsed as ProviderId)
          ? (msg.providerUsed as ProviderId)
          : undefined,
      error: typeof msg.error === 'string' ? msg.error : undefined,
      createdAt:
        typeof msg.createdAt === 'number' && Number.isFinite(msg.createdAt)
          ? msg.createdAt
          : Date.now(),
    });
  }
  return valid.slice(-MAX_AUTOSAVED_MESSAGES);
}

/**
 * Validates and normalizes a raw parsed localStorage payload. Never allows
 * API keys or malformed values to leak into restored workspace state.
 */
export function sanitizeAutoSavedChatState(raw: unknown): AutoSavedChatState | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;

  const rawProvider = typeof obj.provider === 'string' ? (obj.provider as ProviderId) : null;
  if (!rawProvider || !VALID_PROVIDER_IDS.has(rawProvider)) return null;

  const model =
    typeof obj.model === 'string' && obj.model.trim()
      ? obj.model.trim()
      : getDefaultModelForProvider(rawProvider);

  return {
    version: 1,
    provider: rawProvider,
    model,
    customBaseUrl:
      typeof obj.customBaseUrl === 'string' && obj.customBaseUrl.trim()
        ? obj.customBaseUrl
        : 'https://api.together.xyz/v1',
    customModelId: typeof obj.customModelId === 'string' ? obj.customModelId : '',
    systemPrompt: typeof obj.systemPrompt === 'string' ? obj.systemPrompt : '',
    composerText: typeof obj.composerText === 'string' ? obj.composerText : '',
    params: sanitizeParams(obj.params),
    messages: sanitizeMessages(obj.messages),
    activeSessionId: typeof obj.activeSessionId === 'string' ? obj.activeSessionId : null,
    savedAt:
      typeof obj.savedAt === 'number' && Number.isFinite(obj.savedAt) ? obj.savedAt : Date.now(),
  };
}

export function loadAutoSavedChatState(
  storage?: StorageLike | null
): AutoSavedChatState | null {
  const store = getStorage(storage);
  if (!store) return null;
  try {
    const raw = store.getItem(AUTOSAVE_STORAGE_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return sanitizeAutoSavedChatState(parsed);
  } catch {
    return null;
  }
}

export function saveAutoSavedChatState(
  state: AutoSaveSnapshotInput,
  storage?: StorageLike | null,
  now = Date.now()
): { saved: boolean; savedAt: number } {
  const store = getStorage(storage);
  if (!store) return { saved: false, savedAt: now };

  const cappedMessages = state.messages.slice(-MAX_AUTOSAVED_MESSAGES);
  const payload: AutoSavedChatState = {
    version: 1,
    provider: state.provider,
    model: state.model,
    customBaseUrl: state.customBaseUrl,
    customModelId: state.customModelId,
    systemPrompt: state.systemPrompt,
    composerText: state.composerText,
    params: state.params,
    messages: cappedMessages,
    activeSessionId: state.activeSessionId,
    savedAt: now,
  };

  try {
    store.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(payload));
    return { saved: true, savedAt: now };
  } catch {
    // Fallback if storage quota is tight: keep only the most recent 20 messages
    try {
      const trimmed: AutoSavedChatState = {
        ...payload,
        messages: cappedMessages.slice(-20),
      };
      store.setItem(AUTOSAVE_STORAGE_KEY, JSON.stringify(trimmed));
      return { saved: true, savedAt: now };
    } catch {
      return { saved: false, savedAt: now };
    }
  }
}

export function clearAutoSavedChatState(storage?: StorageLike | null): void {
  const store = getStorage(storage);
  if (!store) return;
  try {
    store.removeItem(AUTOSAVE_STORAGE_KEY);
  } catch {
    // Ignore storage failures
  }
}
