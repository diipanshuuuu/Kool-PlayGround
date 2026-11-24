import type {
  ModelOption,
  ParameterPresetId,
  PlaygroundParams,
  ProviderConfig,
  ProviderId,
} from './types';

export const DEFAULT_PLAYGROUND_PARAMS: PlaygroundParams = {
  temperature: 0.7,
  maxTokens: 2048,
  topP: 1.0,
  frequencyPenalty: 0,
  presencePenalty: 0,
  seed: '',
  stopSequences: [],
  stream: true,
  jsonMode: false,
  browserSearch: false,
  reasoningEffort: 'default',
};

export const PROVIDERS: ProviderConfig[] = [
  {
    id: 'groq',
    name: 'Groq',
    shortName: 'Groq',
    requiresKey: true,
    keyPrefixHint: 'gsk_...',
    docsUrl: 'https://console.groq.com/keys',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    models: [
      {
        id: 'openai/gpt-oss-120b',
        label: 'GPT-OSS 120B',
        contextWindow: '128K',
        maxOutputTokens: 32768,
        supportsReasoning: true,
        nativeBrowserSearch: true,
        supportsTemperature: true,
      },
      {
        id: 'llama-3.3-70b-versatile',
        label: 'Llama 3.3 70B Versatile',
        contextWindow: '128K',
        maxOutputTokens: 32768,
        supportsTemperature: true,
      },
      {
        id: 'llama-3.1-8b-instant',
        label: 'Llama 3.1 8B Instant',
        contextWindow: '128K',
        maxOutputTokens: 8192,
        supportsTemperature: true,
      },
      {
        id: 'meta-llama/llama-4-scout-17b-16e-instruct',
        label: 'Llama 4 Scout 17B',
        contextWindow: '128K',
        maxOutputTokens: 8192,
        supportsTemperature: true,
      },
      {
        id: 'openai/gpt-oss-20b',
        label: 'GPT-OSS 20B',
        contextWindow: '128K',
        maxOutputTokens: 32768,
        supportsReasoning: true,
        nativeBrowserSearch: true,
        supportsTemperature: true,
      },
      {
        id: 'qwen/qwen3-32b',
        label: 'Qwen 3 32B',
        contextWindow: '131K',
        maxOutputTokens: 16384,
        supportsReasoning: true,
        supportsTemperature: true,
      },
      {
        id: 'groq/compound',
        label: 'Groq Compound (Web + Code)',
        contextWindow: '128K',
        maxOutputTokens: 8192,
        nativeBrowserSearch: true,
        supportsTemperature: true,
      },
      {
        id: 'groq/compound-mini',
        label: 'Groq Compound Mini',
        contextWindow: '128K',
        maxOutputTokens: 8192,
        nativeBrowserSearch: true,
        supportsTemperature: true,
      },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI',
    shortName: 'OpenAI',
    requiresKey: true,
    keyPrefixHint: 'sk-...',
    docsUrl: 'https://platform.openai.com/api-keys',
    defaultBaseUrl: 'https://api.openai.com/v1',
    models: [
      {
        id: 'gpt-4.1',
        label: 'GPT-4.1',
        contextWindow: '1M',
        maxOutputTokens: 32768,
        supportsTemperature: true,
      },
      {
        id: 'gpt-4.1-mini',
        label: 'GPT-4.1 Mini',
        contextWindow: '1M',
        maxOutputTokens: 32768,
        supportsTemperature: true,
      },
      {
        id: 'gpt-4o',
        label: 'GPT-4o',
        contextWindow: '128K',
        maxOutputTokens: 16384,
        supportsTemperature: true,
      },
      {
        id: 'gpt-4o-mini',
        label: 'GPT-4o Mini',
        contextWindow: '128K',
        maxOutputTokens: 16384,
        supportsTemperature: true,
      },
      {
        id: 'o3-mini',
        label: 'o3-mini',
        contextWindow: '200K',
        maxOutputTokens: 65536,
        supportsReasoning: true,
        supportsTemperature: false,
      },
    ],
  },
  {
    id: 'anthropic',
    name: 'Anthropic',
    shortName: 'Anthropic',
    requiresKey: true,
    keyPrefixHint: 'sk-ant-...',
    docsUrl: 'https://console.anthropic.com/settings/keys',
    defaultBaseUrl: 'https://api.anthropic.com/v1',
    models: [
      {
        id: 'claude-sonnet-4-20250514',
        label: 'Claude Sonnet 4',
        contextWindow: '200K',
        maxOutputTokens: 16384,
        supportsTemperature: true,
      },
      {
        id: 'claude-3-7-sonnet-latest',
        label: 'Claude 3.7 Sonnet',
        contextWindow: '200K',
        maxOutputTokens: 16384,
        supportsTemperature: true,
      },
      {
        id: 'claude-3-5-haiku-latest',
        label: 'Claude 3.5 Haiku',
        contextWindow: '200K',
        maxOutputTokens: 8192,
        supportsTemperature: true,
      },
    ],
  },
  {
    id: 'openrouter',
    name: 'OpenRouter',
    shortName: 'OpenRouter',
    requiresKey: true,
    keyPrefixHint: 'sk-or-...',
    docsUrl: 'https://openrouter.ai/keys',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    models: [
      {
        id: 'meta-llama/llama-3.3-70b-instruct',
        label: 'Llama 3.3 70B Instruct',
        contextWindow: '131K',
        maxOutputTokens: 16384,
        supportsTemperature: true,
      },
      {
        id: 'anthropic/claude-3.7-sonnet',
        label: 'Claude 3.7 Sonnet',
        contextWindow: '200K',
        maxOutputTokens: 16384,
        supportsTemperature: true,
      },
      {
        id: 'openai/gpt-4.1-mini',
        label: 'GPT-4.1 Mini',
        contextWindow: '1M',
        maxOutputTokens: 16384,
        supportsTemperature: true,
      },
      {
        id: 'deepseek/deepseek-r1',
        label: 'DeepSeek R1',
        contextWindow: '128K',
        maxOutputTokens: 16384,
        supportsReasoning: true,
        supportsTemperature: true,
      },
    ],
  },
  {
    id: 'custom',
    name: 'Custom OpenAI-Compatible',
    shortName: 'Custom',
    requiresKey: true,
    keyPrefixHint: 'sk-... or bearer token',
    docsUrl: '',
    defaultBaseUrl: 'https://api.together.xyz/v1',
    models: [
      {
        id: 'custom-model',
        label: 'Custom Model ID',
        contextWindow: 'Custom',
        maxOutputTokens: 32768,
        supportsTemperature: true,
      },
    ],
  },
  {
    id: 'sandbox',
    name: 'Built-in Sandbox (No Key)',
    shortName: 'Sandbox',
    requiresKey: false,
    keyPrefixHint: '',
    docsUrl: '',
    defaultBaseUrl: '/api/sandbox/chat',
    models: [
      {
        id: 'gemini-4-hydrogen',
        label: 'Sandbox Fast (Search Ready)',
        contextWindow: '1M',
        maxOutputTokens: 8192,
        nativeBrowserSearch: true,
        supportsTemperature: false,
      },
    ],
  },
];

export const PROMPT_STARTERS = [
  {
    label: 'Compare architectures',
    prompt:
      'Compare SQLite in WAL mode vs PostgreSQL for a single-node SaaS serving 5,000 daily active users. Give concrete tradeoffs in a concise table.',
  },
  {
    label: 'Live web search test',
    prompt:
      'What are the most notable open-weight LLM releases in the past 12 months? Include key parameter counts and strengths.',
    enableSearch: true,
  },
  {
    label: 'Structured JSON output',
    prompt:
      'Extract a clean JSON object with keys "language", "complexity", and "optimizations" (array of 3 concise items) for reviewing a naive recursive Fibonacci function.',
    enableJson: true,
  },
  {
    label: 'Debug a race condition',
    prompt:
      'Explain how to prevent stale async responses from overwriting newer React state when a user types quickly in a search box. Show a clean AbortController pattern.',
  },
];

export function getProviderById(id: ProviderId): ProviderConfig {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function getDefaultModelForProvider(id: ProviderId): string {
  const provider = getProviderById(id);
  return provider.models[0]?.id ?? '';
}

export function getModelOption(
  providerId: ProviderId,
  modelId: string,
  dynamicModels?: ModelOption[]
): ModelOption | undefined {
  if (dynamicModels && dynamicModels.length > 0) {
    const dynamicMatch = dynamicModels.find((m) => m.id === modelId);
    if (dynamicMatch) return dynamicMatch;
  }
  const provider = getProviderById(providerId);
  return provider.models.find((m) => m.id === modelId);
}

export function getEffectiveModelId(
  providerId: ProviderId,
  selectedModel: string,
  customModelId: string
): string {
  const trimmedCustom = customModelId.trim();
  if (providerId === 'custom') {
    if (trimmedCustom) return trimmedCustom;
    return selectedModel && selectedModel !== 'custom-model' ? selectedModel : '';
  }
  return trimmedCustom || selectedModel || getDefaultModelForProvider(providerId);
}

export interface RequestValidationResult {
  valid: boolean;
  error?: string;
}

export function validateRequestConfig(args: {
  providerId: ProviderId;
  apiKey?: string;
  modelId: string;
  customBaseUrl?: string;
  promptText: string;
}): RequestValidationResult {
  const provider = getProviderById(args.providerId);

  if (!args.promptText.trim()) {
    return { valid: false, error: 'Enter a prompt before sending.' };
  }

  if (provider.requiresKey && !(args.apiKey ?? '').trim()) {
    return {
      valid: false,
      error: `Add your ${provider.name} API key to run requests, or switch to Built-in Sandbox to test without a key.`,
    };
  }

  if (!args.modelId.trim()) {
    return {
      valid: false,
      error: 'Enter a valid model ID before sending.',
    };
  }

  if (args.providerId === 'custom') {
    const rawUrl = (args.customBaseUrl ?? '').trim();
    if (!rawUrl) {
      return { valid: false, error: 'Enter a Base URL for your custom OpenAI-compatible endpoint.' };
    }
    try {
      const parsed = new URL(rawUrl);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return { valid: false, error: 'Base URL must start with http:// or https://.' };
      }
    } catch {
      return { valid: false, error: 'Base URL is not a valid URL.' };
    }
  }

  return { valid: true };
}

export function clampNumber(value: number, min: number, max: number): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export interface ParameterPreset {
  id: Exclude<ParameterPresetId, 'custom'>;
  label: string;
  description: string;
  values: Pick<
    PlaygroundParams,
    'temperature' | 'topP' | 'frequencyPenalty' | 'presencePenalty'
  >;
}

export const PARAMETER_PRESETS: ParameterPreset[] = [
  {
    id: 'precise',
    label: 'Precise',
    description: 'Low variance for code, math, and extraction',
    values: {
      temperature: 0.15,
      topP: 0.9,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
  },
  {
    id: 'balanced',
    label: 'Balanced',
    description: 'Default mix of accuracy and fluency',
    values: {
      temperature: 0.7,
      topP: 1.0,
      frequencyPenalty: 0,
      presencePenalty: 0,
    },
  },
  {
    id: 'creative',
    label: 'Creative',
    description: 'Higher diversity for ideation and prose',
    values: {
      temperature: 1.15,
      topP: 0.95,
      frequencyPenalty: 0.2,
      presencePenalty: 0.2,
    },
  },
];

export function detectParameterPreset(
  params: PlaygroundParams,
  providerId: ProviderId
): ParameterPresetId {
  const maxTemp = providerId === 'anthropic' ? 1 : 2;
  for (const preset of PARAMETER_PRESETS) {
    const expectedTemp = Math.min(preset.values.temperature, maxTemp);
    const expectedFreq = providerId === 'anthropic' ? 0 : preset.values.frequencyPenalty;
    const expectedPres = providerId === 'anthropic' ? 0 : preset.values.presencePenalty;
    if (
      Math.abs(params.temperature - expectedTemp) < 0.001 &&
      Math.abs(params.topP - preset.values.topP) < 0.001 &&
      Math.abs(params.frequencyPenalty - expectedFreq) < 0.001 &&
      Math.abs(params.presencePenalty - expectedPres) < 0.001
    ) {
      return preset.id;
    }
  }
  return 'custom';
}

export function describeTemperature(temp: number): string {
  if (temp <= 0.25) return 'Deterministic';
  if (temp <= 0.6) return 'Focused';
  if (temp <= 1.0) return 'Balanced';
  if (temp <= 1.4) return 'Creative';
  return 'Exploratory';
}

