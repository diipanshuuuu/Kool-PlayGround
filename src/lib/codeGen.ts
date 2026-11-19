import { getProviderById } from './providers';
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
  const body: Record<string, unknown> = {
    model: opts.providerId === 'sandbox' ? 'llama-3.3-70b-versatile' : opts.modelId,
    messages: msgs,
    temperature: opts.params.temperature,
    max_tokens: opts.params.maxTokens,
    top_p: opts.params.topP,
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
    messages=${JSON.stringify(body.messages, null, 4)},
    temperature=${opts.params.temperature},
    max_tokens=${opts.params.maxTokens},
    top_p=${opts.params.topP},
    stream=${opts.params.stream ? 'True' : 'False'},${
    opts.params.jsonMode ? '\n    response_format={"type": "json_object"},' : ''
  }
)`;
}
