import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  Check,
  ChevronRight,
  Copy,
  ExternalLink,
  Globe,
  Pencil,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { PROMPT_STARTERS, getProviderById } from '../lib/providers';
import {
  computeTokenCapacityProgress,
  estimateAssistantResponseStats,
  formatElapsedMs,
  formatTokensPerSec,
} from '../lib/streamParser';
import type { ChatMessage, ProviderId } from '../lib/types';
import { MarkdownRenderer } from './MarkdownRenderer';

interface MessageListProps {
  messages: ChatMessage[];
  isStreaming: boolean;
  liveStatus: string | null;
  providerId: ProviderId;
  hasActiveKey: boolean;
  maxTokens: number;
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
    <div className="mb-3 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50/70 dark:border-zinc-800 dark:bg-[#14161A]">
      <button
        type="button"
        onClick={() => setOpen((p) => !p)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-600 transition-colors hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
      >
        <ChevronRight
          className={`h-3.5 w-3.5 transition-transform duration-150 ${
            open ? 'rotate-90' : 'rotate-0'
          }`}
        />
        <span>Reasoning trace</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-t border-zinc-200 px-3 py-2.5 font-mono text-xs leading-relaxed whitespace-pre-wrap text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
              {text}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ResponseTokenEstimate({
  content,
  thinking,
  metrics,
}: {
  content: string;
  thinking?: string;
  metrics?: ChatMessage['metrics'];
}) {
  const stats = estimateAssistantResponseStats(content, thinking);
  if (stats.totalEstimatedTokens === 0) return null;

  const usageNote =
    metrics?.promptTokens !== undefined && metrics?.totalTokens !== undefined
      ? ` · API usage: ${metrics.completionTokens ?? stats.tokens} out / ${metrics.totalTokens} total tok`
      : '';

  return (
    <span
      data-testid="assistant-token-estimate"
      title={`${stats.tooltip}${usageNote}`}
      className="inline-flex items-center gap-1.5 text-zinc-600 dark:text-zinc-300"
    >
      <span>~{stats.tokens} tok</span>
      <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
        ·
      </span>
      <span>
        {stats.words} {stats.words === 1 ? 'word' : 'words'}
      </span>
    </span>
  );
}

function TokenCapacityBar({
  content,
  thinking,
  metrics,
  maxTokens,
  isActivelyStreaming,
}: {
  content: string;
  thinking?: string;
  metrics?: ChatMessage['metrics'];
  maxTokens: number;
  isActivelyStreaming: boolean;
}) {
  const stats = estimateAssistantResponseStats(content, thinking);
  const hasMeasuredCompletion =
    !isActivelyStreaming &&
    metrics?.completionTokens !== undefined &&
    metrics.completionTokens > 0;
  const usedTokens = hasMeasuredCompletion
    ? metrics.completionTokens!
    : stats.totalEstimatedTokens;

  if (!isActivelyStreaming && usedTokens === 0) return null;

  const progress = computeTokenCapacityProgress(usedTokens, maxTokens);
  if (!progress) return null;

  const barColor =
    progress.level === 'critical'
      ? 'bg-red-500 dark:bg-red-400'
      : progress.level === 'warning'
        ? 'bg-amber-500 dark:bg-amber-400'
        : isActivelyStreaming
          ? 'bg-[#E04F26] dark:bg-[#F0643C]'
          : 'bg-zinc-400 dark:bg-zinc-500';

  const prefix = hasMeasuredCompletion ? '' : '~';

  return (
    <div
      data-testid="assistant-token-progress"
      title={`Response length: ${prefix}${progress.usedTokens.toLocaleString()} of ${progress.maxTokens.toLocaleString()} max completion tokens (${progress.percent}%)`}
      className="mt-2 flex items-center gap-2.5"
    >
      <div
        role="progressbar"
        aria-label="Response token limit capacity"
        aria-valuenow={progress.usedTokens}
        aria-valuemin={0}
        aria-valuemax={progress.maxTokens}
        className="h-1 w-36 overflow-hidden rounded-full bg-zinc-200/80 sm:w-44 dark:bg-zinc-800/90"
      >
        <div
          className={`h-full rounded-full transition-[width,background-color] duration-200 ease-out ${barColor}`}
          style={{
            width: `${
              progress.percent > 0 ? Math.max(progress.percent, 2) : isActivelyStreaming ? 2 : 0
            }%`,
          }}
        />
      </div>
      <span className="font-mono text-[10px] text-zinc-400 tabular-nums dark:text-zinc-500">
        {prefix}
        {progress.usedTokens.toLocaleString()} / {progress.maxTokens.toLocaleString()} tok (
        {progress.percent}%)
      </span>
    </div>
  );
}

export function MessageList({
  messages,
  isStreaming,
  liveStatus,
  providerId,
  hasActiveKey,
  maxTokens,
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
      <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-3.5 py-6 sm:px-5 sm:py-10 lg:px-6 xl:max-w-4xl 2xl:max-w-5xl">
        <div className="my-auto">
          <div className="max-w-xl">
            <h1 className="font-display text-xl font-semibold tracking-tight text-balance text-zinc-950 sm:text-[26px] dark:text-zinc-50">
              Start a prompt
            </h1>
            <p className="mt-1.5 text-sm leading-relaxed text-zinc-600 dark:text-zinc-400">
              {provider.requiresKey && !hasActiveKey ? (
                <>
                  No {provider.shortName} key active yet —{' '}
                  <button
                    type="button"
                    onClick={onOpenApiKeys}
                    className="font-medium text-[#E04F26] underline underline-offset-2 transition-colors hover:text-[#C8401B] dark:text-[#F0643C] dark:hover:text-[#FF8561]"
                  >
                    open API Key Vault
                  </button>{' '}
                  or{' '}
                  <button
                    type="button"
                    onClick={onSwitchToSandbox}
                    className="font-medium text-zinc-800 underline underline-offset-2 transition-colors hover:text-zinc-950 dark:text-zinc-200 dark:hover:text-white"
                  >
                    switch to Sandbox
                  </button>
                  .
                </>
              ) : (
                `Running on ${provider.shortName}. Tune parameters in the rail, toggle web search, or pick a starter below.`
              )}
            </p>
          </div>

          <div className="mt-7">
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
                className="group rounded-lg border border-zinc-200 bg-white p-3.5 text-left transition-all duration-150 hover:-translate-y-0.5 hover:border-zinc-300 hover:bg-zinc-50/70 hover:shadow-xs active:translate-y-0 active:scale-[0.99] dark:border-zinc-800 dark:bg-[#111215] dark:hover:border-zinc-700 dark:hover:bg-[#16181D]"
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
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl divide-y divide-zinc-200/80 px-3.5 py-4 sm:px-5 lg:px-6 xl:max-w-4xl 2xl:max-w-5xl dark:divide-zinc-800/80">
      {messages.map((message, index) => {
        const isLast = index === messages.length - 1;
        const isAssistant = message.role === 'assistant';
        const isEditing = editingId === message.id;
        const providerLabel = message.providerUsed
          ? getProviderById(message.providerUsed).shortName
          : '';

        return (
          <motion.article
            key={message.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="group py-5 first:pt-2"
          >
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

                {/* Estimated Response Length, Measured Metrics & Parameter Snapshot */}
                {isAssistant &&
                  !message.error &&
                  (message.content.trim() ||
                    message.thinking?.trim() ||
                    message.metrics ||
                    message.paramsSnapshot) && (
                    <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
                      <ResponseTokenEstimate
                        content={message.content}
                        thinking={message.thinking}
                        metrics={message.metrics}
                      />
                      {message.metrics && (
                        <>
                          {(message.content.trim() || message.thinking?.trim()) && (
                            <span aria-hidden="true">·</span>
                          )}
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
                          {(message.content.trim() ||
                            message.thinking?.trim() ||
                            message.metrics) && <span aria-hidden="true">·</span>}
                          <span>
                            temp {message.paramsSnapshot.temperature} · top-p{' '}
                            {message.paramsSnapshot.topP} · max {message.paramsSnapshot.maxTokens}
                          </span>
                        </>
                      )}
                    </div>
                  )}

                {/* Token Limit Capacity Progress Bar */}
                {isAssistant && !message.error && (
                  <TokenCapacityBar
                    content={message.content}
                    thinking={message.thinking}
                    metrics={message.metrics}
                    maxTokens={message.paramsSnapshot?.maxTokens ?? maxTokens}
                    isActivelyStreaming={isStreaming && isLast}
                  />
                )}
              </div>
            )}
          </motion.article>
        );
      })}
    </div>
  );
}
