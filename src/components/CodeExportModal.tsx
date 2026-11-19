import { useEffect, useState } from 'react';
import { Check, Code2, Copy, X } from 'lucide-react';
import { generateCodeSnippet, type CodeLanguage } from '../lib/codeGen';
import type { ChatMessage, PlaygroundParams, ProviderId } from '../lib/types';

interface CodeExportModalProps {
  isOpen: boolean;
  providerId: ProviderId;
  modelId: string;
  customBaseUrl: string;
  systemPrompt: string;
  messages: ChatMessage[];
  params: PlaygroundParams;
  onClose: () => void;
}

const LANGUAGES: Array<{ id: CodeLanguage; label: string }> = [
  { id: 'curl', label: 'cURL' },
  { id: 'javascript', label: 'JavaScript' },
  { id: 'python', label: 'Python' },
];

export function CodeExportModal({
  isOpen,
  providerId,
  modelId,
  customBaseUrl,
  systemPrompt,
  messages,
  params,
  onClose,
}: CodeExportModalProps) {
  const [language, setLanguage] = useState<CodeLanguage>('curl');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const snippet = generateCodeSnippet({
    providerId,
    modelId,
    customBaseUrl,
    systemPrompt,
    messages,
    params,
    language,
  });

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      role="dialog"
      aria-modal="true"
      aria-labelledby="code-modal-title"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-xl dark:border-zinc-800 dark:bg-[#111215]">
        <div className="flex items-center justify-between border-b border-zinc-200 px-6 py-4 dark:border-zinc-800">
          <div className="flex items-center gap-2.5">
            <Code2 className="h-4 w-4 text-[#E04F26] dark:text-[#F0643C]" />
            <h2
              id="code-modal-title"
              className="font-display text-base font-semibold text-zinc-950 dark:text-zinc-50"
            >
              View Code
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close code export dialog"
            className="rounded-md p-1.5 text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center justify-between border-b border-zinc-200 bg-zinc-50/70 px-6 py-2.5 dark:border-zinc-800 dark:bg-[#0E0F12]">
          <div className="flex items-center gap-1" role="tablist" aria-label="Code language">
            {LANGUAGES.map((lang) => (
              <button
                key={lang.id}
                type="button"
                role="tab"
                aria-selected={language === lang.id}
                onClick={() => setLanguage(lang.id)}
                className={`rounded-md px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors ${
                  language === lang.id
                    ? 'bg-white text-zinc-950 shadow-xs ring-1 ring-zinc-200 dark:bg-[#1B1D22] dark:text-zinc-50 dark:ring-zinc-700'
                    : 'text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100'
                }`}
              >
                {lang.label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-800 transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-200 dark:hover:bg-zinc-800"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" />
                <span>Copy snippet</span>
              </>
            )}
          </button>
        </div>

        <div className="kestrel-scroll flex-1 overflow-auto bg-[#FAFAFA] p-5 dark:bg-[#0B0C0E]">
          <pre className="font-mono text-[13px] leading-relaxed text-zinc-900 dark:text-zinc-100">
            <code>{snippet}</code>
          </pre>
        </div>

        <div className="border-t border-zinc-200 px-6 py-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          API keys are always replaced with environment variable placeholders before export.
        </div>
      </div>
    </div>
  );
}
