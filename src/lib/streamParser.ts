import type { AppSseEvent } from './types';

export interface ParsedOpenAIChunk {
  delta?: string;
  thinking?: string;
  done?: boolean;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export function parseOpenAISseLine(line: string): ParsedOpenAIChunk | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload) return null;
  if (payload === '[DONE]') {
    return { done: true };
  }

  try {
    const json = JSON.parse(payload) as {
      choices?: Array<{
        delta?: {
          content?: string | null;
          reasoning?: string | null;
          reasoning_content?: string | null;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
      x_groq?: {
        usage?: {
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
      };
    };

    const choice = json.choices?.[0];
    const delta = choice?.delta?.content ?? undefined;
    const thinking =
      choice?.delta?.reasoning ?? choice?.delta?.reasoning_content ?? undefined;

    const rawUsage = json.usage ?? json.x_groq?.usage;
    const usage = rawUsage
      ? {
          promptTokens: rawUsage.prompt_tokens,
          completionTokens: rawUsage.completion_tokens,
          totalTokens: rawUsage.total_tokens,
        }
      : undefined;

    if (!delta && !thinking && !usage) return null;
    return { delta, thinking, usage };
  } catch {
    return null;
  }
}

export function parseAnthropicSseLine(line: string): ParsedOpenAIChunk | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload) return null;

  try {
    const json = JSON.parse(payload) as {
      type?: string;
      delta?: {
        type?: string;
        text?: string;
        thinking?: string;
      };
      message?: {
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
        };
      };
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
      };
    };

    if (json.type === 'content_block_delta') {
      if (json.delta?.type === 'text_delta' && json.delta.text) {
        return { delta: json.delta.text };
      }
      if (json.delta?.type === 'thinking_delta' && json.delta.thinking) {
        return { thinking: json.delta.thinking };
      }
    }

    if (json.type === 'message_start' && json.message?.usage) {
      return {
        usage: {
          promptTokens: json.message.usage.input_tokens,
        },
      };
    }

    if (json.type === 'message_delta' && json.usage) {
      return {
        usage: {
          completionTokens: json.usage.output_tokens,
        },
      };
    }

    if (json.type === 'message_stop') {
      return { done: true };
    }

    return null;
  } catch {
    return null;
  }
}

export function parseAppSseLine(line: string): AppSseEvent | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('data:')) return null;
  const payload = trimmed.slice(5).trim();
  if (!payload) return null;
  try {
    return JSON.parse(payload) as AppSseEvent;
  } catch {
    return null;
  }
}

export function estimateTokens(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return Math.max(1, Math.ceil(cleaned.length / 4));
}

export function countWords(text: string): number {
  const cleaned = text.trim();
  if (!cleaned) return 0;
  return cleaned.split(/\s+/).length;
}

export interface AssistantResponseStats {
  tokens: number;
  words: number;
  thinkingTokens: number;
  totalEstimatedTokens: number;
  label: string;
  tooltip: string;
}

export function estimateAssistantResponseStats(
  content: string,
  thinking?: string
): AssistantResponseStats {
  const tokens = estimateTokens(content);
  const words = countWords(content);
  const thinkingTokens = thinking ? estimateTokens(thinking) : 0;
  const totalEstimatedTokens = tokens + thinkingTokens;
  const wordUnit = words === 1 ? 'word' : 'words';
  const label = `~${tokens} tok · ${words} ${wordUnit}`;
  const tooltip =
    thinkingTokens > 0
      ? `Estimated ~${tokens} response tokens + ~${thinkingTokens} reasoning tokens (${words} ${wordUnit})`
      : `Estimated ~${tokens} response tokens (${words} ${wordUnit})`;

  return {
    tokens,
    words,
    thinkingTokens,
    totalEstimatedTokens,
    label,
    tooltip,
  };
}

export function formatElapsedMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0.00s';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function formatTokensPerSec(tokens: number, elapsedMs: number): string {
  if (!Number.isFinite(tokens) || !Number.isFinite(elapsedMs) || elapsedMs <= 0 || tokens <= 0) {
    return '—';
  }
  const tps = tokens / (elapsedMs / 1000);
  if (tps >= 100) return `${Math.round(tps)} tok/s`;
  return `${tps.toFixed(1)} tok/s`;
}

export function formatProviderError(raw: unknown): string {
  let msg =
    raw instanceof Error
      ? raw.message
      : typeof raw === 'string'
        ? raw
        : 'Unexpected error while calling the model provider.';

  // Unwrap up to 3 levels of stringified JSON error wrappers (e.g. Google/OpenAI SDK errors)
  for (let depth = 0; depth < 3; depth++) {
    const trimmed = msg.trim();
    if (!trimmed.startsWith('{')) break;
    try {
      const parsed = JSON.parse(trimmed) as {
        error?: { message?: string; code?: number; status?: string } | string;
        message?: string;
      };
      if (typeof parsed.error === 'string') {
        msg = parsed.error;
      } else if (parsed.error && typeof parsed.error.message === 'string') {
        msg = parsed.error.message;
      } else if (typeof parsed.message === 'string') {
        msg = parsed.message;
      } else {
        break;
      }
    } catch {
      break;
    }
  }

  msg = msg.replace(/\s+/g, ' ').trim();

  if (/RESOURCE_EXHAUSTED|exceeded your current quota|429/i.test(msg)) {
    return 'Rate limit or quota exceeded (429). Wait a moment, check your provider billing quota, or switch providers and use your own API key.';
  }
  if (/API_KEY_INVALID|invalid_api_key|Incorrect API key|401/i.test(msg)) {
    return 'Authentication failed (401). Double-check that your API key is valid and matches the selected provider.';
  }
  if (/model_not_found|NOT_FOUND|does not exist/i.test(msg)) {
    return `Model not found: ${msg}`;
  }

  return msg || 'Request failed. Please check your provider settings and try again.';
}

