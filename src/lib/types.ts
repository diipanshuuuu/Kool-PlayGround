export type ProviderId =
  | 'groq'
  | 'openai'
  | 'anthropic'
  | 'openrouter'
  | 'custom'
  | 'sandbox';

export type KeyStorageMode = 'session' | 'local';

export type ReasoningEffort = 'default' | 'low' | 'medium' | 'high';

export type ParameterPresetId = 'precise' | 'balanced' | 'creative' | 'custom';

export interface ModelOption {
  id: string;
  label: string;
  contextWindow: string;
  maxOutputTokens: number;
  supportsReasoning?: boolean;
  nativeBrowserSearch?: boolean;
  supportsTemperature?: boolean;
}

export interface ProviderConfig {
  id: ProviderId;
  name: string;
  shortName: string;
  requiresKey: boolean;
  keyPrefixHint: string;
  docsUrl: string;
  defaultBaseUrl: string;
  models: ModelOption[];
}

export interface PlaygroundParams {
  temperature: number;
  maxTokens: number;
  topP: number;
  frequencyPenalty: number;
  presencePenalty: number;
  seed: string;
  stopSequences: string[];
  stream: boolean;
  jsonMode: boolean;
  browserSearch: boolean;
  reasoningEffort: ReasoningEffort;
}

export interface SearchCitation {
  title: string;
  url: string;
  snippet?: string;
}

export interface MessageMetrics {
  elapsedMs: number;
  ttftMs?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  tokensPerSec?: number;
  searchQuery?: string;
  searchResultCount?: number;
}

export interface MessageParamsSnapshot {
  temperature: number;
  topP: number;
  maxTokens: number;
  browserSearch: boolean;
  jsonMode: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  citations?: SearchCitation[];
  metrics?: MessageMetrics;
  paramsSnapshot?: MessageParamsSnapshot;
  modelUsed?: string;
  providerUsed?: ProviderId;
  error?: string;
  createdAt: number;
}

export interface ApiKeyEntry {
  key: string;
  mode: KeyStorageMode;
  updatedAt: number;
}

export type ApiKeyStore = Partial<Record<ProviderId, ApiKeyEntry>>;

export interface SavedSession {
  id: string;
  title: string;
  provider: ProviderId;
  model: string;
  customBaseUrl?: string;
  customModelId?: string;
  systemPrompt: string;
  params: PlaygroundParams;
  messages: ChatMessage[];
  updatedAt: number;
}

export interface SavedSystemPrompt {
  id: string;
  title: string;
  category: string;
  content: string;
  updatedAt: number;
  isBuiltIn?: boolean;
}

export interface AppSseEvent {
  type: 'status' | 'delta' | 'thinking' | 'citations' | 'usage' | 'done' | 'error';
  text?: string;
  status?: string;
  citations?: SearchCitation[];
  searchQuery?: string;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
  error?: string;
}
