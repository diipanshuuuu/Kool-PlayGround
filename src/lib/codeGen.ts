import { getDefaultModelForProvider, getProviderById } from './providers';
import type { ChatMessage, PlaygroundParams, ProviderId } from './types';

export type CodeLanguage = 'curl' | 'javascript' | 'python';

export interface CodeGenOptions {
  providerId: ProviderId;
  modelId: string;
  customBaseUrl?: string;
  systemPrompt: string;
  messages: ChatMessage[];
  params: PlaygroundParams;
  language: CodeLanguage;
}

function getEnvVarName(providerId: ProviderId): string {
  switch (providerId) {
    case 'groq':
      return 'GROQ_API_KEY';
    case 'openai':
      return 'OPENAI_API_KEY';
    case 'anthropic':
      return 'ANTHROPIC_API_KEY';
    case 'openrouter':
      return 'OPENROUTER_API_KEY';
    case 'custom':
      return 'CUSTOM_API_KEY';
    case 'sandbox':
      return 'GEMINI_API_KEY';
  }
}

function buildConversationMessages(
  systemPrompt: string,
  messages: ChatMessage[],
  includeSystemInArray: boolean
): Array<{ role: string; content: string }> {
  const result: Array<{ role: string; content: string }> = [];
  if (includeSystemInArray && systemPrompt.trim()) {
    result.push({ role: 'system', content: systemPrompt.trim() });
  }
  for (const m of messages) {
    if (!m.error && m.content.trim()) {
      result.push({ role: m.role, content: m.content });
    }
  }
  if (result.filter((r) => r.role === 'user').length === 0) {
    result.push({ role: 'user', content: 'Explain how transformer attention works in 3 sentences.' });
  }
  return result;
}

export function generateCodeSnippet(opts: CodeGenOptions): string {
  const provider = getProviderById(opts.providerId);
  const envVar = getEnvVarName(opts.providerId);
  const baseUrl =
    opts.providerId === 'custom' && opts.customBaseUrl?.trim()
      ? opts.customBaseUrl.trim().replace(/\/+$/, '')
      : provider.defaultBaseUrl;

  if (opts.providerId === 'anthropic') {
    const msgs = buildConversationMessages(opts.systemPrompt, opts.messages, false);
    const body: Record<string, unknown> = {
      model: opts.modelId,
      max_tokens: opts.params.maxTokens,
      temperature: opts.params.temperature,
      stream: opts.params.stream,
      messages: msgs,
    };
    if (opts.systemPrompt.trim()) {
      body.system = opts.systemPrompt.trim();
    }
    if (opts.params.stopSequences.length > 0) {
      body.stop_sequences = opts.params.stopSequences;
    }

    if (opts.language === 'curl') {
      return `curl https://api.anthropic.com/v1/messages \\
  -H "content-type: application/json" \\
  -H "x-api-key: $${envVar}" \\
  -H "anthropic-version: 2023-06-01" \\
  -d '${JSON.stringify(body, null, 2)}'`;
    }

    if (opts.language === 'javascript') {
      return `const response = await fetch("https://api.anthropic.com/v1/messages", {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "x-api-key": process.env.${envVar},
    "anthropic-version": "2023-06-01",
  },
  body: JSON.stringify(${JSON.stringify(body, null, 2)}),
});

const data = await response.json();
console.log(data);`;
    }

    return `import os, requests

response = requests.post(
    "https://api.anthropic.com/v1/messages",
    headers={
        "content-type": "application/json",
        "x-api-key": os.environ["${envVar}"],
        "anthropic-version": "2023-06-01",
    },
    json=${JSON.stringify(body, null, 2)},
)
print(response.json())`;
  }

  // OpenAI-compatible (Groq, OpenAI, OpenRouter, Custom, or Sandbox equivalent)
  const endpoint =
    opts.providerId === 'sandbox'
      ? 'https://api.groq.com/openai/v1/chat/completions'
      : `${baseUrl}/chat/completions`;
  const msgs = buildConversationMessages(opts.systemPrompt, opts.messages, true);
  const resolvedModel =
    opts.providerId === 'sandbox' ? getDefaultModelForProvider('groq') : opts.modelId;
  const isOSeriesOpenAI = opts.providerId === 'openai' && /^o\d/i.test(resolvedModel);
  const usesMaxCompletionTokens =
    opts.providerId === 'groq' || opts.providerId === 'sandbox' || isOSeriesOpenAI;
  const body: Record<string, unknown> = {
    model: resolvedModel,
    messages: msgs,
    ...(isOSeriesOpenAI ? {} : { temperature: opts.params.temperature, top_p: opts.params.topP }),
    ...(usesMaxCompletionTokens
      ? { max_completion_tokens: opts.params.maxTokens }
      : { max_tokens: opts.params.maxTokens }),
    stream: opts.params.stream,
  };

  if (opts.params.frequencyPenalty !== 0) {
    body.frequency_penalty = opts.params.frequencyPenalty;
  }
  if (opts.params.presencePenalty !== 0) {
    body.presence_penalty = opts.params.presencePenalty;
  }
  if (opts.params.stopSequences.length > 0) {
    body.stop = opts.params.stopSequences;
  }
  if (opts.params.seed.trim() && !Number.isNaN(Number(opts.params.seed))) {
    body.seed = Number(opts.params.seed);
  }
  if (opts.params.jsonMode) {
    body.response_format = { type: 'json_object' };
  }
  if (
    opts.params.browserSearch &&
    opts.providerId === 'groq' &&
    (opts.modelId.startsWith('openai/gpt-oss') || opts.modelId.startsWith('groq/compound'))
  ) {
    body.tools = [{ type: 'browser_search' }];
  }

  const keyVar = opts.providerId === 'sandbox' ? 'GROQ_API_KEY' : envVar;

  if (opts.language === 'curl') {
    return `curl ${endpoint} \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer $${keyVar}" \\
  -d '${JSON.stringify(body, null, 2)}'`;
  }

  if (opts.language === 'javascript') {
    return `const response = await fetch("${endpoint}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": \`Bearer \${process.env.${keyVar}}\`,
  },
  body: JSON.stringify(${JSON.stringify(body, null, 2)}),
});

const data = await response.json();
console.log(data);`;
  }

  return `import os
from openai import OpenAI

client = OpenAI(
    base_url="${opts.providerId === 'sandbox' ? 'https://api.groq.com/openai/v1' : baseUrl}",
    api_key=os.environ["${keyVar}"],
)

completion = client.chat.completions.create(
    model=${JSON.stringify(body.model)},
    messages=${JSON.stringify(body.messages, null, 4)},${
    isOSeriesOpenAI
      ? ''
      : `\n    temperature=${opts.params.temperature},\n    top_p=${opts.params.topP},`
  }
    ${usesMaxCompletionTokens ? 'max_completion_tokens' : 'max_tokens'}=${opts.params.maxTokens},
    stream=${opts.params.stream ? 'True' : 'False'},${
    opts.params.jsonMode ? '\n    response_format={"type": "json_object"},' : ''
  }
)`;
}

export interface MarkdownExportOptions {
  providerId: ProviderId;
  modelId: string;
  systemPrompt: string;
  messages: ChatMessage[];
  params: PlaygroundParams;
  exportedAt?: Date;
}

export function buildMarkdownFilename(
  messages: ChatMessage[],
  systemPrompt: string
): string {
  const firstUser = messages.find((m) => m.role === 'user' && m.content.trim());
  const source = firstUser?.content.trim() || systemPrompt.trim();
  if (!source) return 'kool-playground-conversation.md';
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/, '');
  return slug ? `kool-playground-${slug}.md` : 'kool-playground-conversation.md';
}

export function formatConversationMarkdown(opts: MarkdownExportOptions): string {
  const provider = getProviderById(opts.providerId);
  const exportedDate = (opts.exportedAt ?? new Date()).toISOString();
  const firstUser = opts.messages.find((m) => m.role === 'user' && m.content.trim());
  const rawTitle = firstUser
    ? firstUser.content.trim().split(/\r?\n/)[0].replace(/^#+\s*/, '').trim()
    : '';
  const title = rawTitle
    ? rawTitle.length > 72
      ? `${rawTitle.slice(0, 72).trimEnd()}…`
      : rawTitle
    : 'Kool PlayGround Conversation';

  const lines: string[] = [];
  lines.push(`# ${title}`);
  lines.push('');
  lines.push(`- **Provider:** ${provider.name}`);
  lines.push(`- **Model:** \`${opts.modelId}\``);

  const paramBits = [
    `temperature=${opts.params.temperature}`,
    `top_p=${opts.params.topP}`,
    `max_tokens=${opts.params.maxTokens}`,
  ];
  if (opts.params.browserSearch) paramBits.push('browser_search=on');
  if (opts.params.jsonMode) paramBits.push('json_mode=on');
  lines.push(`- **Parameters:** \`${paramBits.join(' · ')}\``);
  lines.push(`- **Exported:** ${exportedDate}`);

  if (opts.systemPrompt.trim()) {
    lines.push('');
    lines.push('## System Prompt');
    lines.push('');
    lines.push(opts.systemPrompt.trim());
  }

  lines.push('');
  lines.push('---');

  const exportable = opts.messages.filter(
    (m) => m.content.trim() || m.thinking?.trim() || m.error?.trim()
  );

  if (exportable.length === 0) {
    lines.push('');
    lines.push('*No messages in this conversation yet.*');
    lines.push('');
    return lines.join('\n');
  }

  for (const msg of exportable) {
    lines.push('');
    if (msg.role === 'user') {
      lines.push('## User');
      lines.push('');
      lines.push(msg.content.trim());
    } else {
      const modelStamp = msg.modelUsed ? ` (${msg.modelUsed})` : '';
      lines.push(`## Assistant${modelStamp}`);
      lines.push('');

      if (msg.thinking?.trim()) {
        lines.push('<details>');
        lines.push('<summary>Reasoning trace</summary>');
        lines.push('');
        lines.push(msg.thinking.trim());
        lines.push('');
        lines.push('</details>');
        lines.push('');
      }

      if (msg.content.trim()) {
        lines.push(msg.content.trim());
      }

      if (msg.error?.trim()) {
        lines.push('');
        lines.push(`> **Error:** ${msg.error.trim()}`);
      }

      if (msg.citations && msg.citations.length > 0) {
        lines.push('');
        lines.push('### Sources');
        lines.push('');
        msg.citations.forEach((cite, idx) => {
          const safeTitle = (cite.title || cite.url).replace(/[\[\]]/g, '');
          lines.push(`${idx + 1}. [${safeTitle}](${cite.url})`);
        });
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}
