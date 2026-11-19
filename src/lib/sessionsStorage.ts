import type { SavedSession } from './types';
import type { StorageLike } from './keyStorage';

export const SESSIONS_STORAGE_KEY = 'kestrel_sessions_v1';
const MAX_SAVED_SESSIONS = 25;

function getStorage(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function loadSavedSessions(storage?: StorageLike | null): SavedSession[] {
  const store = getStorage(storage);
  if (!store) return [];
  try {
    const raw = store.getItem(SESSIONS_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as SavedSession[];
  } catch {
    return [];
  }
}

export function saveSessionToStorage(
  sessions: SavedSession[],
  session: SavedSession,
  storage?: StorageLike | null
): SavedSession[] {
  const filtered = sessions.filter((s) => s.id !== session.id);
  const next = [session, ...filtered].slice(0, MAX_SAVED_SESSIONS);
  const store = getStorage(storage);
  if (store) {
    try {
      store.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors
    }
  }
  return next;
}

export function deleteSessionFromStorage(
  sessions: SavedSession[],
  sessionId: string,
  storage?: StorageLike | null
): SavedSession[] {
  const next = sessions.filter((s) => s.id !== sessionId);
  const store = getStorage(storage);
  if (store) {
    try {
      if (next.length === 0) {
        store.removeItem(SESSIONS_STORAGE_KEY);
      } else {
        store.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(next));
      }
    } catch {
      // Ignore quota errors
    }
  }
  return next;
}

export function deriveSessionTitle(messages: SavedSession['messages'], systemPrompt: string): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  const source = firstUser?.content.trim() || systemPrompt.trim() || 'Untitled session';
  const singleLine = source.replace(/\s+/g, ' ');
  return singleLine.length > 48 ? `${singleLine.slice(0, 48)}…` : singleLine;
}
