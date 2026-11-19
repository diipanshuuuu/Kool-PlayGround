import { useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Bookmark, Clock, Trash2, X } from 'lucide-react';
import { getProviderById } from '../lib/providers';
import type { SavedSession } from '../lib/types';

interface SessionsModalProps {
  isOpen: boolean;
  sessions: SavedSession[];
  activeSessionId: string | null;
  onClose: () => void;
  onSaveCurrent: () => void;
  onLoadSession: (session: SavedSession) => void;
  onDeleteSession: (sessionId: string) => void;
}

function formatRelativeTime(timestamp: number): string {
  const diffSec = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

export function SessionsModal({
  isOpen,
  sessions,
  activeSessionId,
  onClose,
  onSaveCurrent,
  onLoadSession,
  onDeleteSession,
}: SessionsModalProps) {
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="sessions-modal-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 4 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="flex max-h-[82vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-[#111215]"
          >
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Bookmark className="h-4 w-4 text-[#E04F26] dark:text-[#F0643C]" />
            <h2
              id="sessions-modal-title"
              className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50"
            >
              Saved Sessions
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onSaveCurrent}
              className="rounded-lg bg-[#E04F26] px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#C8401B] dark:bg-[#F0643C] dark:hover:bg-[#E04F26]"
            >
              Save current
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close saved sessions dialog"
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        <div className="kestrel-scroll flex-1 overflow-y-auto p-4">
          {sessions.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                No saved sessions yet
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                Save your current prompt, system instructions, and parameters locally in this browser to revisit later.
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-zinc-100 dark:divide-zinc-800/80">
              {sessions.map((session) => {
                const provider = getProviderById(session.provider);
                const isActive = session.id === activeSessionId;
                return (
                  <li
                    key={session.id}
                    className="flex items-center justify-between gap-3 py-3 first:pt-1 last:pb-1"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onLoadSession(session);
                        onClose();
                      }}
                      className="min-w-0 flex-1 text-left transition-colors hover:opacity-80"
                    >
                      <div className="truncate text-sm font-medium text-zinc-900 dark:text-zinc-100">
                        {session.title}
                        {isActive && (
                          <span className="ml-2 font-mono text-[11px] font-normal text-[#E04F26] dark:text-[#F0643C]">
                            Active
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
                        <span>{provider.shortName}</span>
                        <span aria-hidden="true">·</span>
                        <span className="truncate font-mono">{session.model}</span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1 whitespace-nowrap">
                          <Clock className="h-3 w-3" />
                          {formatRelativeTime(session.updatedAt)}
                        </span>
                      </div>
                    </button>

                    <button
                      type="button"
                      onClick={() => onDeleteSession(session.id)}
                      aria-label={`Delete session "${session.title}"`}
                      className="shrink-0 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="border-t border-zinc-200 px-6 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Sessions are stored locally in your browser without API keys.
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
