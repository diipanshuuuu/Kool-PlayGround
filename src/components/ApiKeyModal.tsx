import { useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Eye,
  EyeOff,
  ExternalLink,
  HardDrive,
  KeyRound,
  Loader2,
  LogOut,
  ShieldCheck,
  Trash2,
  X,
} from 'lucide-react';
import { PROVIDERS, getProviderById } from '../lib/providers';
import {
  countConfiguredKeys,
  maskApiKey,
  validateKeyFormatHint,
} from '../lib/keyStorage';
import {
  isStaticFallbackResponse,
  verifyProviderKeyDirect,
} from '../lib/directClient';
import type { ApiKeyStore, KeyStorageMode, ProviderId } from '../lib/types';

interface ApiKeyModalProps {
  isOpen: boolean;
  initialProvider: ProviderId;
  customBaseUrl: string;
  keys: ApiKeyStore;
  onClose: () => void;
  onSaveKey: (provider: ProviderId, key: string, mode: KeyStorageMode) => void;
  onRemoveKey: (provider: ProviderId) => void;
  onClearSessionKeys: () => void;
  onClearAllKeys: () => void;
}

const BYOK_PROVIDERS = PROVIDERS.filter((p) => p.requiresKey);

export function ApiKeyModal({
  isOpen,
  initialProvider,
  customBaseUrl,
  keys,
  onClose,
  onSaveKey,
  onRemoveKey,
  onClearSessionKeys,
  onClearAllKeys,
}: ApiKeyModalProps) {
  const defaultTab: ProviderId =
    initialProvider === 'sandbox' ? 'groq' : initialProvider;

  const [selectedProvider, setSelectedProvider] = useState<ProviderId>(defaultTab);
  const [inputValue, setInputValue] = useState('');
  const [storageMode, setStorageMode] = useState<KeyStorageMode>('session');
  const [showKey, setShowKey] = useState(false);
  const [feedback, setFeedback] = useState<{
    tone: 'neutral' | 'success' | 'error';
    text: string;
  } | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const target = initialProvider === 'sandbox' ? 'groq' : initialProvider;
    setSelectedProvider(target);
    const existing = keys[target];
    setInputValue(existing?.key ?? '');
    setStorageMode(existing?.mode ?? 'session');
    setShowKey(false);
    setFeedback(null);
    setIsVerifying(false);
  }, [isOpen, initialProvider]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const providerConfig = getProviderById(selectedProvider);
  const existingEntry = keys[selectedProvider];
  const counts = countConfiguredKeys(keys);
  const configuredEntries = BYOK_PROVIDERS.filter((p) => Boolean(keys[p.id]?.key));
  const formatHint = validateKeyFormatHint(selectedProvider, inputValue);

  const handleSelectProviderTab = (pid: ProviderId) => {
    setSelectedProvider(pid);
    const entry = keys[pid];
    setInputValue(entry?.key ?? '');
    setStorageMode(entry?.mode ?? 'session');
    setShowKey(false);
    setFeedback(null);
    setIsVerifying(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (!trimmed) {
      setFeedback({
        tone: 'error',
        text: 'Paste an API key first, or click Clear key to remove an existing one.',
      });
      return;
    }
    onSaveKey(selectedProvider, trimmed, storageMode);
    setFeedback({
      tone: 'success',
      text:
        storageMode === 'session'
          ? `${providerConfig.name} key active for this session only (clears on refresh or session end).`
          : `${providerConfig.name} key saved locally in this browser.`,
    });
  };

  const handleVerifyKey = async () => {
    const candidate = inputValue.trim() || existingEntry?.key || '';
    if (!candidate) {
      setFeedback({
        tone: 'error',
        text: 'Paste an API key before running a connection check.',
      });
      return;
    }

    setIsVerifying(true);
    setFeedback(null);

    try {
      const resp = await fetch('/api/proxy/verify-key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-provider-api-key': candidate,
        },
        body: JSON.stringify({
          provider: selectedProvider,
          customBaseUrl: selectedProvider === 'custom' ? customBaseUrl : undefined,
        }),
      });

      if (isStaticFallbackResponse(resp)) {
        const directResult = await verifyProviderKeyDirect({
          provider: selectedProvider,
          apiKey: candidate,
          customBaseUrl: selectedProvider === 'custom' ? customBaseUrl : undefined,
        });
        if (directResult.ok) {
          setFeedback({
            tone: 'success',
            text: `${providerConfig.name} key verified directly with provider.`,
          });
        } else {
          setFeedback({
            tone: 'error',
            text: directResult.error || 'Provider rejected this key.',
          });
        }
        return;
      }

      const data = (await resp.json()) as { ok?: boolean; message?: string; error?: string };
      if (data.ok) {
        setFeedback({
          tone: 'success',
          text: `${providerConfig.name} key verified with provider.`,
        });
      } else {
        setFeedback({
          tone: 'error',
          text: data.error || 'Provider rejected this key.',
        });
      }
    } catch {
      const directResult = await verifyProviderKeyDirect({
        provider: selectedProvider,
        apiKey: candidate,
        customBaseUrl: selectedProvider === 'custom' ? customBaseUrl : undefined,
      });
      if (directResult.ok) {
        setFeedback({
          tone: 'success',
          text: `${providerConfig.name} key verified directly with provider.`,
        });
      } else {
        setFeedback({
          tone: 'error',
          text: directResult.error || 'Could not reach verification endpoint. Check your connection.',
        });
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleRemoveCurrent = () => {
    onRemoveKey(selectedProvider);
    setInputValue('');
    setStorageMode('session');
    setFeedback({ tone: 'neutral', text: `${providerConfig.name} key removed.` });
  };

  const handleEndSession = () => {
    onClearSessionKeys();
    if (existingEntry?.mode === 'session') {
      setInputValue('');
      setStorageMode('session');
    }
    setFeedback({
      tone: 'neutral',
      text: 'All temporary session keys cleared from memory. Browser-saved keys remain intact.',
    });
  };

  const handleClearAll = () => {
    onClearAllKeys();
    setInputValue('');
    setStorageMode('session');
    setFeedback({
      tone: 'neutral',
      text: 'All API keys cleared from memory and browser storage.',
    });
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="api-key-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-[#111215]">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <KeyRound className="h-4 w-4 text-[#E04F26] dark:text-[#F0643C]" />
            <h2
              id="api-key-modal-title"
              className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50"
            >
              API Key Vault
            </h2>
          </div>
          <div className="flex items-center gap-2">
            {counts.session > 0 && (
              <button
                type="button"
                onClick={handleEndSession}
                className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 whitespace-nowrap transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
              >
                <LogOut className="h-3.5 w-3.5" />
                <span>End session ({counts.session})</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close API keys dialog"
              className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Provider Selector Tabs */}
        <div className="shrink-0 border-b border-zinc-200 bg-zinc-50/70 px-6 py-2.5 dark:border-zinc-800 dark:bg-[#0E0F12]">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="API key providers">
            {BYOK_PROVIDERS.map((p) => {
              const entry = keys[p.id];
              const isActive = selectedProvider === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => handleSelectProviderTab(p.id)}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                    isActive
                      ? 'bg-white text-zinc-950 shadow-xs ring-1 ring-zinc-200 dark:bg-[#1B1D22] dark:text-zinc-50 dark:ring-zinc-700'
                      : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  <span>{p.shortName}</span>
                  {entry && (
                    <span className="font-mono text-[10px] text-[#E04F26] dark:text-[#F0643C]">
                      {entry.mode === 'local' ? 'Saved' : 'Session'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        {/* Scrollable Body */}
        <form onSubmit={handleSubmit} className="kestrel-scroll flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Storage Mode Selector */}
          <div>
            <span className="mb-2 block text-xs font-medium text-zinc-700 dark:text-zinc-300">
              Key persistence mode
            </span>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setStorageMode('session')}
                aria-pressed={storageMode === 'session'}
                className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                  storageMode === 'session'
                    ? 'border-[#E04F26] bg-[#E04F26]/[0.05] dark:border-[#F0643C] dark:bg-[#F0643C]/10'
                    : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
                }`}
              >
                <Clock
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    storageMode === 'session'
                      ? 'text-[#E04F26] dark:text-[#F0643C]'
                      : 'text-zinc-400'
                  }`}
                />
                <div>
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Session only
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    Kept in memory only. Cleared immediately on browser refresh or session end.
                  </p>
                </div>
              </button>

              <button
                type="button"
                onClick={() => setStorageMode('local')}
                aria-pressed={storageMode === 'local'}
                className={`flex items-start gap-2.5 rounded-lg border p-3 text-left transition-colors ${
                  storageMode === 'local'
                    ? 'border-[#E04F26] bg-[#E04F26]/[0.05] dark:border-[#F0643C] dark:bg-[#F0643C]/10'
                    : 'border-zinc-200 hover:border-zinc-300 dark:border-zinc-800 dark:hover:border-zinc-700'
                }`}
              >
                <HardDrive
                  className={`mt-0.5 h-4 w-4 shrink-0 ${
                    storageMode === 'local'
                      ? 'text-[#E04F26] dark:text-[#F0643C]'
                      : 'text-zinc-400'
                  }`}
                />
                <div>
                  <div className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                    Save in this browser
                  </div>
                  <p className="mt-0.5 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
                    Stored locally in browser storage so it stays ready across visits.
                  </p>
                </div>
              </button>
            </div>
          </div>

          {/* Key Input + Verify */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label
                htmlFor="provider-api-key-input"
                className="text-xs font-medium text-zinc-700 dark:text-zinc-300"
              >
                {providerConfig.name} API key
              </label>
              {providerConfig.docsUrl && (
                <a
                  href={providerConfig.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-zinc-500 transition-colors hover:text-[#E04F26] dark:text-zinc-400 dark:hover:text-[#F0643C]"
                >
                  <span>Get key</span>
                  <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>

            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <input
                  id="provider-api-key-input"
                  type={showKey ? 'text' : 'password'}
                  autoFocus
                  value={inputValue}
                  onChange={(e) => {
                    setInputValue(e.target.value);
                    if (feedback) setFeedback(null);
                  }}
                  placeholder={`Paste ${providerConfig.name} key (${providerConfig.keyPrefixHint})`}
                  autoComplete="off"
                  spellCheck={false}
                  className="w-full rounded-lg border border-zinc-300 bg-white py-2.5 pr-10 pl-3 font-mono text-sm text-zinc-900 placeholder:text-zinc-400 focus:border-[#E04F26] focus:ring-2 focus:ring-[#E04F26]/20 focus:outline-none dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-[#F0643C]"
                />
                <button
                  type="button"
                  onClick={() => setShowKey((prev) => !prev)}
                  aria-label={showKey ? 'Hide API key' : 'Show API key'}
                  className="absolute top-1/2 right-2.5 -translate-y-1/2 rounded p-1 text-zinc-400 transition-colors hover:text-zinc-700 dark:hover:text-zinc-200"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>

              <button
                type="button"
                onClick={handleVerifyKey}
                disabled={isVerifying || !inputValue.trim()}
                className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-2.5 text-xs font-medium text-zinc-700 whitespace-nowrap transition-colors hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-45 dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {isVerifying ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    <span>Checking…</span>
                  </>
                ) : (
                  <span>Verify key</span>
                )}
              </button>
            </div>

            {formatHint.warning && (
              <p className="mt-1.5 flex items-center gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{formatHint.warning}</span>
              </p>
            )}

            {existingEntry && (
              <p className="mt-1.5 font-mono text-xs text-zinc-500 dark:text-zinc-400">
                Active: {maskApiKey(existingEntry.key)} ·{' '}
                {existingEntry.mode === 'local'
                  ? 'Saved in browser storage'
                  : 'Session memory only'}
              </p>
            )}
          </div>

          {feedback && (
            <div
              role="status"
              className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${
                feedback.tone === 'success'
                  ? 'border-emerald-200 bg-emerald-50/70 text-emerald-900 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
                  : feedback.tone === 'error'
                    ? 'border-red-200 bg-red-50/70 text-red-800 dark:border-red-900/60 dark:bg-red-950/30 dark:text-red-300'
                    : 'border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-[#181A1F] dark:text-zinc-300'
              }`}
            >
              {feedback.tone === 'success' && (
                <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
              )}
              {feedback.tone === 'error' && (
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-600 dark:text-red-400" />
              )}
              <span>{feedback.text}</span>
            </div>
          )}

          {/* Configured Keys Overview */}
          {configuredEntries.length > 0 && (
            <div className="border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <div className="mb-2 flex items-center justify-between text-xs">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  Configured keys ({counts.total})
                </span>
                <span className="font-mono text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
                  {counts.session} session · {counts.local} saved
                </span>
              </div>
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800/80 dark:border-zinc-800">
                {configuredEntries.map((p) => {
                  const entry = keys[p.id]!;
                  const nextMode: KeyStorageMode =
                    entry.mode === 'local' ? 'session' : 'local';
                  return (
                    <li
                      key={p.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 text-xs"
                    >
                      <div className="min-w-0">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {p.shortName}
                        </span>
                        <span aria-hidden="true" className="mx-1.5 text-zinc-300 dark:text-zinc-700">
                          ·
                        </span>
                        <span className="font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                          {maskApiKey(entry.key)}
                        </span>
                        <span aria-hidden="true" className="mx-1.5 text-zinc-300 dark:text-zinc-700">
                          ·
                        </span>
                        <span className="text-[11px] text-zinc-600 dark:text-zinc-400">
                          {entry.mode === 'local' ? 'Browser storage' : 'Session only'}
                        </span>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            onSaveKey(p.id, entry.key, nextMode);
                            if (p.id === selectedProvider) {
                              setStorageMode(nextMode);
                            }
                          }}
                          className="text-[11px] font-medium text-zinc-600 underline underline-offset-2 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
                        >
                          {entry.mode === 'local' ? 'Make session-only' : 'Save locally'}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            onRemoveKey(p.id);
                            if (p.id === selectedProvider) {
                              setInputValue('');
                              setStorageMode('session');
                            }
                          }}
                          aria-label={`Remove ${p.shortName} key`}
                          className="rounded p-1 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-red-600 dark:hover:bg-zinc-800 dark:hover:text-red-400"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {/* Privacy Guarantee */}
          <div className="flex items-start gap-2.5 rounded-lg border border-zinc-200/80 bg-zinc-50/70 px-3.5 py-2.5 text-xs text-zinc-600 dark:border-zinc-800 dark:bg-[#14161A] dark:text-zinc-400">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-zinc-500 dark:text-zinc-400" />
            <p className="leading-relaxed">
              Keys stay strictly in your browser. Session keys live only in memory and clear automatically on refresh or when you click End session.
            </p>
          </div>

          {/* Footer Actions */}
          <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              {existingEntry && (
                <button
                  type="button"
                  onClick={handleRemoveCurrent}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Clear {providerConfig.shortName} key</span>
                </button>
              )}
              {counts.total > 1 && (
                <button
                  type="button"
                  onClick={handleClearAll}
                  className="rounded-lg px-2.5 py-2 text-xs font-medium text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                >
                  Clear all keys
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-lg px-3.5 py-2 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
              >
                Done
              </button>
              <button
                type="submit"
                className="rounded-lg bg-[#E04F26] px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-[#C8401B] focus-visible:ring-2 focus-visible:ring-[#E04F26]/40 focus-visible:outline-none dark:bg-[#F0643C] dark:hover:bg-[#E04F26]"
              >
                {storageMode === 'session' ? 'Use for session' : 'Save key locally'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
