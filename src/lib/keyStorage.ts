import type { ApiKeyEntry, ApiKeyStore, KeyStorageMode, ProviderId } from './types';

export const LOCAL_KEYS_STORAGE_KEY = 'kestrel_byok_keys_v1';

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function getBrowserStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) {
    return storage;
  }
  if (typeof window === 'undefined') {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * Loads ONLY keys the user explicitly opted to persist in browser localStorage.
 * Ephemeral ("session") keys are kept strictly in React memory and vanish on refresh.
 */
export function loadPersistedKeys(storage?: StorageLike | null): ApiKeyStore {
  const store = getBrowserStorage(storage);
  if (!store) return {};

  try {
    const raw = store.getItem(LOCAL_KEYS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object') return {};

    const result: ApiKeyStore = {};
    for (const [provider, val] of Object.entries(parsed)) {
      if (
        val &&
        typeof val === 'object' &&
        typeof (val as ApiKeyEntry).key === 'string' &&
        (val as ApiKeyEntry).key.trim().length > 0
      ) {
        result[provider as ProviderId] = {
          key: (val as ApiKeyEntry).key.trim(),
          mode: 'local',
          updatedAt:
            typeof (val as ApiKeyEntry).updatedAt === 'number'
              ? (val as ApiKeyEntry).updatedAt
              : Date.now(),
        };
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeLocalOnlyEntries(keys: ApiKeyStore, storage?: StorageLike | null): void {
  const store = getBrowserStorage(storage);
  if (!store) return;

  const localOnly: Record<string, ApiKeyEntry> = {};
  for (const [provider, entry] of Object.entries(keys)) {
    if (entry && entry.mode === 'local' && entry.key.trim()) {
      localOnly[provider] = {
        key: entry.key.trim(),
        mode: 'local',
        updatedAt: entry.updatedAt,
      };
    }
  }

  try {
    if (Object.keys(localOnly).length === 0) {
      store.removeItem(LOCAL_KEYS_STORAGE_KEY);
    } else {
      store.setItem(LOCAL_KEYS_STORAGE_KEY, JSON.stringify(localOnly));
    }
  } catch {
    // Ignore storage quota errors gracefully
  }
}

/**
 * Sets or updates a provider API key.
 * - If mode === 'session': kept only in memory; explicitly removed from localStorage if previously saved.
 * - If mode === 'local': kept in memory and persisted to browser localStorage.
 */
export function setProviderKey(
  current: ApiKeyStore,
  provider: ProviderId,
  rawKey: string,
  mode: KeyStorageMode,
  storage?: StorageLike | null
): ApiKeyStore {
  const trimmed = rawKey.trim();
  if (!trimmed) {
    return removeProviderKey(current, provider, storage);
  }

  const next: ApiKeyStore = {
    ...current,
    [provider]: {
      key: trimmed,
      mode,
      updatedAt: Date.now(),
    },
  };

  writeLocalOnlyEntries(next, storage);
  return next;
}

export function removeProviderKey(
  current: ApiKeyStore,
  provider: ProviderId,
  storage?: StorageLike | null
): ApiKeyStore {
  const next: ApiKeyStore = { ...current };
  delete next[provider];
  writeLocalOnlyEntries(next, storage);
  return next;
}

export function clearAllProviderKeys(storage?: StorageLike | null): ApiKeyStore {
  const store = getBrowserStorage(storage);
  if (store) {
    try {
      store.removeItem(LOCAL_KEYS_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
  }
  return {};
}

/**
 * Clears ONLY temporary ("session") keys from memory (e.g. on session lock / logout),
 * leaving keys explicitly saved in browser localStorage untouched.
 */
export function clearSessionKeysOnly(current: ApiKeyStore): ApiKeyStore {
  const next: ApiKeyStore = {};
  for (const [provider, entry] of Object.entries(current)) {
    if (entry && entry.mode === 'local' && entry.key.trim()) {
      next[provider as ProviderId] = entry;
    }
  }
  return next;
}

export function countConfiguredKeys(keys: ApiKeyStore): {
  total: number;
  session: number;
  local: number;
} {
  let session = 0;
  let local = 0;
  for (const entry of Object.values(keys)) {
    if (!entry?.key?.trim()) continue;
    if (entry.mode === 'local') local += 1;
    else session += 1;
  }
  return { total: session + local, session, local };
}

export function validateKeyFormatHint(
  provider: ProviderId,
  rawKey: string
): { warning?: string } {
  const key = rawKey.trim();
  if (!key) return {};

  if (/\s/.test(key)) {
    return { warning: 'Key contains whitespace — double-check your copy/paste.' };
  }
  if (provider === 'groq' && !key.startsWith('gsk_')) {
    return { warning: 'Groq keys typically begin with "gsk_".' };
  }
  if (provider === 'anthropic' && !key.startsWith('sk-ant-')) {
    return { warning: 'Anthropic keys typically begin with "sk-ant-".' };
  }
  if (provider === 'openrouter' && !key.startsWith('sk-or-')) {
    return { warning: 'OpenRouter keys typically begin with "sk-or-".' };
  }
  if (provider === 'openai' && !key.startsWith('sk-')) {
    return { warning: 'OpenAI keys typically begin with "sk-".' };
  }
  return {};
}

export function maskApiKey(key: string): string {
  const trimmed = key.trim();
  if (!trimmed) return '';
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}••••`;
  }
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

/**
 * Returns true when no persisted API keys exist on initial load,
 * signaling the app to launch directly into the API Key Vault.
 */
export function shouldLaunchToVault(keys: ApiKeyStore): boolean {
  return countConfiguredKeys(keys).total === 0;
}

const INITIAL_PROVIDER_ORDER: ProviderId[] = [
  'groq',
  'openai',
  'anthropic',
  'openrouter',
  'custom',
];

/**
 * Picks the best starting provider based on saved keys:
 * prefers Groq if configured, otherwise the first provider with a saved key,
 * falling back to Groq when none are saved yet.
 */
export function resolveInitialProvider(keys: ApiKeyStore): ProviderId {
  for (const pid of INITIAL_PROVIDER_ORDER) {
    if (keys[pid]?.key?.trim()) {
      return pid;
    }
  }
  return 'groq';
}

