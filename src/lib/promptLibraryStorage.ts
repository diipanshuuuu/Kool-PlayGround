import type { StorageLike } from './keyStorage';
import type { SavedSystemPrompt } from './types';

export const PROMPT_LIBRARY_STORAGE_KEY = 'kurukshetra_prompt_library_v1';
const MAX_SAVED_PROMPTS = 50;

export const PROMPT_CATEGORIES = [
  'General',
  'Coding',
  'Writing',
  'Analysis',
  'Extraction',
] as const;

export const BUILT_IN_SYSTEM_PROMPTS: SavedSystemPrompt[] = [
  {
    id: 'builtin-code-reviewer',
    title: 'Senior Code Reviewer',
    category: 'Coding',
    content:
      'You are a senior software engineer reviewing code. Focus on correctness, edge cases, security, and maintainability. Prioritize high-impact issues first, explain why each matters concisely, and provide minimal, drop-in fixes.',
    updatedAt: 1,
    isBuiltIn: true,
  },
  {
    id: 'builtin-json-extractor',
    title: 'Strict JSON Extractor',
    category: 'Extraction',
    content:
      'Extract the requested structured information from the user input and return ONLY a single valid JSON object. Do not include markdown fences, commentary, or keys outside the requested schema. Use null for missing fields.',
    updatedAt: 2,
    isBuiltIn: true,
  },
  {
    id: 'builtin-technical-writer',
    title: 'Concise Technical Writer',
    category: 'Writing',
    content:
      'You write clear, scannable technical documentation. Lead with the answer, avoid filler or hype, use concrete examples, and structure complex explanations into short sections or comparison tables.',
    updatedAt: 3,
    isBuiltIn: true,
  },
  {
    id: 'builtin-root-cause-debugger',
    title: 'Root-Cause Debugger',
    category: 'Analysis',
    content:
      'Diagnose bugs methodically. State the most likely root cause first, explain the exact execution path that triggers it, provide a minimal verified fix, and suggest one concrete test case to prevent regressions.',
    updatedAt: 4,
    isBuiltIn: true,
  },
];

function getDefaultStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadPromptLibrary(storage?: StorageLike | null): SavedSystemPrompt[] {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) return [];

  try {
    const raw = store.getItem(PROMPT_LIBRARY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item): item is SavedSystemPrompt =>
          Boolean(item) &&
          typeof item === 'object' &&
          typeof (item as SavedSystemPrompt).id === 'string' &&
          typeof (item as SavedSystemPrompt).title === 'string' &&
          typeof (item as SavedSystemPrompt).content === 'string'
      )
      .map((item) => ({
        id: item.id,
        title: item.title.trim() || 'Untitled prompt',
        category:
          typeof item.category === 'string' && item.category.trim()
            ? item.category.trim()
            : 'General',
        content: item.content,
        updatedAt: typeof item.updatedAt === 'number' ? item.updatedAt : Date.now(),
        isBuiltIn: false,
      }))
      .sort((a, b) => b.updatedAt - a.updatedAt)
      .slice(0, MAX_SAVED_PROMPTS);
  } catch {
    return [];
  }
}

function persistPromptLibrary(
  prompts: SavedSystemPrompt[],
  storage?: StorageLike | null
): void {
  const store = storage === undefined ? getDefaultStorage() : storage;
  if (!store) return;

  try {
    const userOnly = prompts.filter((p) => !p.isBuiltIn).slice(0, MAX_SAVED_PROMPTS);
    store.setItem(PROMPT_LIBRARY_STORAGE_KEY, JSON.stringify(userOnly));
  } catch {
    // Ignore storage quota errors
  }
}

export function derivePromptTitle(content: string): string {
  const firstLine = content
    .split(/\r?\n/)
    .map((line) => line.replace(/^#+\s*/, '').trim())
    .find(Boolean);
  if (!firstLine) return 'Untitled system prompt';
  const cleaned = firstLine.replace(/\s+/g, ' ');
  return cleaned.length > 48 ? `${cleaned.slice(0, 48).trimEnd()}…` : cleaned;
}

export function upsertSavedPrompt(
  existing: SavedSystemPrompt[],
  prompt: Omit<SavedSystemPrompt, 'isBuiltIn'>,
  storage?: StorageLike | null
): SavedSystemPrompt[] {
  const normalized: SavedSystemPrompt = {
    id: prompt.id,
    title: prompt.title.trim() || derivePromptTitle(prompt.content),
    category: prompt.category.trim() || 'General',
    content: prompt.content.trim(),
    updatedAt: prompt.updatedAt,
    isBuiltIn: false,
  };

  const filtered = existing.filter((p) => p.id !== normalized.id && !p.isBuiltIn);
  const next = [normalized, ...filtered]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, MAX_SAVED_PROMPTS);
  persistPromptLibrary(next, storage);
  return next;
}

export function deleteSavedPrompt(
  existing: SavedSystemPrompt[],
  id: string,
  storage?: StorageLike | null
): SavedSystemPrompt[] {
  const next = existing.filter((p) => p.id !== id && !p.isBuiltIn);
  persistPromptLibrary(next, storage);
  return next;
}

export function filterPromptLibrary(
  prompts: SavedSystemPrompt[],
  query: string,
  category: string
): SavedSystemPrompt[] {
  const q = query.trim().toLowerCase();
  return prompts.filter((p) => {
    if (category === 'Saved' && p.isBuiltIn) return false;
    if (category !== 'All' && category !== 'Saved' && p.category !== category) {
      return false;
    }
    if (!q) return true;
    return (
      p.title.toLowerCase().includes(q) ||
      p.content.toLowerCase().includes(q) ||
      p.category.toLowerCase().includes(q)
    );
  });
}
