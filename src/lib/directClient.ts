import {
  formatProviderError,
  parseAnthropicSseLine,
  parseOpenAISseLine,
} from './streamParser';
import type {
  AppSseEvent,
  PlaygroundParams,
  ProviderId,
  SearchCitation,
} from './types';

export interface DirectChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DirectRequestSpec {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  isAnthropic: boolean;
  usedNativeSearch: boolean;
}

/**
 * Detects when a `/api/*` request hit a static host's SPA rewrite (e.g. Firebase Hosting
 * returning `index.html` with 200 OK) or a 404/405 indicating no backend server is mounted.
 */
export function isStaticFallbackResponse(response: Response): boolean {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/html')) return true;
  if (response.status === 404 || response.status === 405) return true;
  return false;
}

export function resolveDirectProviderBaseUrl(
  provider: ProviderId,
  customBaseUrl?: string
): string | null {
  switch (provider) {
    case 'groq':
      return 'https://api.groq.com/openai/v1';
    case 'openai':
      return 'https://api.openai.com/v1';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1';
    case 'anthropic':
      return 'https://api.anthropic.com/v1';
    case 'custom': {
      const cleaned = (customBaseUrl ?? '').trim().replace(/\/+$/, '');
      if (!cleaned) return null;
      try {
        const parsed = new URL(cleaned);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return cleaned;
      } catch {
        return null;
      }
    }
    default:
      return null;
  }
}

export function buildDirectProviderRequest(args: {
  provider: ProviderId;
  apiKey: string;
  model: string;
  customBaseUrl?: string;
  systemPrompt?: string;
  messages: DirectChatMessage[];
  params: PlaygroundParams;
}): DirectRequestSpec {
  const { provider, apiKey, model, customBaseUrl, systemPrompt, messages, params } = args;
  const baseUrl = resolveDirectProviderBaseUrl(provider, customBaseUrl);
  if (!baseUrl) {
    throw new Error('Invalid provider or custom base URL.');
  }

  const trimmedSystem = (systemPrompt ?? '').trim();

  if (provider === 'anthropic') {
    const body: Record<string, unknown> = {
      model,
      max_tokens: Number(params.maxTokens) || 2048,
      stream: params.stream !== false,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
    };

    if (trimmedSystem) {
      body.system = trimmedSystem;
    }
    if (typeof params.temperature === 'number') {
      body.temperature = Math.min(1, Math.max(0, params.temperature));
    }
    if (typeof params.topP === 'number' && params.topP < 1) {
      body.top_p = params.topP;
    }
    if (Array.isArray(params.stopSequences) && params.stopSequences.length > 0) {
      body.stop_sequences = params.stopSequences.slice(0, 4);
    }

    return {
      url: `${baseUrl}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body,
      isAnthropic: true,
      usedNativeSearch: false,
    };
  }

  // OpenAI-compatible (Groq, OpenAI, OpenRouter, Custom)
  const isGptOssOnGroq = provider === 'groq' && model.startsWith('openai/gpt-oss');
  const isGroqCompound = provider === 'groq' && model.startsWith('groq/compound');
  const supportsNativeSearch = isGptOssOnGroq || isGroqCompound;
  const isOSeriesOpenAI = provider === 'openai' && /^o\d/i.test(model);

  const outboundMessages: Array<{ role: string; content: string }> = [];
  if (trimmedSystem) {
    outboundMessages.push({ role: 'system', content: trimmedSystem });
  }
  for (const m of messages) {
    outboundMessages.push({ role: m.role, content: m.content });
  }

  const body: Record<string, unknown> = {
    model,
    messages: outboundMessages,
    stream: params.stream !== false,
  };

  if (params.stream !== false && (provider === 'openai' || provider === 'openrouter')) {
    body.stream_options = { include_usage: true };
  }

  if (typeof params.maxTokens === 'number' && params.maxTokens > 0) {
    if (provider === 'groq' || isOSeriesOpenAI) {
      body.max_completion_tokens = params.maxTokens;
    } else {
      body.max_tokens = params.maxTokens;
    }
  }

  if (!isOSeriesOpenAI) {
    if (typeof params.temperature === 'number') {
      body.temperature = Math.min(2, Math.max(0, params.temperature));
    }
    if (typeof params.topP === 'number') {
      body.top_p = Math.min(1, Math.max(0.01, params.topP));
    }
    if (typeof params.frequencyPenalty === 'number' && params.frequencyPenalty !== 0) {
      body.frequency_penalty = params.frequencyPenalty;
    }
    if (typeof params.presencePenalty === 'number' && params.presencePenalty !== 0) {
      body.presence_penalty = params.presencePenalty;
    }
  }

  if (params.seed && /^-?\d+$/.test(params.seed.trim())) {
    body.seed = Number.parseInt(params.seed.trim(), 10);
  }

  if (Array.isArray(params.stopSequences) && params.stopSequences.length > 0) {
    body.stop = params.stopSequences.slice(0, 4);
  }

  if (params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }

  if (params.reasoningEffort && params.reasoningEffort !== 'default') {
    body.reasoning_effort = params.reasoningEffort;
  }

  let usedNativeSearch = false;
  if (params.browserSearch && isGptOssOnGroq) {
    body.tools = [{ type: 'browser_search' }];
    usedNativeSearch = true;
  } else if (params.browserSearch && isGroqCompound) {
    usedNativeSearch = true;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };

  if (provider === 'openrouter') {
    if (typeof window !== 'undefined' && window.location?.origin) {
      headers['HTTP-Referer'] = window.location.origin;
    }
    headers['X-Title'] = 'Kurukshetra Playground';
  }

  return {
    url: `${baseUrl}/chat/completions`,
    headers,
    body,
    isAnthropic: false,
    usedNativeSearch,
  };
}

export async function verifyProviderKeyDirect(args: {
  provider: ProviderId;
  apiKey: string;
  customBaseUrl?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const { provider, apiKey, customBaseUrl } = args;
  const baseUrl = resolveDirectProviderBaseUrl(provider, customBaseUrl);
  if (!baseUrl) {
    return { ok: false, error: 'Enter a valid http(s) Base URL before verifying.' };
  }

  try {
    if (provider === 'anthropic') {
      const resp = await fetch(`${baseUrl}/models`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true',
        },
      });
      if (resp.ok) return { ok: true };
      const errText = await resp.text().catch(() => '');
      return {
        ok: false,
        error: formatProviderError(errText || `Anthropic rejected key (${resp.status}).`),
      };
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${apiKey}`,
    };
    if (provider === 'openrouter') {
      if (typeof window !== 'undefined' && window.location?.origin) {
        headers['HTTP-Referer'] = window.location.origin;
      }
      headers['X-Title'] = 'Kurukshetra Playground';
    }

    const resp = await fetch(`${baseUrl}/models`, { method: 'GET', headers });
    if (resp.ok) return { ok: true };
    const errText = await resp.text().catch(() => '');
    return {
      ok: false,
      error: formatProviderError(errText || `Provider returned HTTP ${resp.status}.`),
    };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `${err.message} (If using a custom endpoint without browser CORS enabled, deploy with Firebase App Hosting or run locally via npm run dev.)`
          : 'Could not reach provider API directly from browser.',
    };
  }
}

export async function streamDirectProviderChat(args: {
  provider: ProviderId;
  apiKey: string;
  model: string;
  customBaseUrl?: string;
  systemPrompt?: string;
  messages: DirectChatMessage[];
  params: PlaygroundParams;
  signal: AbortSignal;
  onEvent: (event: AppSseEvent) => void;
}): Promise<void> {
  const { onEvent, signal } = args;
  const spec = buildDirectProviderRequest(args);

  if (args.params.browserSearch && !spec.usedNativeSearch) {
    onEvent({
      type: 'status',
      status: 'Running directly from browser (native search requires GPT-OSS / Compound or backend)…',
    });
  } else if (spec.usedNativeSearch) {
    onEvent({ type: 'status', status: 'Searching the web via provider…' });
  }

  const upstream = await fetch(spec.url, {
    method: 'POST',
    headers: spec.headers,
    body: JSON.stringify(spec.body),
    signal,
  });

  if (!upstream.ok) {
    const rawErr = await upstream.text().catch(() => '');
    onEvent({
      type: 'error',
      error: formatProviderError(rawErr || `Provider returned HTTP ${upstream.status}`),
    });
    return;
  }

  // Non-streaming response path
  if (args.params.stream === false) {
    if (spec.isAnthropic) {
      const json = (await upstream.json()) as {
        content?: Array<{ type: string; text?: string; thinking?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      for (const block of json.content ?? []) {
        if (block.type === 'thinking' && block.thinking) {
          onEvent({ type: 'thinking', text: block.thinking });
        } else if (block.type === 'text' && block.text) {
          onEvent({ type: 'delta', text: block.text });
        }
      }
      if (json.usage) {
        onEvent({
          type: 'usage',
          usage: {
            promptTokens: json.usage.input_tokens,
            completionTokens: json.usage.output_tokens,
            totalTokens: (json.usage.input_tokens ?? 0) + (json.usage.output_tokens ?? 0),
          },
        });
      }
      onEvent({ type: 'done' });
      return;
    }

    const json = (await upstream.json()) as {
      choices?: Array<{
        message?: {
          content?: string;
          reasoning?: string;
          executed_tools?: Array<{
            search_results?: {
              results?: Array<{ title?: string; url?: string; content?: string }>;
            };
          }>;
        };
      }>;
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };

    const msg = json.choices?.[0]?.message;
    if (msg?.reasoning) onEvent({ type: 'thinking', text: msg.reasoning });
    if (msg?.content) onEvent({ type: 'delta', text: msg.content });

    const toolCitations: SearchCitation[] = [];
    for (const tool of msg?.executed_tools ?? []) {
      for (const r of tool.search_results?.results ?? []) {
        if (r.url) {
          toolCitations.push({
            title: r.title || r.url,
            url: r.url,
            snippet: r.content?.slice(0, 180),
          });
        }
      }
    }
    if (toolCitations.length > 0) {
      onEvent({ type: 'citations', citations: toolCitations });
    }

    if (json.usage) {
      onEvent({
        type: 'usage',
        usage: {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
        },
      });
    }
    onEvent({ type: 'done' });
    return;
  }

  // Streaming SSE path
  const reader = upstream.body?.getReader();
  if (!reader) {
    onEvent({ type: 'error', error: 'Upstream provider did not return a readable stream.' });
    return;
  }

  const decoder = new TextDecoder();
  let buffer = '';
  let promptTokens: number | undefined;
  let completionTokens: number | undefined;
  let totalTokens: number | undefined;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      const parsed = spec.isAnthropic
        ? parseAnthropicSseLine(line)
        : parseOpenAISseLine(line);
      if (!parsed) continue;
      if (parsed.thinking) onEvent({ type: 'thinking', text: parsed.thinking });
      if (parsed.delta) onEvent({ type: 'delta', text: parsed.delta });
      if (parsed.usage) {
        if (parsed.usage.promptTokens !== undefined) promptTokens = parsed.usage.promptTokens;
        if (parsed.usage.completionTokens !== undefined) {
          completionTokens = parsed.usage.completionTokens;
        }
        if (parsed.usage.totalTokens !== undefined) totalTokens = parsed.usage.totalTokens;
      }
    }
  }

  if (promptTokens !== undefined || completionTokens !== undefined || totalTokens !== undefined) {
    onEvent({
      type: 'usage',
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: totalTokens ?? (promptTokens ?? 0) + (completionTokens ?? 0),
      },
    });
  }
  onEvent({ type: 'done' });
}
