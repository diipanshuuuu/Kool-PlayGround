import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import {
  formatProviderError,
  parseAnthropicSseLine,
  parseOpenAISseLine,
} from './src/lib/streamParser.ts';
import { normalizeProviderModels } from './src/lib/modelDiscovery.ts';
import type {
  AppSseEvent,
  PlaygroundParams,
  ProviderId,
  SearchCitation,
} from './src/lib/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

function createGeminiClient(): GoogleGenAI {
  return new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sendSse(res: Response, event: AppSseEvent): void {
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

function decodeHtmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function unwrapDuckDuckGoUrl(rawHref: string): string {
  try {
    if (rawHref.startsWith('//')) {
      rawHref = `https:${rawHref}`;
    }
    const parsed = new URL(rawHref, 'https://duckduckgo.com');
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) return decodeURIComponent(uddg);
    return parsed.toString();
  } catch {
    return rawHref;
  }
}

async function performLiveWebSearch(
  rawQuery: string,
  maxResults = 5
): Promise<SearchCitation[]> {
  const query = rawQuery.trim().slice(0, 260);
  if (!query) return [];

  const results: SearchCitation[] = [];

  // Primary: DuckDuckGo HTML search (no API key required)
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);
    const resp = await fetch(
      `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: controller.signal,
      }
    );
    clearTimeout(timeout);

    if (resp.ok) {
      const html = await resp.text();
      const linkRegex =
        /<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi;
      const snippetRegex =
        /<a[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>|<div[^>]*class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;

      const links: Array<{ url: string; title: string }> = [];
      let m: RegExpExecArray | null;
      while ((m = linkRegex.exec(html)) !== null && links.length < maxResults) {
        const url = unwrapDuckDuckGoUrl(m[1]);
        const title = decodeHtmlEntities(m[2]);
        if (title && url.startsWith('http')) {
          links.push({ url, title });
        }
      }

      const snippets: string[] = [];
      while ((m = snippetRegex.exec(html)) !== null && snippets.length < maxResults) {
        snippets.push(decodeHtmlEntities(m[1] || m[2] || ''));
      }

      for (let i = 0; i < links.length; i++) {
        results.push({
          title: links[i].title,
          url: links[i].url,
          snippet: snippets[i] || undefined,
        });
      }
    }
  } catch {
    // Fallback below
  }

  // Fallback: Wikipedia search API if DuckDuckGo was blocked or empty
  if (results.length === 0) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6000);
      const wikiResp = await fetch(
        `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(
          query
        )}&utf8=&format=json&srlimit=${maxResults}`,
        {
          headers: { 'User-Agent': 'KoolPlayground/1.0' },
          signal: controller.signal,
        }
      );
      clearTimeout(timeout);
      if (wikiResp.ok) {
        const json = (await wikiResp.json()) as {
          query?: {
            search?: Array<{ title: string; snippet: string }>;
          };
        };
        for (const item of json.query?.search ?? []) {
          results.push({
            title: item.title,
            url: `https://en.wikipedia.org/wiki/${encodeURIComponent(
              item.title.replace(/\s+/g, '_')
            )}`,
            snippet: decodeHtmlEntities(item.snippet),
          });
        }
      }
    } catch {
      // Return empty gracefully
    }
  }

  return results;
}

function isBlockedMetadataHost(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    const host = u.hostname.toLowerCase();
    return (
      host === '169.254.169.254' ||
      host === 'metadata.google.internal' ||
      host === 'metadata'
    );
  } catch {
    return true;
  }
}

interface IncomingMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface ChatRequestBody {
  provider: ProviderId;
  model: string;
  customBaseUrl?: string;
  systemPrompt?: string;
  messages: IncomingMessage[];
  params: PlaygroundParams;
}

function resolveUpstreamEndpoint(provider: ProviderId, customBaseUrl?: string): string {
  switch (provider) {
    case 'groq':
      return 'https://api.groq.com/openai/v1/chat/completions';
    case 'openai':
      return 'https://api.openai.com/v1/chat/completions';
    case 'openrouter':
      return 'https://openrouter.ai/api/v1/chat/completions';
    case 'anthropic':
      return 'https://api.anthropic.com/v1/messages';
    case 'custom': {
      const cleaned = (customBaseUrl || '').trim().replace(/\/+$/, '');
      if (cleaned.endsWith('/chat/completions')) return cleaned;
      return `${cleaned}/chat/completions`;
    }
    default:
      return '';
  }
}

function buildSearchGroundedSystemPrompt(
  baseSystemPrompt: string,
  query: string,
  citations: SearchCitation[]
): string {
  const formatted = citations
    .map(
      (c, idx) =>
        `[${idx + 1}] ${c.title}\nURL: ${c.url}${c.snippet ? `\nSnippet: ${c.snippet}` : ''}`
    )
    .join('\n\n');

  const searchBlock = `Live web search results for "${query}" (fetched ${new Date().toISOString().slice(0, 10)}):\n\n${formatted}\n\nUse these sources when relevant and cite them inline as [1], [2], etc.`;
  return baseSystemPrompt.trim()
    ? `${baseSystemPrompt.trim()}\n\n${searchBlock}`
    : searchBlock;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({ ok: true });
  });

  app.post('/api/search', async (req: Request, res: Response) => {
    const query = typeof req.body?.query === 'string' ? req.body.query : '';
    if (!query.trim()) {
      res.status(400).json({ error: 'Search query is required.' });
      return;
    }
    const results = await performLiveWebSearch(query, 5);
    res.json({ query: query.trim(), results });
  });

  // Stateless BYOK key verification — performs a lightweight auth check without storing or logging the key
  app.post('/api/proxy/verify-key', async (req: Request, res: Response) => {
    const apiKey = String(req.header('x-provider-api-key') || '').trim();
    const provider = req.body?.provider as ProviderId | undefined;
    const customBaseUrl =
      typeof req.body?.customBaseUrl === 'string' ? req.body.customBaseUrl.trim() : '';

    if (!apiKey) {
      res.status(400).json({ ok: false, error: 'Enter an API key to verify.' });
      return;
    }
    if (!provider || provider === 'sandbox') {
      res.status(400).json({ ok: false, error: 'Select a bring-your-own-key provider.' });
      return;
    }

    let checkUrl = '';
    const headers: Record<string, string> = {};

    if (provider === 'groq') {
      checkUrl = 'https://api.groq.com/openai/v1/models';
      headers.Authorization = `Bearer ${apiKey}`;
    } else if (provider === 'openai') {
      checkUrl = 'https://api.openai.com/v1/models';
      headers.Authorization = `Bearer ${apiKey}`;
    } else if (provider === 'openrouter') {
      checkUrl = 'https://openrouter.ai/api/v1/auth/key';
      headers.Authorization = `Bearer ${apiKey}`;
    } else if (provider === 'anthropic') {
      checkUrl = 'https://api.anthropic.com/v1/models';
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (provider === 'custom') {
      if (!customBaseUrl) {
        res.status(400).json({ ok: false, error: 'Enter a Custom Base URL first.' });
        return;
      }
      const cleaned = customBaseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
      checkUrl = `${cleaned}/models`;
      headers.Authorization = `Bearer ${apiKey}`;
    }

    if (!checkUrl || isBlockedMetadataHost(checkUrl)) {
      res.status(400).json({ ok: false, error: 'Invalid or disallowed endpoint URL.' });
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const upstream = await fetch(checkUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (upstream.ok) {
        res.json({ ok: true, message: 'Key verified with provider.' });
        return;
      }

      const text = await upstream.text();
      res.status(200).json({
        ok: false,
        error: formatProviderError(text || `Provider rejected key (HTTP ${upstream.status}).`),
      });
    } catch (err) {
      res.status(200).json({
        ok: false,
        error: formatProviderError(err),
      });
    }
  });

  // Stateless BYOK model discovery — queries the provider's /models endpoint using the user's API key
  app.post('/api/proxy/models', async (req: Request, res: Response) => {
    const apiKey = String(req.header('x-provider-api-key') || '').trim();
    const provider = req.body?.provider as ProviderId | undefined;
    const customBaseUrl =
      typeof req.body?.customBaseUrl === 'string' ? req.body.customBaseUrl.trim() : '';

    if (!apiKey) {
      res.status(400).json({ ok: false, models: [], error: 'Enter an API key to fetch available models.' });
      return;
    }
    if (!provider || provider === 'sandbox') {
      res.status(400).json({ ok: false, models: [], error: 'Select a bring-your-own-key provider.' });
      return;
    }

    let modelsUrl = '';
    const headers: Record<string, string> = {};

    if (provider === 'groq') {
      modelsUrl = 'https://api.groq.com/openai/v1/models';
      headers.Authorization = `Bearer ${apiKey}`;
    } else if (provider === 'openai') {
      modelsUrl = 'https://api.openai.com/v1/models';
      headers.Authorization = `Bearer ${apiKey}`;
    } else if (provider === 'openrouter') {
      modelsUrl = 'https://openrouter.ai/api/v1/models';
      headers.Authorization = `Bearer ${apiKey}`;
      headers['X-Title'] = 'Kool PlayGround';
    } else if (provider === 'anthropic') {
      modelsUrl = 'https://api.anthropic.com/v1/models?limit=100';
      headers['x-api-key'] = apiKey;
      headers['anthropic-version'] = '2023-06-01';
    } else if (provider === 'custom') {
      if (!customBaseUrl) {
        res.status(400).json({ ok: false, models: [], error: 'Enter a Base URL first.' });
        return;
      }
      const cleaned = customBaseUrl.replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
      modelsUrl = `${cleaned}/models`;
      headers.Authorization = `Bearer ${apiKey}`;
    }

    if (!modelsUrl || isBlockedMetadataHost(modelsUrl)) {
      res.status(400).json({ ok: false, models: [], error: 'Invalid or disallowed endpoint URL.' });
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const upstream = await fetch(modelsUrl, {
        method: 'GET',
        headers,
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (!upstream.ok) {
        const text = await upstream.text().catch(() => '');
        res.status(200).json({
          ok: false,
          models: [],
          error: formatProviderError(text || `Could not fetch models (HTTP ${upstream.status}).`),
        });
        return;
      }

      const payload = (await upstream.json()) as unknown;
      const models = normalizeProviderModels(provider, payload);
      res.json({ ok: true, models, count: models.length });
    } catch (err) {
      res.status(200).json({
        ok: false,
        models: [],
        error: formatProviderError(err),
      });
    }
  });

  // Built-in no-key-required sandbox backed server-side by Gemini 4 Hydrogen
  app.post('/api/sandbox/chat', async (req: Request, res: Response) => {
    const body = req.body as ChatRequestBody;
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const params = body?.params;
    const systemPrompt = typeof body?.systemPrompt === 'string' ? body.systemPrompt.trim() : '';

    if (messages.length === 0) {
      res.status(400).json({ error: 'At least one message is required.' });
      return;
    }

    if (!process.env.GEMINI_API_KEY) {
      res.status(503).json({
        error:
          'Built-in Sandbox is unavailable because no server sandbox credential is configured. Switch to Groq, OpenAI, Anthropic, or OpenRouter and paste your own API key.',
      });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const ai = createGeminiClient();
    const contents = messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const config: Record<string, unknown> = {};
    if (systemPrompt) {
      config.systemInstruction = systemPrompt;
    }
    if (params?.browserSearch) {
      sendSse(res, { type: 'status', status: 'Searching the web…' });
      config.tools = [{ googleSearch: {} }];
    } else if (params?.jsonMode) {
      config.responseMimeType = 'application/json';
    }
    if (params?.seed && params.seed.trim() !== '' && !Number.isNaN(Number(params.seed))) {
      config.seed = Math.floor(Number(params.seed));
    }

    const extractCitations = (
      groundingChunks?: Array<{ web?: { uri?: string; title?: string } }>
    ): SearchCitation[] => {
      if (!Array.isArray(groundingChunks)) return [];
      const seen = new Set<string>();
      const out: SearchCitation[] = [];
      for (const chunk of groundingChunks) {
        const uri = chunk?.web?.uri;
        if (uri && !seen.has(uri)) {
          seen.add(uri);
          out.push({
            title: chunk.web?.title || uri,
            url: uri,
          });
        }
      }
      return out;
    };

    try {
      if (params?.stream === false) {
        const response = await ai.models.generateContent({
          model: 'gemini-4-hydrogen',
          contents,
          config,
        });

        const citations = extractCitations(
          response.candidates?.[0]?.groundingMetadata?.groundingChunks as
            | Array<{ web?: { uri?: string; title?: string } }>
            | undefined
        );
        if (citations.length > 0) {
          sendSse(res, { type: 'citations', citations });
        }
        if (response.text) {
          sendSse(res, { type: 'delta', text: response.text });
        }
        if (response.usageMetadata) {
          sendSse(res, {
            type: 'usage',
            usage: {
              promptTokens: response.usageMetadata.promptTokenCount,
              completionTokens: response.usageMetadata.candidatesTokenCount,
              totalTokens: response.usageMetadata.totalTokenCount,
            },
          });
        }
        sendSse(res, { type: 'done' });
        res.end();
        return;
      }

      const stream = await ai.models.generateContentStream({
        model: 'gemini-4-hydrogen',
        contents,
        config,
      });

      const collectedCitations = new Map<string, SearchCitation>();
      let lastUsage: AppSseEvent['usage'] | undefined;

      for await (const chunk of stream) {
        if (res.writableEnded) break;
        if (chunk.text) {
          sendSse(res, { type: 'delta', text: chunk.text });
        }
        const chunkCitations = extractCitations(
          chunk.candidates?.[0]?.groundingMetadata?.groundingChunks as
            | Array<{ web?: { uri?: string; title?: string } }>
            | undefined
        );
        for (const c of chunkCitations) {
          collectedCitations.set(c.url, c);
        }
        if (chunk.usageMetadata) {
          lastUsage = {
            promptTokens: chunk.usageMetadata.promptTokenCount,
            completionTokens: chunk.usageMetadata.candidatesTokenCount,
            totalTokens: chunk.usageMetadata.totalTokenCount,
          };
        }
      }

      if (collectedCitations.size > 0) {
        sendSse(res, {
          type: 'citations',
          citations: Array.from(collectedCitations.values()),
        });
      }
      if (lastUsage) {
        sendSse(res, { type: 'usage', usage: lastUsage });
      }
      sendSse(res, { type: 'done' });
      res.end();
    } catch (err) {
      sendSse(res, { type: 'error', error: formatProviderError(err) });
      res.end();
    }
  });

  // Stateless BYOK streaming proxy — API key is forwarded in-flight and never stored or logged
  app.post('/api/proxy/chat', async (req: Request, res: Response) => {
    const apiKey = String(req.header('x-provider-api-key') || '').trim();
    const body = req.body as ChatRequestBody;
    const provider = body?.provider;
    const model = String(body?.model || '').trim();
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const params = body?.params;
    let systemPrompt = typeof body?.systemPrompt === 'string' ? body.systemPrompt.trim() : '';

    if (!apiKey) {
      res.status(401).json({ error: 'Missing provider API key header.' });
      return;
    }
    if (!model || messages.length === 0) {
      res.status(400).json({ error: 'Model ID and at least one message are required.' });
      return;
    }

    const endpoint = resolveUpstreamEndpoint(provider, body.customBaseUrl);
    if (!endpoint || isBlockedMetadataHost(endpoint)) {
      res.status(400).json({ error: 'Invalid or disallowed upstream endpoint URL.' });
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const abortController = new AbortController();
    req.on('close', () => {
      if (!res.writableEnded) {
        abortController.abort();
      }
    });

    try {
      const isGroqNativeBrowserSearch =
        provider === 'groq' &&
        (model.startsWith('openai/gpt-oss') || model.startsWith('groq/compound'));

      // Live web search augmentation for any provider/model without built-in browser search
      if (params?.browserSearch && !isGroqNativeBrowserSearch) {
        const lastUserMessage = [...messages].reverse().find((m) => m.role === 'user');
        const searchQuery = lastUserMessage?.content.trim() || '';
        if (searchQuery) {
          sendSse(res, { type: 'status', status: 'Searching the web…' });
          const citations = await performLiveWebSearch(searchQuery, 5);
          if (citations.length > 0) {
            sendSse(res, { type: 'citations', citations, searchQuery });
            systemPrompt = buildSearchGroundedSystemPrompt(systemPrompt, searchQuery, citations);
          }
        }
      }

      if (provider === 'anthropic') {
        const antBody: Record<string, unknown> = {
          model,
          max_tokens: params?.maxTokens || 2048,
          temperature: params?.temperature ?? 0.7,
          stream: params?.stream !== false,
          messages: messages.map((m) => ({ role: m.role, content: m.content })),
        };
        if (systemPrompt) {
          antBody.system = systemPrompt;
        }
        if (params?.topP !== undefined && params.topP < 1) {
          antBody.top_p = params.topP;
        }
        if (params?.stopSequences && params.stopSequences.length > 0) {
          antBody.stop_sequences = params.stopSequences;
        }

        const upstream = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
          body: JSON.stringify(antBody),
          signal: abortController.signal,
        });

        if (!upstream.ok) {
          const errText = await upstream.text();
          let errMsg = `Anthropic error (${upstream.status})`;
          try {
            const parsed = JSON.parse(errText) as { error?: { message?: string } };
            if (parsed?.error?.message) errMsg = parsed.error.message;
          } catch {
            if (errText) errMsg = `${errMsg}: ${errText.slice(0, 240)}`;
          }
          sendSse(res, { type: 'error', error: errMsg });
          res.end();
          return;
        }

        if (params?.stream === false) {
          const json = (await upstream.json()) as {
            content?: Array<{ type: string; text?: string }>;
            usage?: { input_tokens?: number; output_tokens?: number };
          };
          const fullText = (json.content ?? [])
            .filter((b) => b.type === 'text' && b.text)
            .map((b) => b.text)
            .join('');
          if (fullText) sendSse(res, { type: 'delta', text: fullText });
          if (json.usage) {
            sendSse(res, {
              type: 'usage',
              usage: {
                promptTokens: json.usage.input_tokens,
                completionTokens: json.usage.output_tokens,
                totalTokens: (json.usage.input_tokens || 0) + (json.usage.output_tokens || 0),
              },
            });
          }
          sendSse(res, { type: 'done' });
          res.end();
          return;
        }

        const reader = upstream.body?.getReader();
        if (!reader) {
          sendSse(res, { type: 'error', error: 'Upstream response did not include a readable stream.' });
          res.end();
          return;
        }

        const decoder = new TextDecoder();
        let buffer = '';
        let promptTokens = 0;
        let completionTokens = 0;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            const parsed = parseAnthropicSseLine(line);
            if (!parsed) continue;
            if (parsed.thinking) sendSse(res, { type: 'thinking', text: parsed.thinking });
            if (parsed.delta) sendSse(res, { type: 'delta', text: parsed.delta });
            if (parsed.usage?.promptTokens) promptTokens = parsed.usage.promptTokens;
            if (parsed.usage?.completionTokens) completionTokens = parsed.usage.completionTokens;
          }
        }

        if (promptTokens > 0 || completionTokens > 0) {
          sendSse(res, {
            type: 'usage',
            usage: {
              promptTokens,
              completionTokens,
              totalTokens: promptTokens + completionTokens,
            },
          });
        }
        sendSse(res, { type: 'done' });
        res.end();
        return;
      }

      // OpenAI-compatible path: Groq, OpenAI, OpenRouter, Custom
      const oaiMessages: Array<{ role: string; content: string }> = [];
      if (systemPrompt) {
        oaiMessages.push({ role: 'system', content: systemPrompt });
      }
      for (const m of messages) {
        oaiMessages.push({ role: m.role, content: m.content });
      }

      const isOpenAIReasoningModel = provider === 'openai' && /^o\d/i.test(model);
      const oaiBody: Record<string, unknown> = {
        model,
        messages: oaiMessages,
        stream: params?.stream !== false,
      };

      if (isOpenAIReasoningModel || provider === 'groq') {
        oaiBody.max_completion_tokens = params?.maxTokens || 2048;
      } else {
        oaiBody.max_tokens = params?.maxTokens || 2048;
      }
      if (!isOpenAIReasoningModel) {
        oaiBody.temperature = params?.temperature ?? 0.7;
        oaiBody.top_p = params?.topP ?? 1;
      }

      if (!isOpenAIReasoningModel && params?.frequencyPenalty) {
        oaiBody.frequency_penalty = params.frequencyPenalty;
      }
      if (!isOpenAIReasoningModel && params?.presencePenalty) {
        oaiBody.presence_penalty = params.presencePenalty;
      }
      if (params?.stopSequences && params.stopSequences.length > 0) {
        oaiBody.stop = params.stopSequences;
      }
      if (params?.seed && params.seed.trim() !== '' && !Number.isNaN(Number(params.seed))) {
        oaiBody.seed = Math.floor(Number(params.seed));
      }
      if (params?.jsonMode) {
        oaiBody.response_format = { type: 'json_object' };
      }
      if (params?.reasoningEffort && params.reasoningEffort !== 'default') {
        oaiBody.reasoning_effort = params.reasoningEffort;
      }
      if (params?.browserSearch && provider === 'groq' && model.startsWith('openai/gpt-oss')) {
        oaiBody.tools = [{ type: 'browser_search' }];
      }
      if (params?.stream !== false && (provider === 'openai' || provider === 'groq')) {
        oaiBody.stream_options = { include_usage: true };
      }

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      };
      if (provider === 'openrouter') {
        headers['HTTP-Referer'] = process.env.APP_URL || 'http://localhost:3000';
        headers['X-Title'] = 'Kool PlayGround';
      }

      const upstream = await fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(oaiBody),
        signal: abortController.signal,
      });

      if (!upstream.ok) {
        const errText = await upstream.text();
        let errMsg = `Provider returned HTTP ${upstream.status}`;
        try {
          const parsed = JSON.parse(errText) as { error?: { message?: string } | string };
          if (typeof parsed.error === 'string') errMsg = parsed.error;
          else if (parsed.error?.message) errMsg = parsed.error.message;
        } catch {
          if (errText) errMsg = `${errMsg}: ${errText.slice(0, 240)}`;
        }
        sendSse(res, { type: 'error', error: errMsg });
        res.end();
        return;
      }

      if (params?.stream === false) {
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
        if (msg?.reasoning) sendSse(res, { type: 'thinking', text: msg.reasoning });
        if (msg?.content) sendSse(res, { type: 'delta', text: msg.content });

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
          sendSse(res, { type: 'citations', citations: toolCitations });
        }

        if (json.usage) {
          sendSse(res, {
            type: 'usage',
            usage: {
              promptTokens: json.usage.prompt_tokens,
              completionTokens: json.usage.completion_tokens,
              totalTokens: json.usage.total_tokens,
            },
          });
        }
        sendSse(res, { type: 'done' });
        res.end();
        return;
      }

      const reader = upstream.body?.getReader();
      if (!reader) {
        sendSse(res, { type: 'error', error: 'Upstream response did not include a readable stream.' });
        res.end();
        return;
      }

      const decoder = new TextDecoder();
      let buffer = '';
      let finalUsage: AppSseEvent['usage'] | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const parsed = parseOpenAISseLine(line);
          if (!parsed) continue;
          if (parsed.thinking) sendSse(res, { type: 'thinking', text: parsed.thinking });
          if (parsed.delta) sendSse(res, { type: 'delta', text: parsed.delta });
          if (parsed.usage) finalUsage = parsed.usage;
        }
      }

      if (finalUsage) {
        sendSse(res, { type: 'usage', usage: finalUsage });
      }
      sendSse(res, { type: 'done' });
      res.end();
    } catch (err) {
      if (abortController.signal.aborted) {
        res.end();
        return;
      }
      sendSse(res, { type: 'error', error: formatProviderError(err) });
      res.end();
    }
  });

  if (!IS_PROD) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Kool PlayGround server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
