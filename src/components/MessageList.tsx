import { useState } from 'react';
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  KeyRound,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { PROMPT_STARTERS, getProviderById } from '../lib/providers';
import { formatElapsedMs, formatTokensPerSec } from '../lib/streamParser';
import type { ChatMessage, ProviderId } from '../lib/types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  liveStatus: string | null;
  providerId: ProviderId;
  hasActiveKey: boolean;
  onSelectStarter: (prompt: string, opts?: { enableSearch?: boolean; enableJson?: boolean }) => void;
  onDeleteMessage: (id: string) => void;
  onEditUserMessage: (id: string, newContent: string) => void;
  onRegenerateLast: () => void;
  onOpenApiKeys: () => void;
  onSwitchToSandbox: () => void;
  onUseOwnKey: () => void;
}

function getHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function ThinkingDisclosure({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3 rounded-lg border border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-[#14161A]">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        <span>Reasoning trace</span>
      </button>
      {open && (
        <div className="border-t border-zinc-200 px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          {text}
        </div>
      )}
    </div>
  );
}

export function MessageList({
  messages,
  isStreaming,
  liveStatus,
  providerId,
  hasActiveKey,
  onSelectStarter,
  onDeleteMessage,
  onEditUserMessage,
  onRegenerateLast,
  onOpenApiKeys,
  onSwitchToSandbox,
  onUseOwnKey,
}: MessageListProps) {
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');

  const handleCopy = async (id: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId((curr) => (curr === id ? null : curr)), 1600);
    } catch {
      // Ignore clipboard failures
    }
  };

  if (messages.length === 0) {
    const provider = getProviderById(providerId);
    return (
      <div className="mx-auto flex h-full w-full max-w-3xl flex-col justify-center px-5 py-10">
        <div className="max-w-xl">
          <h1 className="font-display text-2xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-[28px] dark:text-zinc-50">
            Distraction-free prompt testing
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
            Use your own API key for a single session (clears on refresh) or save it locally in your browser. Adjust sampling controls, toggle browser search, and export runnable code.
          </p>

          {provider.requiresKey && !hasActiveKey && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={onOpenApiKeys}
                className="inline-flex items-center gap-2 rounded-lg bg-[#E04F26] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#C8401B] dark:bg-[#F0643C] dark:hover:bg-[#E04F26]"
              >
                <KeyRound className="h-3.5 w-3.5" />
                <span>Paste {provider.shortName} API key</span>
              </button>
              <button
                type="button"
                onClick={onSwitchToSandbox}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                <span>Or try Built-in Sandbox without a key</span>
              </button>
            </div>
          )}
        </div>

        <div className="mt-9">
          <p className="mb-3 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Quick prompts
          </p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {PROMPT_STARTERS.map((starter) => (
              <button
                key={starter.label}
                type="button"
                onClick={() =>
                  onSelectStarter(starter.prompt, {
                    enableSearch: starter.enableSearch,
                    enableJson: starter.enableJson,
                  })
                }
                className="group rounded-lg border border-zinc-200 bg-white p-3.5 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50/70 dark:border-zinc-800 dark:bg-[#111215] dark:hover:border-zinc-700 dark:hover:bg-[#16181D]"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    {starter.label}
                  </span>
                  {starter.enableSearch && (
                    <span className="font-mono text-[11px] text-[#E04F26] dark:text-[#F0643C]">
                      Web search
                    </span>
                  )}
                  {starter.enableJson && (
                    <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      JSON
                    </span>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                  {starter.prompt}
                </p>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl divide-y divide-zinc-200/80 px-5 py-4 dark:divide-zinc-800/80">
      {messages.map((message, index) => {
        const isLast = index === messages.length - 1;
        const isAssistant = message.role === 'assistant';
        const isEditing = editingId === message.id;
        const providerLabel = message.providerUsed
          ? getProviderById(message.providerUsed).shortName
          : '';

        return (
          <article key={message.id} className="group py-5 first:pt-2">
            {/* Message Header */}
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2 text-xs">
                <span className="font-display font-semibold text-zinc-900 dark:text-zinc-100">
                  {isAssistant ? 'Assistant' : 'User'}
                </span>
                {isAssistant && message.modelUsed && (
                  <>
                    <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                      ·
                    </span>
                    <span className="truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {providerLabel ? `${providerLabel} / ` : ''}
                      {message.modelUsed}
                    </span>
                  </>
                )}
              </div>

              {/* Action Controls */}
              {!isEditing && (
                <div className="flex items-center gap-1 opacity-100 transition-opacity sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                  {!isAssistant && !isStreaming && (
                    <button
                      type="button"
                      onClick={() => {
                        setEditingId(message.id);
                        setEditDraft(message.content);
                      }}
                      aria-label="Edit message"
                      className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {isAssistant && isLast && !isStreaming && (
                    <button
                      type="button"
                      onClick={onRegenerateLast}
                      aria-label="Regenerate response"
                      className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      <RefreshCw className="h-3.5 w-3.5" />
                    </button>
                  )}

                  {message.content && (
                    <button
                      type="button"
                      onClick={() => handleCopy(message.id, message.content)}
                      aria-label="Copy message"
                      className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      {copiedId === message.id ? (
                        <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                      ) : (
                        <Copy className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}

                  {!isStreaming && (
                    <button
                      type="button"
                      onClick={() => onDeleteMessage(message.id)}
                      aria-label="Delete message"
                      className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800 dark:hover:text-red-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Body */}
            {isEditing ? (
              <div className="space-y-2">
                <textarea
                  value={editDraft}
                  onChange={(e) => setEditDraft(e.target.value)}
                  rows={3}
                  aria-label="Edit message content"
                  className="w-full rounded-lg border border-zinc-300 bg-white p-3 text-sm text-zinc-900 focus:border-[#E04F26] focus:outline-none dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-100"
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (editDraft.trim()) {
                        onEditUserMessage(message.id, editDraft.trim());
                      }
                      setEditingId(null);
                    }}
                    className="rounded-md bg-[#E04F26] px-3 py-1.5 text-xs font-medium text-white hover:bg-[#C8401B]"
                  >
                    Save & re-run
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingId(null)}
                    className="rounded-md px-3 py-1.5 text-xs font-medium text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div>
                {message.thinking && <ThinkingDisclosure text={message.thinking} />}

                {isAssistant && isStreaming && isLast && !message.content && !message.error && (
                  <div className="flex items-center gap-2 py-1 text-xs text-zinc-500 dark:text-zinc-400">
                    {liveStatus ? (
                      <>
                        <Globe className="h-3.5 w-3.5 text-[#E04F26] dark:text-[#F0643C]" />
                        <span>{liveStatus}</span>
                      </>
                    ) : (
                      <span>Generating response…</span>
                    )}
                  </div>
                )}

                {message.content &&
                  (isAssistant ? (
                    <MarkdownRenderer content={message.content} />
                  ) : (
                    <p className="text-[15px] leading-relaxed whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                      {message.content}
                    </p>
                  ))}

                {/* Error Block */}
                {message.error && (
                  <div
                    role="alert"
                    className="mt-2 rounded-lg border border-red-200 bg-red-50/80 p-3.5 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300"
                  >
                    <div className="flex items-start gap-2">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600 dark:text-red-400" />
                      <div className="min-w-0 flex-1 space-y-2">
                        <p className="font-medium leading-relaxed">{message.error}</p>
                        <div className="flex flex-wrap items-center gap-2">
                          {message.providerUsed === 'sandbox' ? (
                            <button
                              type="button"
                              onClick={onUseOwnKey}
                              className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-50 dark:border-red-800 dark:bg-[#181A1F] dark:text-red-300 dark:hover:bg-red-950/50"
                            >
                              Switch to Groq & paste API key
                            </button>
                          ) : (
                            <>
                              <button
                                type="button"
                                onClick={onOpenApiKeys}
                                className="rounded-md border border-red-300 bg-white px-2.5 py-1 text-xs font-medium text-red-800 hover:bg-red-50 dark:border-red-800 dark:bg-[#181A1F] dark:text-red-300 dark:hover:bg-red-950/50"
                              >
                                Manage API keys
                              </button>
                              <button
                                type="button"
                                onClick={onSwitchToSandbox}
                                className="rounded-md px-2.5 py-1 text-xs font-medium text-red-700 underline underline-offset-2 hover:text-red-900 dark:text-red-300"
                              >
                                Switch to Built-in Sandbox
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Web Search Sources */}
                {message.citations && message.citations.length > 0 && (
                  <div className="mt-4 border-t border-zinc-200/80 pt-3 dark:border-zinc-800/80">
                    <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                      <Globe className="h-3.5 w-3.5" />
                      <span>Sources ({message.citations.length})</span>
                    </div>
                    <ol className="space-y-1.5">
                      {message.citations.map((cite, idx) => (
                        <li key={`${cite.url}-${idx}`} className="text-xs">
                          <a
                            href={cite.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex max-w-full items-center gap-1.5 text-zinc-700 transition-colors hover:text-[#E04F26] dark:text-zinc-300 dark:hover:text-[#F0643C]"
                          >
                            <span className="font-mono text-[11px] text-zinc-400 tabular-nums">
                              [{idx + 1}]
                            </span>
                            <span className="truncate font-medium">{cite.title}</span>
                            <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                              ·
                            </span>
                            <span className="shrink-0 font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                              {getHostname(cite.url)}
                            </span>
                            <ExternalLink className="h-3 w-3 shrink-0 text-zinc-400" />
                          </a>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* Real Measured Response Metrics & Parameter Snapshot */}
                {isAssistant && (message.metrics || message.paramsSnapshot) && !message.error && (
                  <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
                    {message.metrics && (
                      <>
                        <span>{formatElapsedMs(message.metrics.elapsedMs)}</span>
                        {message.metrics.ttftMs !== undefined && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>TTFT {formatElapsedMs(message.metrics.ttftMs)}</span>
                          </>
                        )}
                        {message.metrics.completionTokens !== undefined &&
                          message.metrics.completionTokens > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                {message.metrics.totalTokens ?? message.metrics.completionTokens}{' '}
                                tokens
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {formatTokensPerSec(
                                  message.metrics.completionTokens,
                                  message.metrics.elapsedMs
                                )}
                              </span>
                            </>
                          )}
                      </>
                    )}
                    {message.paramsSnapshot && message.providerUsed !== 'sandbox' && (
                      <>
                        {message.metrics && <span aria-hidden="true">·</span>}
                        <span>
                          temp {message.paramsSnapshot.temperature} · top-p{' '}
                          {message.paramsSnapshot.topP} · max {message.paramsSnapshot.maxTokens}
                        </span>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}
          </article>
        );
      })}
    </div>
  );
}
