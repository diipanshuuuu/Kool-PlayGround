import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowUp,
  Bookmark,
  Braces,
  ChevronDown,
  ChevronRight,
  Globe,
  KeyRound,
  LogOut,
  Moon,
  SlidersHorizontal,
  Square,
  Sun,
} from 'lucide-react';
import { ApiKeyModal } from './components/ApiKeyModal';
import { CodeExportModal } from './components/CodeExportModal';
import { MessageList } from './components/MessageList';
import { ParametersPanel } from './components/ParametersPanel';
import { SessionsModal } from './components/SessionsModal';
import {
  clearAllProviderKeys,
  clearSessionKeysOnly,
  countConfiguredKeys,
  loadPersistedKeys,
  maskApiKey,
  removeProviderKey,
  setProviderKey,
} from './lib/keyStorage';
import {
  DEFAULT_PLAYGROUND_PARAMS,
  getDefaultModelForProvider,
  getEffectiveModelId,
  getProviderById,
  validateRequestConfig,
} from './lib/providers';
import {
  deleteSessionFromStorage,
  deriveSessionTitle,
  loadSavedSessions,
  saveSessionToStorage,
} from './lib/sessionsStorage';
import { estimateTokens, parseAppSseLine } from './lib/streamParser';
import { classifyPromptShotType } from './lib/promptAnalysis';
import type {
  ApiKeyStore,
  ChatMessage,
  KeyStorageMode,
  PlaygroundParams,
  ProviderId,
  SavedSession,
  SearchCitation,
} from './lib/types';

const THEME_STORAGE_KEY = 'kestrel_theme_v1';

function createId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export default function App() {
  // Theme state (persisted locally)
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    try {
      const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
      if (saved === 'dark') return true;
      if (saved === 'light') return false;
      return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, isDark ? 'dark' : 'light');
    } catch {
      // Ignore storage failures
    }
  }, [isDark]);

  // API keys: loads ONLY explicitly saved localStorage keys; session keys live strictly in React memory
  const [apiKeys, setApiKeys] = useState<ApiKeyStore>(() => loadPersistedKeys());

  // Provider, model, and parameter state
  const [providerId, setProviderId] = useState<ProviderId>('groq');
  const [modelId, setModelId] = useState<string>(() => getDefaultModelForProvider('groq'));
  const [customBaseUrl, setCustomBaseUrl] = useState<string>('https://api.together.xyz/v1');
  const [customModelId, setCustomModelId] = useState<string>('');
  const [params, setParams] = useState<PlaygroundParams>(DEFAULT_PLAYGROUND_PARAMS);

  // Prompt & Conversation state
  const [systemPrompt, setSystemPrompt] = useState<string>('');
  const [systemExpanded, setSystemExpanded] = useState<boolean>(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [composerText, setComposerText] = useState<string>('');
  const [validationError, setValidationError] = useState<string | null>(null);

  // Streaming state
  const [isStreaming, setIsStreaming] = useState<boolean>(false);
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);

  // Layout & Modal state
  const [isParamsOpenDesktop, setIsParamsOpenDesktop] = useState<boolean>(true);
  const [isParamsOpenMobile, setIsParamsOpenMobile] = useState<boolean>(false);
  const [isApiKeyModalOpen, setIsApiKeyModalOpen] = useState<boolean>(false);
  const [isCodeModalOpen, setIsCodeModalOpen] = useState<boolean>(false);
  const [isSessionsModalOpen, setIsSessionsModalOpen] = useState<boolean>(false);

  // Saved local sessions
  const [savedSessions, setSavedSessions] = useState<SavedSession[]>(() => loadSavedSessions());
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [sessionToast, setSessionToast] = useState<string | null>(null);

  const activeProvider = useMemo(() => getProviderById(providerId), [providerId]);
  const activeKeyEntry = apiKeys[providerId];
  const effectiveModel = useMemo(
    () => getEffectiveModelId(providerId, modelId, customModelId),
    [providerId, modelId, customModelId]
  );
  const promptShot = useMemo(
    () => classifyPromptShotType(composerText, systemPrompt),
    [composerText, systemPrompt]
  );

  // Auto-resize composer textarea cleanly
  useEffect(() => {
    const el = composerRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [composerText]);

  // Keep conversation scrolled smoothly when new tokens arrive
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [messages, liveStatus]);

  const handleProviderChange = useCallback((nextProvider: ProviderId) => {
    setProviderId(nextProvider);
    setModelId(getDefaultModelForProvider(nextProvider));
    setCustomModelId('');
    setValidationError(null);
    if (nextProvider === 'anthropic') {
      setParams((prev) => ({
        ...prev,
        temperature: Math.min(prev.temperature, 1),
        jsonMode: false,
      }));
    }
  }, []);

  const handleSaveKey = useCallback(
    (provider: ProviderId, key: string, mode: KeyStorageMode) => {
      setApiKeys((prev) => setProviderKey(prev, provider, key, mode));
      setValidationError(null);
    },
    []
  );

  const handleRemoveKey = useCallback((provider: ProviderId) => {
    setApiKeys((prev) => removeProviderKey(prev, provider));
  }, []);

  const handleClearSessionKeys = useCallback(() => {
    setApiKeys((prev) => clearSessionKeysOnly(prev));
    setSessionToast('Temporary session keys cleared');
    setTimeout(() => setSessionToast(null), 2400);
  }, []);

  const handleClearAllKeys = useCallback(() => {
    setApiKeys(clearAllProviderKeys());
  }, []);

  const keyCounts = useMemo(() => countConfiguredKeys(apiKeys), [apiKeys]);

  const stopGeneration = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    setLiveStatus(null);
  }, []);

  const runCompletion = useCallback(
    async (
      conversationHistory: ChatMessage[],
      overrideParams?: PlaygroundParams
    ) => {
      const effectiveParams = overrideParams ?? params;
      const lastUser = [...conversationHistory].reverse().find((m) => m.role === 'user');
      const validation = validateRequestConfig({
        providerId,
        apiKey: activeKeyEntry?.key,
        modelId: effectiveModel,
        customBaseUrl,
        promptText: lastUser?.content ?? '',
      });

      if (!validation.valid) {
        setValidationError(validation.error ?? 'Check your configuration before sending.');
        return;
      }

      setValidationError(null);
      setIsStreaming(true);
      setLiveStatus(effectiveParams.browserSearch ? 'Searching the web…' : null);

      const assistantId = createId();
      const assistantPlaceholder: ChatMessage = {
        id: assistantId,
        role: 'assistant',
        content: '',
        modelUsed: effectiveModel,
        providerUsed: providerId,
        paramsSnapshot: {
          temperature: effectiveParams.temperature,
          topP: effectiveParams.topP,
          maxTokens: effectiveParams.maxTokens,
          browserSearch: effectiveParams.browserSearch,
          jsonMode: effectiveParams.jsonMode,
        },
        createdAt: Date.now(),
      };

      setMessages([...conversationHistory, assistantPlaceholder]);

      const controller = new AbortController();
      abortControllerRef.current = controller;

      const startedAt = performance.now();
      let ttftMs: number | undefined;
      let accumulatedText = '';
      let accumulatedThinking = '';
      let collectedCitations: SearchCitation[] | undefined;
      let usageStats: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
      } = {};

      try {
        const endpoint =
          providerId === 'sandbox' ? '/api/sandbox/chat' : '/api/proxy/chat';

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (providerId !== 'sandbox' && activeKeyEntry?.key) {
          headers['x-provider-api-key'] = activeKeyEntry.key;
        }

        const response = await fetch(endpoint, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            provider: providerId,
            model: effectiveModel,
            customBaseUrl: providerId === 'custom' ? customBaseUrl : undefined,
            systemPrompt,
            messages: conversationHistory
              .filter((m) => !m.error && m.content.trim())
              .map((m) => ({ role: m.role, content: m.content })),
            params: effectiveParams,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          let errMsg = `Request failed (${response.status})`;
          try {
            const data = (await response.json()) as { error?: string };
            if (data?.error) errMsg = data.error;
          } catch {
            // Keep default HTTP message
          }
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, error: errMsg } : m))
          );
          setIsStreaming(false);
          setLiveStatus(null);
          return;
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error('Response stream could not be read.');
        }

        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const event = parseAppSseLine(line);
            if (!event) continue;

            if (event.type === 'status' && event.status) {
              setLiveStatus(event.status);
            } else if (event.type === 'thinking' && event.text) {
              if (ttftMs === undefined) ttftMs = performance.now() - startedAt;
              accumulatedThinking += event.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, thinking: accumulatedThinking } : m
                )
              );
            } else if (event.type === 'delta' && event.text) {
              if (ttftMs === undefined) ttftMs = performance.now() - startedAt;
              setLiveStatus(null);
              accumulatedText += event.text;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, content: accumulatedText } : m
                )
              );
            } else if (event.type === 'citations' && event.citations) {
              collectedCitations = event.citations;
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantId ? { ...m, citations: collectedCitations } : m
                )
              );
            } else if (event.type === 'usage' && event.usage) {
              usageStats = { ...usageStats, ...event.usage };
            } else if (event.type === 'error') {
              const errText = event.error || 'Provider returned an error.';
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, error: errText } : m))
              );
            }
          }
        }

        const elapsedMs = performance.now() - startedAt;
        const estimatedCompletion =
          usageStats.completionTokens ??
          (accumulatedText ? estimateTokens(accumulatedText) : 0);

        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  metrics: m.error
                    ? undefined
                    : {
                        elapsedMs,
                        ttftMs,
                        promptTokens: usageStats.promptTokens,
                        completionTokens: estimatedCompletion,
                        totalTokens:
                          usageStats.totalTokens ??
                          (usageStats.promptTokens
                            ? usageStats.promptTokens + estimatedCompletion
                            : estimatedCompletion),
                      },
                }
              : m
          )
        );
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          const elapsedMs = performance.now() - startedAt;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    metrics: accumulatedText
                      ? {
                          elapsedMs,
                          ttftMs,
                          completionTokens: estimateTokens(accumulatedText),
                        }
                      : undefined,
                  }
                : m
            )
          );
        } else {
          const message = err instanceof Error ? err.message : 'Network request failed.';
          setMessages((prev) =>
            prev.map((m) => (m.id === assistantId ? { ...m, error: message } : m))
          );
        }
      } finally {
        abortControllerRef.current = null;
        setIsStreaming(false);
        setLiveStatus(null);
      }
    },
    [providerId, activeKeyEntry, effectiveModel, customBaseUrl, systemPrompt, params]
  );

  const handleSend = useCallback(async () => {
    if (isStreaming) return;
    const trimmed = composerText.trim();
    const validation = validateRequestConfig({
      providerId,
      apiKey: activeKeyEntry?.key,
      modelId: effectiveModel,
      customBaseUrl,
      promptText: trimmed,
    });

    if (!validation.valid) {
      setValidationError(validation.error ?? 'Check your configuration before sending.');
      return;
    }

    const userMsg: ChatMessage = {
      id: createId(),
      role: 'user',
      content: trimmed,
      createdAt: Date.now(),
    };

    const nextHistory = [...messages, userMsg];
    setComposerText('');
    await runCompletion(nextHistory);
  }, [
    isStreaming,
    composerText,
    providerId,
    activeKeyEntry,
    effectiveModel,
    customBaseUrl,
    messages,
    runCompletion,
  ]);

  const handleSelectStarter = useCallback(
    (prompt: string, opts?: { enableSearch?: boolean; enableJson?: boolean }) => {
      setComposerText(prompt);
      setValidationError(null);
      if (opts?.enableSearch || opts?.enableJson) {
        setParams((prev) => ({
          ...prev,
          browserSearch: opts.enableSearch ? true : prev.browserSearch,
          jsonMode: opts.enableJson
            ? providerId === 'sandbox' && opts.enableSearch
              ? false
              : true
            : prev.jsonMode,
        }));
      }
      composerRef.current?.focus();
    },
    [providerId]
  );

  const handleDeleteMessage = useCallback((id: string) => {
    setMessages((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const handleEditUserMessage = useCallback(
    async (id: string, newContent: string) => {
      const idx = messages.findIndex((m) => m.id === id);
      if (idx === -1) return;
      const truncated = messages.slice(0, idx + 1).map((m) =>
        m.id === id ? { ...m, content: newContent } : m
      );
      await runCompletion(truncated);
    },
    [messages, runCompletion]
  );

  const handleRegenerateLast = useCallback(async () => {
    if (isStreaming || messages.length === 0) return;
    const lastIdx = messages.length - 1;
    const historyWithoutLast =
      messages[lastIdx].role === 'assistant' ? messages.slice(0, lastIdx) : messages;
    if (historyWithoutLast.length === 0) return;
    await runCompletion(historyWithoutLast);
  }, [isStreaming, messages, runCompletion]);

  const handleNewChat = useCallback(() => {
    stopGeneration();
    setMessages([]);
    setValidationError(null);
    setActiveSessionId(null);
    composerRef.current?.focus();
  }, [stopGeneration]);

  const handleSaveCurrentSession = useCallback(() => {
    const id = activeSessionId ?? createId();
    const session: SavedSession = {
      id,
      title: deriveSessionTitle(messages, systemPrompt),
      provider: providerId,
      model: modelId,
      customBaseUrl,
      customModelId,
      systemPrompt,
      params,
      messages,
      updatedAt: Date.now(),
    };
    const next = saveSessionToStorage(savedSessions, session);
    setSavedSessions(next);
    setActiveSessionId(id);
    setSessionToast('Session saved locally');
    setTimeout(() => setSessionToast(null), 2000);
  }, [
    activeSessionId,
    messages,
    systemPrompt,
    providerId,
    modelId,
    customBaseUrl,
    customModelId,
    params,
    savedSessions,
  ]);

  const handleLoadSession = useCallback(
    (session: SavedSession) => {
      stopGeneration();
      setProviderId(session.provider);
      setModelId(session.model);
      setCustomBaseUrl(session.customBaseUrl ?? 'https://api.together.xyz/v1');
      setCustomModelId(session.customModelId ?? '');
      setSystemPrompt(session.systemPrompt);
      setSystemExpanded(Boolean(session.systemPrompt.trim()));
      setParams(session.params);
      setMessages(session.messages);
      setActiveSessionId(session.id);
      setValidationError(null);
    },
    [stopGeneration]
  );

  const handleDeleteSession = useCallback(
    (id: string) => {
      setSavedSessions((prev) => deleteSessionFromStorage(prev, id));
      if (activeSessionId === id) {
        setActiveSessionId(null);
      }
    },
    [activeSessionId]
  );

  const keyStatusLabel = useMemo(() => {
    if (!activeProvider.requiresKey) {
      return 'No key needed';
    }
    if (!activeKeyEntry) {
      return `Set ${activeProvider.shortName} key`;
    }
    const prefix = activeKeyEntry.mode === 'local' ? 'Saved' : 'Session';
    return `${prefix} · ${maskApiKey(activeKeyEntry.key)}`;
  }, [activeProvider, activeKeyEntry]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#FAFAFA] text-zinc-950 dark:bg-[#0B0C0E] dark:text-zinc-50">
      {/* Top Bar: Clean 3-zone contract */}
      <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-zinc-200 bg-white px-3 sm:gap-6 sm:px-5 dark:border-zinc-800 dark:bg-[#111215]">
        {/* Zone 1: Brand Wordmark */}
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setIsApiKeyModalOpen(false);
            setIsCodeModalOpen(false);
            setIsSessionsModalOpen(false);
          }}
          className="font-display text-[15px] font-bold tracking-tight text-zinc-950 whitespace-nowrap shrink-0 sm:text-lg dark:text-zinc-50"
        >
          Kurukshetra
        </a>

        {/* Zone 2: Concise single-line nav controls */}
        <nav
          aria-label="Primary navigation"
          className="flex items-center gap-2.5 text-xs font-medium text-zinc-600 sm:gap-5 sm:text-sm dark:text-zinc-400"
        >
          <button
            type="button"
            onClick={() => {
              setIsApiKeyModalOpen(false);
              setIsCodeModalOpen(false);
              setIsSessionsModalOpen(false);
            }}
            className="hidden text-zinc-950 whitespace-nowrap shrink-0 transition-colors hover:text-zinc-950 sm:inline-block dark:text-zinc-100 dark:hover:text-white"
          >
            Playground
          </button>
          <button
            type="button"
            onClick={() => setIsApiKeyModalOpen(true)}
            className="whitespace-nowrap shrink-0 transition-colors hover:text-zinc-950 dark:hover:text-zinc-100"
          >
            <span className="hidden sm:inline">API </span>Keys
          </button>
          <button
            type="button"
            onClick={() => setIsCodeModalOpen(true)}
            className="whitespace-nowrap shrink-0 transition-colors hover:text-zinc-950 dark:hover:text-zinc-100"
          >
            <span className="hidden sm:inline">View </span>Code
          </button>
          <button
            type="button"
            onClick={() => setIsSessionsModalOpen(true)}
            className="whitespace-nowrap shrink-0 transition-colors hover:text-zinc-950 dark:hover:text-zinc-100"
          >
            Sessions
          </button>
        </nav>

        {/* Zone 3: Primary Action */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={handleNewChat}
            className="rounded-lg bg-zinc-950 px-2.5 py-1.5 text-xs font-medium text-white whitespace-nowrap shrink-0 transition-colors hover:bg-zinc-800 sm:px-3.5 sm:py-2 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-white"
          >
            New<span className="hidden sm:inline"> Chat</span>
          </button>
        </div>
      </header>

      {/* Main Split Workspace */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        {/* Center Playground Column */}
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {/* Quiet Workspace Context Toolbar */}
          <div className="flex shrink-0 items-center justify-between gap-3 border-b border-zinc-200/80 bg-[#FAFAFA] px-5 py-2.5 dark:border-zinc-800/80 dark:bg-[#0B0C0E]">
            <div className="flex min-w-0 items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
              <span className="font-medium text-zinc-900 whitespace-nowrap dark:text-zinc-100">
                {activeProvider.shortName}
              </span>
              <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                /
              </span>
              <span className="truncate font-mono text-zinc-700 dark:text-zinc-300">
                {effectiveModel || 'No model'}
              </span>
              <span aria-hidden="true" className="hidden text-zinc-300 sm:inline dark:text-zinc-700">
                ·
              </span>
              {activeProvider.requiresKey ? (
                <div className="hidden items-center gap-2 sm:inline-flex">
                  <button
                    type="button"
                    onClick={() => setIsApiKeyModalOpen(true)}
                    className={`inline-flex items-center gap-1.5 font-mono text-xs whitespace-nowrap transition-colors ${
                      activeKeyEntry
                        ? 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
                        : 'text-[#E04F26] hover:text-[#C8401B] dark:text-[#F0643C]'
                    }`}
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    <span>{keyStatusLabel}</span>
                  </button>
                  {keyCounts.session > 0 && (
                    <button
                      type="button"
                      onClick={handleClearSessionKeys}
                      aria-label="End session and clear temporary keys"
                      title="Clear temporary session keys"
                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium text-zinc-500 whitespace-nowrap transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      <LogOut className="h-3 w-3" />
                      <span>End session</span>
                    </button>
                  )}
                </div>
              ) : (
                <span className="hidden text-xs text-zinc-500 whitespace-nowrap sm:inline dark:text-zinc-400">
                  {keyStatusLabel}
                </span>
              )}
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {sessionToast && (
                <span
                  role="status"
                  className="mr-2 text-xs text-zinc-500 whitespace-nowrap dark:text-zinc-400"
                >
                  {sessionToast}
                </span>
              )}
              {providerId !== 'sandbox' && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.innerWidth < 1024) {
                      setIsParamsOpenMobile(true);
                    } else {
                      setIsParamsOpenDesktop(true);
                    }
                  }}
                  title="Current temperature, top-p, and max tokens"
                  className="mr-1 hidden rounded-md px-2 py-1 font-mono text-[11px] text-zinc-500 tabular-nums whitespace-nowrap transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 md:inline-block dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                >
                  T {params.temperature} · P {params.topP} · {params.maxTokens}
                </button>
              )}
              <button
                type="button"
                onClick={handleSaveCurrentSession}
                aria-label="Save current session"
                title="Save session locally"
                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <Bookmark className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsDark((prev) => !prev)}
                aria-label={isDark ? 'Switch to light theme' : 'Switch to dark theme'}
                title={isDark ? 'Light mode' : 'Dark mode'}
                className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-200/70 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.innerWidth < 1024) {
                    setIsParamsOpenMobile(true);
                  } else {
                    setIsParamsOpenDesktop((prev) => !prev);
                  }
                }}
                aria-label="Toggle parameters panel"
                aria-expanded={isParamsOpenDesktop}
                title="Toggle parameters"
                className="inline-flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs font-medium text-zinc-600 whitespace-nowrap transition-colors hover:bg-zinc-200/70 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Parameters</span>
              </button>
            </div>
          </div>

          {/* Collapsible System Prompt Strip */}
          <div className="shrink-0 border-b border-zinc-200/80 bg-white dark:border-zinc-800/80 dark:bg-[#111215]">
            <div className="mx-auto w-full max-w-3xl px-5">
              <button
                type="button"
                onClick={() => setSystemExpanded((prev) => !prev)}
                aria-expanded={systemExpanded}
                className="flex w-full items-center justify-between py-2.5 text-left text-xs font-medium text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
              >
                <span className="inline-flex items-center gap-1.5">
                  {systemExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5" />
                  )}
                  <span>System Prompt</span>
                  {!systemExpanded && systemPrompt.trim() && (
                    <span className="ml-1.5 max-w-[240px] truncate font-normal text-zinc-400 sm:max-w-[380px] dark:text-zinc-500">
                      — {systemPrompt.trim()}
                    </span>
                  )}
                </span>
                <span className="font-mono text-[11px] text-zinc-400 tabular-nums dark:text-zinc-500">
                  {estimateTokens(systemPrompt)} tok
                </span>
              </button>

              {systemExpanded && (
                <div className="pb-3.5">
                  <label htmlFor="system-prompt-textarea" className="sr-only">
                    System prompt instructions
                  </label>
                  <textarea
                    id="system-prompt-textarea"
                    rows={3}
                    value={systemPrompt}
                    onChange={(e) => setSystemPrompt(e.target.value)}
                    placeholder="Define the assistant's role, tone, constraints, or output format…"
                    className="kestrel-scroll w-full resize-y rounded-lg border border-zinc-200 bg-[#FAFAFA] px-3 py-2 text-sm leading-relaxed text-zinc-900 placeholder:text-zinc-400 focus:border-[#E04F26] focus:bg-white focus:outline-none dark:border-zinc-800 dark:bg-[#0B0C0E] dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-[#F0643C] dark:focus:bg-[#14161A]"
                  />
                </div>
              )}
            </div>
          </div>

          {/* Scrollable Message Canvas */}
          <div
            ref={scrollContainerRef}
            className="kestrel-scroll flex-1 overflow-y-auto"
          >
            <MessageList
              messages={messages}
              isStreaming={isStreaming}
              liveStatus={liveStatus}
              providerId={providerId}
              hasActiveKey={Boolean(activeKeyEntry?.key)}
              onSelectStarter={handleSelectStarter}
              onDeleteMessage={handleDeleteMessage}
              onEditUserMessage={handleEditUserMessage}
              onRegenerateLast={handleRegenerateLast}
              onOpenApiKeys={() => setIsApiKeyModalOpen(true)}
              onSwitchToSandbox={() => handleProviderChange('sandbox')}
              onUseOwnKey={() => {
                handleProviderChange('groq');
                setIsApiKeyModalOpen(true);
              }}
            />
          </div>

          {/* Bottom Composer */}
          <div className="shrink-0 border-t border-zinc-200/80 bg-[#FAFAFA] px-4 py-3.5 dark:border-zinc-800/80 dark:bg-[#0B0C0E]">
            <div className="mx-auto w-full max-w-3xl space-y-2">
              {validationError && (
                <div
                  role="alert"
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50/90 px-3.5 py-2 text-xs text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/40 dark:text-amber-200"
                >
                  <div className="flex items-center gap-2">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                    <span>{validationError}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {activeProvider.requiresKey && !activeKeyEntry?.key && (
                      <>
                        <button
                          type="button"
                          onClick={() => setIsApiKeyModalOpen(true)}
                          className="font-medium underline underline-offset-2 hover:opacity-80"
                        >
                          Paste API key
                        </button>
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          onClick={() => handleProviderChange('sandbox')}
                          className="font-medium underline underline-offset-2 hover:opacity-80"
                        >
                          Use Sandbox
                        </button>
                      </>
                    )}
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-zinc-300/90 bg-white transition-colors focus-within:border-zinc-500 dark:border-zinc-700 dark:bg-[#14161A] dark:focus-within:border-zinc-500">
                <label htmlFor="prompt-composer" className="sr-only">
                  Prompt message
                </label>
                <textarea
                  ref={composerRef}
                  id="prompt-composer"
                  rows={1}
                  value={composerText}
                  onChange={(e) => {
                    setComposerText(e.target.value);
                    if (validationError) setValidationError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Ask anything… (Enter to send)"
                  className="kestrel-scroll block max-h-[200px] w-full resize-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-relaxed text-zinc-950 placeholder:text-zinc-400 focus:outline-none dark:text-zinc-100 dark:placeholder:text-zinc-500"
                />

                <div className="flex items-center justify-between gap-1.5 px-2.5 pb-2.5 pt-1 sm:gap-2 sm:px-3">
                  <div className="flex min-w-0 items-center gap-1 sm:gap-1.5">
                    <button
                      type="button"
                      onClick={() =>
                        setParams((prev) => ({
                          ...prev,
                          browserSearch: !prev.browserSearch,
                          jsonMode:
                            !prev.browserSearch && providerId === 'sandbox'
                              ? false
                              : prev.jsonMode,
                        }))
                      }
                      aria-pressed={params.browserSearch}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors sm:gap-1.5 sm:px-2.5 ${
                        params.browserSearch
                          ? 'bg-[#E04F26]/12 text-[#C8401B] dark:bg-[#F0643C]/20 dark:text-[#FF9678]'
                          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                      }`}
                    >
                      <Globe className="h-3.5 w-3.5 shrink-0" />
                      <span>Search</span>
                    </button>

                    <button
                      type="button"
                      disabled={
                        providerId === 'anthropic' ||
                        (providerId === 'sandbox' && params.browserSearch)
                      }
                      onClick={() =>
                        setParams((prev) => ({ ...prev, jsonMode: !prev.jsonMode }))
                      }
                      aria-pressed={params.jsonMode}
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium whitespace-nowrap transition-colors disabled:cursor-not-allowed disabled:opacity-40 sm:gap-1.5 sm:px-2.5 ${
                        params.jsonMode
                          ? 'bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-950'
                          : 'text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100'
                      }`}
                    >
                      <Braces className="h-3.5 w-3.5 shrink-0" />
                      <span>JSON</span>
                    </button>

                    <span
                      title={promptShot?.reason ?? 'Estimated input tokens'}
                      className="inline-flex min-w-0 items-center gap-1 truncate pl-0.5 font-mono text-[11px] text-zinc-500 tabular-nums whitespace-nowrap sm:gap-1.5 sm:pl-1.5 dark:text-zinc-400"
                    >
                      <span>~{estimateTokens(composerText)} tok</span>
                      {promptShot && (
                        <>
                          <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                            ·
                          </span>
                          <span
                            className={
                              promptShot.type === 'few-shot'
                                ? 'text-[#E04F26] dark:text-[#F0643C]'
                                : promptShot.type === 'one-shot'
                                  ? 'text-zinc-700 dark:text-zinc-200'
                                  : 'text-zinc-500 dark:text-zinc-400'
                            }
                          >
                            {promptShot.label}
                          </span>
                        </>
                      )}
                    </span>
                  </div>

                  {isStreaming ? (
                    <button
                      key="stop-btn"
                      type="button"
                      onClick={stopGeneration}
                      aria-label="Stop generating"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap transition-colors hover:bg-zinc-700 sm:px-3.5 dark:bg-zinc-100 dark:text-zinc-950 dark:hover:bg-zinc-200"
                    >
                      <Square className="h-3 w-3 fill-current" />
                      <span>Stop</span>
                    </button>
                  ) : (
                    <button
                      key="run-btn"
                      type="button"
                      onClick={handleSend}
                      aria-label="Send prompt"
                      className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-[#E04F26] px-3 py-1.5 text-xs font-medium text-white whitespace-nowrap transition-colors hover:bg-[#C8401B] focus-visible:ring-2 focus-visible:ring-[#E04F26]/40 focus-visible:outline-none sm:px-3.5 dark:bg-[#F0643C] dark:hover:bg-[#E04F26]"
                    >
                      <span>Run</span>
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </main>

        {/* Right Parameters Rail & Mobile Drawer */}
        <ParametersPanel
          providerId={providerId}
          modelId={modelId}
          customBaseUrl={customBaseUrl}
          customModelId={customModelId}
          params={params}
          activeKeyEntry={activeKeyEntry}
          hasAnySessionKey={keyCounts.session > 0}
          isOpenDesktop={isParamsOpenDesktop}
          isOpenMobile={isParamsOpenMobile}
          onCloseMobile={() => setIsParamsOpenMobile(false)}
          onProviderChange={handleProviderChange}
          onModelChange={setModelId}
          onCustomBaseUrlChange={setCustomBaseUrl}
          onCustomModelIdChange={setCustomModelId}
          onParamsChange={setParams}
          onResetDefaults={() => setParams(DEFAULT_PLAYGROUND_PARAMS)}
          onOpenApiKeyModal={() => setIsApiKeyModalOpen(true)}
          onClearSessionKeys={handleClearSessionKeys}
        />
      </div>

      {/* Modals */}
      <ApiKeyModal
        isOpen={isApiKeyModalOpen}
        initialProvider={providerId}
        customBaseUrl={customBaseUrl}
        keys={apiKeys}
        onClose={() => setIsApiKeyModalOpen(false)}
        onSaveKey={handleSaveKey}
        onRemoveKey={handleRemoveKey}
        onClearSessionKeys={handleClearSessionKeys}
        onClearAllKeys={handleClearAllKeys}
      />

      <CodeExportModal
        isOpen={isCodeModalOpen}
        providerId={providerId}
        modelId={effectiveModel}
        customBaseUrl={customBaseUrl}
        systemPrompt={systemPrompt}
        messages={messages}
        params={params}
        onClose={() => setIsCodeModalOpen(false)}
      />

      <SessionsModal
        isOpen={isSessionsModalOpen}
        sessions={savedSessions}
        activeSessionId={activeSessionId}
        onClose={() => setIsSessionsModalOpen(false)}
        onSaveCurrent={handleSaveCurrentSession}
        onLoadSession={handleLoadSession}
        onDeleteSession={handleDeleteSession}
      />
    </div>
  );
}
