import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  BookMarked,
  Check,
  ChevronDown,
  Copy,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import {
  BUILT_IN_SYSTEM_PROMPTS,
  PROMPT_CATEGORIES,
  derivePromptTitle,
  filterPromptLibrary,
} from '../lib/promptLibraryStorage';
import { estimateTokens } from '../lib/streamParser';
import type { SavedSystemPrompt } from '../lib/types';

interface PromptLibraryDrawerProps {
  isOpen: boolean;
  startInCreateMode?: boolean;
  currentSystemPrompt: string;
  savedPrompts: SavedSystemPrompt[];
  onClose: () => void;
  onLoadPrompt: (prompt: SavedSystemPrompt) => void;
  onSavePrompt: (input: {
    id?: string;
    title: string;
    category: string;
    content: string;
  }) => void;
  onDeletePrompt: (id: string) => void;
}

export function PromptLibraryDrawer({
  isOpen,
  startInCreateMode = false,
  currentSystemPrompt,
  savedPrompts,
  onClose,
  onLoadPrompt,
  onSavePrompt,
  onDeletePrompt,
}: PromptLibraryDrawerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<string>('All');
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftCategory, setDraftCategory] = useState<string>('General');
  const [draftContent, setDraftContent] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setSearchQuery('');
    setFormError(null);
    if (startInCreateMode) {
      setIsEditorOpen(true);
      setEditingId(null);
      setDraftContent(currentSystemPrompt);
      setDraftTitle(currentSystemPrompt.trim() ? derivePromptTitle(currentSystemPrompt) : '');
      setDraftCategory('General');
    } else {
      setIsEditorOpen(false);
      setEditingId(null);
    }
  }, [isOpen, startInCreateMode, currentSystemPrompt]);

  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const combinedPrompts = useMemo(
    () => [...savedPrompts, ...BUILT_IN_SYSTEM_PROMPTS],
    [savedPrompts]
  );

  const visiblePrompts = useMemo(
    () => filterPromptLibrary(combinedPrompts, searchQuery, activeCategory),
    [combinedPrompts, searchQuery, activeCategory]
  );

  const openCreateFromCurrent = () => {
    setIsEditorOpen(true);
    setEditingId(null);
    setDraftContent(currentSystemPrompt);
    setDraftTitle(currentSystemPrompt.trim() ? derivePromptTitle(currentSystemPrompt) : '');
    setDraftCategory('General');
    setFormError(null);
  };

  const openEditPrompt = (prompt: SavedSystemPrompt, duplicate = false) => {
    setIsEditorOpen(true);
    setEditingId(duplicate || prompt.isBuiltIn ? null : prompt.id);
    setDraftTitle(duplicate || prompt.isBuiltIn ? `${prompt.title} (Copy)` : prompt.title);
    setDraftCategory(prompt.category || 'General');
    setDraftContent(prompt.content);
    setFormError(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedContent = draftContent.trim();
    if (!trimmedContent) {
      setFormError('Enter system prompt instructions before saving.');
      return;
    }
    onSavePrompt({
      id: editingId ?? undefined,
      title: draftTitle.trim() || derivePromptTitle(trimmedContent),
      category: draftCategory,
      content: trimmedContent,
    });
    setIsEditorOpen(false);
    setEditingId(null);
    setDraftTitle('');
    setDraftContent('');
    setFormError(null);
    if (activeCategory !== 'All' && activeCategory !== 'Saved' && activeCategory !== draftCategory) {
      setActiveCategory('All');
    }
  };

  const trimmedCurrent = currentSystemPrompt.trim();
  const filterTabs = ['All', 'Saved', ...PROMPT_CATEGORIES];

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="fixed inset-0 z-50 flex justify-end bg-black/45 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="prompt-library-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="flex h-full w-full max-w-md flex-col border-l border-zinc-200 bg-white shadow-2xl dark:border-zinc-800 dark:bg-[#111215]"
          >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200 px-4 py-4 sm:px-5 dark:border-zinc-800">
          <div className="flex min-w-0 items-center gap-2">
            <BookMarked className="h-4 w-4 shrink-0 text-[#E04F26] dark:text-[#F0643C]" />
            <h2
              id="prompt-library-title"
              className="truncate font-display text-base font-semibold text-zinc-950 dark:text-zinc-50"
            >
              Prompt Library
            </h2>
            <span className="hidden shrink-0 font-mono text-[11px] text-zinc-400 tabular-nums sm:inline dark:text-zinc-500">
              {savedPrompts.length} saved
            </span>
          </div>

          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={openCreateFromCurrent}
              className="inline-flex items-center gap-1 rounded-lg bg-[#E04F26] px-2.5 py-1.5 text-xs font-medium text-white whitespace-nowrap transition-colors hover:bg-[#C8401B] dark:bg-[#F0643C] dark:hover:bg-[#E04F26]"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{trimmedCurrent ? 'Save current' : 'New prompt'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close prompt library"
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Create / Edit Form */}
        {isEditorOpen && (
          <form
            onSubmit={handleSubmit}
            className="shrink-0 space-y-3 border-b border-zinc-200 bg-zinc-50/70 px-5 py-4 dark:border-zinc-800 dark:bg-[#0E0F12]"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                {editingId ? 'Edit system prompt' : 'Save to Prompt Library'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setIsEditorOpen(false);
                  setFormError(null);
                }}
                className="text-xs text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                Cancel
              </button>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-[1fr_124px]">
              <div>
                <label
                  htmlFor="prompt-library-title-input"
                  className="mb-1 block text-[11px] font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Title
                </label>
                <input
                  id="prompt-library-title-input"
                  type="text"
                  autoFocus
                  value={draftTitle}
                  onChange={(e) => setDraftTitle(e.target.value)}
                  placeholder="e.g. Strict TypeScript Architect"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-[#E04F26] focus:outline-none dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-100 dark:focus:border-[#F0643C]"
                />
              </div>

              <div>
                <label
                  htmlFor="prompt-library-category-select"
                  className="mb-1 block text-[11px] font-medium text-zinc-600 dark:text-zinc-400"
                >
                  Category
                </label>
                <div className="group relative">
                  <select
                    id="prompt-library-category-select"
                    value={draftCategory}
                    onChange={(e) => setDraftCategory(e.target.value)}
                    className="w-full appearance-none rounded-lg border border-zinc-200 bg-white py-1.5 pr-7 pl-2.5 text-xs text-zinc-900 transition-colors focus:border-[#E04F26] focus:outline-none dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-100 dark:focus:border-[#F0643C]"
                  >
                    {PROMPT_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    aria-hidden="true"
                    className="pointer-events-none absolute top-1/2 right-2 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 transition-colors group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300"
                  />
                </div>
              </div>
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label
                  htmlFor="prompt-library-content-input"
                  className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400"
                >
                  System instructions
                </label>
                <span className="font-mono text-[10px] text-zinc-400 tabular-nums dark:text-zinc-500">
                  ~{estimateTokens(draftContent)} tok
                </span>
              </div>
              <textarea
                id="prompt-library-content-input"
                rows={4}
                value={draftContent}
                onChange={(e) => {
                  setDraftContent(e.target.value);
                  if (formError) setFormError(null);
                }}
                placeholder="Define the assistant's role, tone, rules, or output schema…"
                className="kestrel-scroll w-full resize-y rounded-lg border border-zinc-200 bg-white px-2.5 py-2 text-xs leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:border-[#E04F26] focus:outline-none dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-100 dark:focus:border-[#F0643C]"
              />
            </div>

            {formError && (
              <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                {formError}
              </p>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                type="submit"
                className="rounded-lg bg-[#E04F26] px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-[#C8401B] dark:bg-[#F0643C] dark:hover:bg-[#E04F26]"
              >
                {editingId ? 'Update prompt' : 'Save prompt'}
              </button>
            </div>
          </form>
        )}

        {/* Search & Category Filter Bar */}
        <div className="shrink-0 space-y-2.5 border-b border-zinc-200 px-4 py-3 sm:px-5 dark:border-zinc-800">
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400" />
            <input
              type="text"
              aria-label="Search prompt library"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search system prompts…"
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50/70 py-1.5 pr-8 pl-8 text-xs text-zinc-900 placeholder:text-zinc-400 transition-colors focus:border-[#E04F26] focus:bg-white focus:outline-none dark:border-zinc-800 dark:bg-[#181A1F] dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-[#F0643C]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Clear prompt search"
                className="absolute top-1/2 right-2 -translate-y-1/2 rounded p-0.5 text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div
            className="flex flex-wrap items-center gap-0.5"
            role="tablist"
            aria-label="Prompt categories"
          >
            {filterTabs.map((cat) => {
              const isSelected = activeCategory === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  onClick={() => setActiveCategory(cat)}
                  className={`rounded-md border px-1.5 py-1 text-[11px] font-medium whitespace-nowrap transition-colors sm:px-2 ${
                    isSelected
                      ? 'border-zinc-900 bg-zinc-900 text-white dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100'
                      : 'border-transparent text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800/70 dark:hover:text-zinc-100'
                  }`}
                >
                  {cat}
                </button>
              );
            })}
          </div>
        </div>

        {/* Prompt List */}
        <div className="kestrel-scroll flex-1 overflow-y-auto p-4">
          {visiblePrompts.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <p className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {activeCategory === 'Saved' && savedPrompts.length === 0
                  ? 'No saved system prompts yet'
                  : 'No matching prompts'}
              </p>
              <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                {activeCategory === 'Saved' && savedPrompts.length === 0
                  ? 'Save your recurring system instructions here to load them into any conversation in one click.'
                  : 'Try another search term or switch categories.'}
              </p>
            </div>
          ) : (
            <ul className="space-y-2.5">
              {visiblePrompts.map((prompt) => {
                const isActive =
                  Boolean(trimmedCurrent) && prompt.content.trim() === trimmedCurrent;
                return (
                  <li
                    key={prompt.id}
                    className={`rounded-lg border p-3.5 transition-colors ${
                      isActive
                        ? 'border-[#E04F26]/70 bg-[#E04F26]/[0.04] dark:border-[#F0643C]/60 dark:bg-[#F0643C]/[0.07]'
                        : 'border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-[#14161A] dark:hover:border-zinc-700'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate text-xs font-semibold text-zinc-950 dark:text-zinc-100">
                            {prompt.title}
                          </span>
                          {isActive && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 font-mono text-[10px] text-[#E04F26] dark:text-[#F0643C]">
                              <Check className="h-3 w-3" />
                              Active
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10px] text-zinc-500 dark:text-zinc-400">
                          <span>{prompt.category}</span>
                          <span aria-hidden="true">·</span>
                          <span>~{estimateTokens(prompt.content)} tok</span>
                          {prompt.isBuiltIn && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>Template</span>
                            </>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            onLoadPrompt(prompt);
                            onClose();
                          }}
                          className="rounded-md border border-zinc-200 bg-zinc-50 px-2.5 py-1 text-[11px] font-medium text-zinc-800 transition-colors hover:border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:bg-[#1C1F26] dark:text-zinc-100 dark:hover:border-zinc-600 dark:hover:bg-[#252932]"
                        >
                          Load
                        </button>
                        {prompt.isBuiltIn ? (
                          <button
                            type="button"
                            onClick={() => openEditPrompt(prompt, true)}
                            aria-label={`Customize "${prompt.title}"`}
                            title="Duplicate & customize"
                            className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() => openEditPrompt(prompt, false)}
                              aria-label={`Edit "${prompt.title}"`}
                              title="Edit prompt"
                              className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                            >
                              <Pencil className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={() => onDeletePrompt(prompt.id)}
                              aria-label={`Delete "${prompt.title}"`}
                              title="Delete prompt"
                              className="rounded-md p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800 dark:hover:text-red-400"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>

                    <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">
                      {prompt.content}
                    </p>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-zinc-200 px-5 py-3 text-[11px] text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          Saved prompts are stored locally in this browser for quick reuse across sessions.
        </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
