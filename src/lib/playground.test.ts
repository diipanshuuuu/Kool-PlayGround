import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LOCAL_KEYS_STORAGE_KEY,
  clearAllProviderKeys,
  clearSessionKeysOnly,
  countConfiguredKeys,
  loadPersistedKeys,
  maskApiKey,
  removeProviderKey,
  resolveInitialProvider,
  setProviderKey,
  shouldLaunchToVault,
  validateKeyFormatHint,
  type StorageLike,
} from './keyStorage';
import {
  DEFAULT_PLAYGROUND_PARAMS,
  PARAMETER_PRESETS,
  describeTemperature,
  detectParameterPreset,
  getDefaultModelForProvider,
  getEffectiveModelId,
  validateRequestConfig,
} from './providers';
import {
  computeTokenCapacityProgress,
  countWords,
  estimateAssistantResponseStats,
  estimateTokens,
  formatElapsedMs,
  formatProviderError,
  formatTokensPerSec,
  parseAnthropicSseLine,
  parseAppSseLine,
  parseOpenAISseLine,
} from './streamParser';
import {
  buildMarkdownFilename,
  formatConversationMarkdown,
  generateCodeSnippet,
} from './codeGen';
import {
  deleteSessionFromStorage,
  deriveSessionTitle,
  loadSavedSessions,
  saveSessionToStorage,
} from './sessionsStorage';
import {
  AUTOSAVE_STORAGE_KEY,
  clearAutoSavedChatState,
  createAutoSaveFingerprint,
  hasMeaningfulChatState,
  loadAutoSavedChatState,
  sanitizeAutoSavedChatState,
  saveAutoSavedChatState,
} from './autoSaveStorage';
import { classifyPromptShotType } from './promptAnalysis';
import {
  buildDirectProviderRequest,
  isStaticFallbackResponse,
  resolveDirectProviderBaseUrl,
} from './directClient';
import {
  formatShortcutHint,
  isApplePlatform,
  matchGlobalShortcut,
} from './shortcuts';
import {
  BUILT_IN_SYSTEM_PROMPTS,
  deleteSavedPrompt,
  derivePromptTitle,
  filterPromptLibrary,
  loadPromptLibrary,
  upsertSavedPrompt,
} from './promptLibraryStorage';
import {
  filterModelsByQuery,
  formatContextWindow,
  normalizeProviderModels,
} from './modelDiscovery';
import {
  computeSessionTokenHistory,
  formatCompactTokens,
} from './sessionMetrics';

function createMemoryStorage(): StorageLike {
  const data = new Map<string, string>();
  return {
    getItem(key: string) {
      return data.has(key) ? data.get(key)! : null;
    },
    setItem(key: string, value: string) {
      data.set(key, value);
    },
    removeItem(key: string) {
      data.delete(key);
    },
  };
}

test('ephemeral session keys stay in memory and vanish after simulated refresh', () => {
  const storage = createMemoryStorage();
  let state = loadPersistedKeys(storage);

  state = setProviderKey(state, 'groq', 'gsk_ephemeral_secret_9999', 'session', storage);
  assert.equal(state.groq?.key, 'gsk_ephemeral_secret_9999');
  assert.equal(state.groq?.mode, 'session');
  // Must NOT be persisted to localStorage
  assert.equal(storage.getItem(LOCAL_KEYS_STORAGE_KEY), null);

  // Simulated page refresh reloads only from storage
  const afterRefresh = loadPersistedKeys(storage);
  assert.equal(afterRefresh.groq, undefined);
});

test('saved local keys persist across simulated refresh and can be cleared or downgraded', () => {
  const storage = createMemoryStorage();
  let state = loadPersistedKeys(storage);

  state = setProviderKey(state, 'groq', 'gsk_saved_secret_1234', 'local', storage);
  state = setProviderKey(state, 'openai', 'sk-session-only-5678', 'session', storage);

  const afterRefresh = loadPersistedKeys(storage);
  assert.equal(afterRefresh.groq?.key, 'gsk_saved_secret_1234');
  assert.equal(afterRefresh.groq?.mode, 'local');
  assert.equal(afterRefresh.openai, undefined);

  // Downgrading a previously saved key to session removes it from storage
  const downgraded = setProviderKey(afterRefresh, 'groq', 'gsk_saved_secret_1234', 'session', storage);
  assert.equal(downgraded.groq?.mode, 'session');
  assert.equal(loadPersistedKeys(storage).groq, undefined);

  // Removing a single key and clearing all keys
  let multi = setProviderKey({}, 'groq', 'gsk_one', 'local', storage);
  multi = setProviderKey(multi, 'anthropic', 'sk-ant-two', 'local', storage);
  multi = removeProviderKey(multi, 'groq', storage);
  assert.equal(loadPersistedKeys(storage).groq, undefined);
  assert.equal(loadPersistedKeys(storage).anthropic?.key, 'sk-ant-two');

  const cleared = clearAllProviderKeys(storage);
  assert.deepEqual(cleared, {});
  assert.equal(loadPersistedKeys(storage).anthropic, undefined);
});

test('maskApiKey safely masks short and standard keys', () => {
  assert.equal(maskApiKey(''), '');
  assert.equal(maskApiKey('abc123'), 'ab••••');
  assert.equal(maskApiKey('gsk_1234567890abcdef'), 'gsk_••••cdef');
});

test('validateRequestConfig enforces BYOK keys and custom URLs without faking values', () => {
  const missingKey = validateRequestConfig({
    providerId: 'groq',
    apiKey: '',
    modelId: 'llama-3.3-70b-versatile',
    promptText: 'Hello',
  });
  assert.equal(missingKey.valid, false);
  assert.match(missingKey.error ?? '', /Groq API key/i);

  const validGroq = validateRequestConfig({
    providerId: 'groq',
    apiKey: 'gsk_abc123',
    modelId: 'llama-3.3-70b-versatile',
    promptText: 'Hello',
  });
  assert.equal(validGroq.valid, true);

  const validSandbox = validateRequestConfig({
    providerId: 'sandbox',
    apiKey: '',
    modelId: 'gemini-4-hydrogen',
    promptText: 'Hello',
  });
  assert.equal(validSandbox.valid, true);

  const badCustomUrl = validateRequestConfig({
    providerId: 'custom',
    apiKey: 'sk-custom',
    modelId: 'my-model',
    customBaseUrl: 'ftp://invalid-host',
    promptText: 'Hello',
  });
  assert.equal(badCustomUrl.valid, false);

  assert.equal(getEffectiveModelId('groq', 'llama-3.3-70b-versatile', ''), 'llama-3.3-70b-versatile');
  assert.equal(getEffectiveModelId('groq', 'llama-3.3-70b-versatile', 'custom/override'), 'custom/override');
  assert.equal(getDefaultModelForProvider('groq'), 'openai/gpt-oss-120b');
});

test('SSE parsers extract deltas, reasoning, usage, and termination cleanly', () => {
  const chunk = parseOpenAISseLine(
    'data: {"choices":[{"delta":{"content":"Hello ","reasoning":"thinking..."}}],"x_groq":{"usage":{"prompt_tokens":12,"completion_tokens":4,"total_tokens":16}}}'
  );
  assert.equal(chunk?.delta, 'Hello ');
  assert.equal(chunk?.thinking, 'thinking...');
  assert.equal(chunk?.usage?.totalTokens, 16);

  assert.deepEqual(parseOpenAISseLine('data: [DONE]'), { done: true });
  assert.equal(parseOpenAISseLine('data: {broken json'), null);

  const antDelta = parseAnthropicSseLine(
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"World"}}'
  );
  assert.equal(antDelta?.delta, 'World');
  assert.deepEqual(parseAnthropicSseLine('data: {"type":"message_stop"}'), { done: true });

  const appEvt = parseAppSseLine('data: {"type":"citations","citations":[{"title":"Docs","url":"https://example.com"}]}');
  assert.equal(appEvt?.type, 'citations');
  assert.equal(appEvt?.citations?.[0]?.title, 'Docs');

  assert.equal(formatElapsedMs(840), '840ms');
  assert.equal(formatElapsedMs(1540), '1.54s');
  assert.equal(formatTokensPerSec(120, 1000), '120 tok/s');
  assert.equal(estimateTokens('12345678'), 2);
  assert.equal(countWords(''), 0);
  assert.equal(countWords('   \n\t  '), 0);
  assert.equal(countWords('hello'), 1);
  assert.equal(countWords('Explain TCP vs UDP\nin   three bullets.'), 7);
});

test('generateCodeSnippet outputs accurate provider snippets without leaking raw API keys', () => {
  const groqCurl = generateCodeSnippet({
    providerId: 'groq',
    modelId: 'openai/gpt-oss-120b',
    systemPrompt: 'Be concise.',
    messages: [],
    params: {
      ...DEFAULT_PLAYGROUND_PARAMS,
      temperature: 0.25,
      browserSearch: true,
      jsonMode: true,
    },
    language: 'curl',
  });
  assert.match(groqCurl, /api\.groq\.com\/openai\/v1\/chat\/completions/);
  assert.match(groqCurl, /\$GROQ_API_KEY/);
  assert.match(groqCurl, /"max_completion_tokens": 2048/);
  assert.match(groqCurl, /"temperature": 0.25/);
  assert.match(groqCurl, /"browser_search"/);
  assert.match(groqCurl, /"json_object"/);

  const sandboxPy = generateCodeSnippet({
    providerId: 'sandbox',
    modelId: 'gemini-4-hydrogen',
    systemPrompt: '',
    messages: [],
    params: DEFAULT_PLAYGROUND_PARAMS,
    language: 'python',
  });
  assert.match(sandboxPy, /model="openai\/gpt-oss-120b"/);
  assert.match(sandboxPy, /max_completion_tokens=2048/);

  const anthropicPy = generateCodeSnippet({
    providerId: 'anthropic',
    modelId: 'claude-sonnet-4-20250514',
    systemPrompt: 'Act as a compiler.',
    messages: [],
    params: DEFAULT_PLAYGROUND_PARAMS,
    language: 'python',
  });
  assert.match(anthropicPy, /api\.anthropic\.com\/v1\/messages/);
  assert.match(anthropicPy, /ANTHROPIC_API_KEY/);
  assert.match(anthropicPy, /"system": "Act as a compiler."/);
});

test('session storage saves, derives titles, reloads, and deletes cleanly', () => {
  const storage = createMemoryStorage();
  const title = deriveSessionTitle(
    [{ id: '1', role: 'user', content: 'Compare Rust async runtimes in detail', createdAt: 1 }],
    ''
  );
  assert.equal(title, 'Compare Rust async runtimes in detail');

  const saved = saveSessionToStorage(
    [],
    {
      id: 'sess-1',
      title,
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      systemPrompt: '',
      params: DEFAULT_PLAYGROUND_PARAMS,
      messages: [],
      updatedAt: 1000,
    },
    storage
  );
  assert.equal(saved.length, 1);
  assert.equal(loadSavedSessions(storage).length, 1);

  const afterDelete = deleteSessionFromStorage(saved, 'sess-1', storage);
  assert.equal(afterDelete.length, 0);
  assert.equal(loadSavedSessions(storage).length, 0);
});

test('formatProviderError unwraps nested JSON error strings cleanly', () => {
  const nestedQuota = JSON.stringify({
    error: {
      message: JSON.stringify({
        error: {
          code: 429,
          message: 'You exceeded your current quota.',
          status: 'RESOURCE_EXHAUSTED',
        },
      }),
    },
  });
  const formatted = formatProviderError(new Error(nestedQuota));
  assert.match(formatted, /Rate limit or quota exceeded \(429\)/);
  assert.ok(!formatted.includes('{"error"'));

  const invalidKey = formatProviderError('{"error":{"message":"Invalid API key provided (401)"}}');
  assert.match(invalidKey, /Authentication failed \(401\)/);
});

test('clearSessionKeysOnly wipes temporary session keys on logout while keeping saved local keys', () => {
  const storage = createMemoryStorage();
  let state = setProviderKey({}, 'groq', 'gsk_temp_session_key', 'session', storage);
  state = setProviderKey(state, 'openai', 'sk-saved-local-key', 'local', storage);
  state = setProviderKey(state, 'anthropic', 'sk-ant-temp-key', 'session', storage);

  assert.deepEqual(countConfiguredKeys(state), { total: 3, session: 2, local: 1 });

  const afterLogout = clearSessionKeysOnly(state);
  assert.equal(afterLogout.groq, undefined);
  assert.equal(afterLogout.anthropic, undefined);
  assert.equal(afterLogout.openai?.key, 'sk-saved-local-key');
  assert.deepEqual(countConfiguredKeys(afterLogout), { total: 1, session: 0, local: 1 });

  // Format hints advise gently on prefix mismatch without blocking
  assert.match(validateKeyFormatHint('groq', 'sk-wrong-prefix').warning ?? '', /gsk_/);
  assert.equal(validateKeyFormatHint('groq', 'gsk_valid_prefix').warning, undefined);
  assert.match(validateKeyFormatHint('openai', 'sk-has space').warning ?? '', /whitespace/i);
});

test('parameter presets detect precise, balanced, creative, and custom configurations', () => {
  assert.equal(detectParameterPreset(DEFAULT_PLAYGROUND_PARAMS, 'groq'), 'balanced');

  const precisePreset = PARAMETER_PRESETS.find((p) => p.id === 'precise')!;
  const preciseParams = { ...DEFAULT_PLAYGROUND_PARAMS, ...precisePreset.values };
  assert.equal(detectParameterPreset(preciseParams, 'groq'), 'precise');

  const creativePreset = PARAMETER_PRESETS.find((p) => p.id === 'creative')!;
  const creativeAnthropic = {
    ...DEFAULT_PLAYGROUND_PARAMS,
    temperature: 1.0,
    topP: creativePreset.values.topP,
    frequencyPenalty: 0,
    presencePenalty: 0,
  };
  assert.equal(detectParameterPreset(creativeAnthropic, 'anthropic'), 'creative');

  const customParams = { ...DEFAULT_PLAYGROUND_PARAMS, temperature: 0.42 };
  assert.equal(detectParameterPreset(customParams, 'groq'), 'custom');

  assert.equal(describeTemperature(0.1), 'Deterministic');
  assert.equal(describeTemperature(0.5), 'Focused');
  assert.equal(describeTemperature(0.7), 'Balanced');
  assert.equal(describeTemperature(1.2), 'Creative');
  assert.equal(describeTemperature(1.8), 'Exploratory');
});

test('classifyPromptShotType distinguishes empty, zero-shot, one-shot, and few-shot prompts', () => {
  assert.equal(classifyPromptShotType('   '), null);

  const zeroShot = classifyPromptShotType('Explain the difference between TCP and UDP in 3 bullets.');
  assert.equal(zeroShot?.type, 'zero-shot');
  assert.equal(zeroShot?.label, 'Zero-shot');

  const oneShotPair = classifyPromptShotType(`Classify sentiment:
Input: I loved the pacing of this film.
Output: Positive

Input: The audio was terrible.
Output:`);
  assert.equal(oneShotPair?.type, 'one-shot');
  assert.equal(oneShotPair?.label, 'One-shot');
  assert.equal(oneShotPair?.exampleCount, 1);

  const oneShotInline = classifyPromptShotType(
    'Convert dates to ISO format. For example: "March 4, 2026" -> 2026-03-04. Now convert "July 19, 2026".'
  );
  assert.equal(oneShotInline?.type, 'one-shot');

  const fewShotArrows = classifyPromptShotType(`Classify sentiment:
"Great service!" -> Positive
"Waited two hours." -> Negative
"Food was fine." -> Neutral
"Best coffee in town." ->`);
  assert.equal(fewShotArrows?.type, 'few-shot');
  assert.equal(fewShotArrows?.label, 'Few-shot');
  assert.equal(fewShotArrows?.exampleCount, 3);

  const fewShotHeaders = classifyPromptShotType(`Example 1:
Question: What is 2+2?
Answer: 4

Example 2:
Question: What is 3+5?
Answer: 8

Question: What is 9+7?`);
  assert.equal(fewShotHeaders?.type, 'few-shot');
  assert.equal(fewShotHeaders?.exampleCount, 2);

  // Examples placed in system prompt are counted when user types a query
  const systemFewShot = classifyPromptShotType(
    'Now classify: "Shipping arrived early!"',
    'Examples:\n- "Loved it" -> Positive\n- "Broke immediately" -> Negative'
  );
  assert.equal(systemFewShot?.type, 'few-shot');
});

test('directClient detects static Firebase Hosting HTML fallback and builds valid direct provider requests', () => {
  const htmlResp = new Response('<!doctype html><html></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
  assert.equal(isStaticFallbackResponse(htmlResp), true);

  const notFoundResp = new Response('Not Found', { status: 404 });
  assert.equal(isStaticFallbackResponse(notFoundResp), true);

  const sseResp = new Response('data: {}\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  });
  assert.equal(isStaticFallbackResponse(sseResp), false);

  const groqReq = buildDirectProviderRequest({
    provider: 'groq',
    apiKey: 'gsk_test123',
    model: 'openai/gpt-oss-120b',
    systemPrompt: 'Be brief.',
    messages: [{ role: 'user', content: 'Hello' }],
    params: {
      ...DEFAULT_PLAYGROUND_PARAMS,
      temperature: 0.3,
      browserSearch: true,
      jsonMode: true,
      reasoningEffort: 'high',
    },
  });
  assert.equal(groqReq.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(groqReq.headers.Authorization, 'Bearer gsk_test123');
  assert.equal(groqReq.usedNativeSearch, true);
  assert.deepEqual(groqReq.body.tools, [{ type: 'browser_search' }]);
  assert.deepEqual(groqReq.body.response_format, { type: 'json_object' });
  assert.equal(groqReq.body.reasoning_effort, 'high');

  const anthropicReq = buildDirectProviderRequest({
    provider: 'anthropic',
    apiKey: 'sk-ant-test',
    model: 'claude-sonnet-4-20250514',
    systemPrompt: 'Helpful assistant.',
    messages: [{ role: 'user', content: 'Hi' }],
    params: { ...DEFAULT_PLAYGROUND_PARAMS, temperature: 1.5 },
  });
  assert.equal(anthropicReq.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(anthropicReq.isAnthropic, true);
  assert.equal(anthropicReq.headers['anthropic-dangerous-direct-browser-access'], 'true');
  assert.equal(anthropicReq.body.temperature, 1);

  assert.equal(
    resolveDirectProviderBaseUrl('custom', 'https://api.together.xyz/v1/'),
    'https://api.together.xyz/v1'
  );
  assert.equal(resolveDirectProviderBaseUrl('custom', 'ftp://bad.example'), null);
});

test('matchGlobalShortcut handles Cmd/Ctrl+Enter, Cmd/Ctrl+K, and Cmd/Ctrl+N with modal and modifier guards', () => {
  const base = { metaKey: false, ctrlKey: false, altKey: false, shiftKey: false };

  // Cmd/Ctrl + Enter sends prompt globally when no modal is open
  assert.equal(
    matchGlobalShortcut({ ...base, key: 'Enter', metaKey: true }, { hasOpenModal: false }),
    'send-prompt'
  );
  assert.equal(
    matchGlobalShortcut({ ...base, key: 'Enter', ctrlKey: true }, { hasOpenModal: false }),
    'send-prompt'
  );
  // Suppressed while a modal is open
  assert.equal(
    matchGlobalShortcut({ ...base, key: 'Enter', metaKey: true }, { hasOpenModal: true }),
    null
  );

  // Cmd/Ctrl + K opens key settings (case-insensitive, even if another modal is open)
  assert.equal(
    matchGlobalShortcut({ ...base, key: 'k', metaKey: true }, { hasOpenModal: false }),
    'open-keys'
  );
  assert.equal(
    matchGlobalShortcut({ ...base, key: 'K', ctrlKey: true }, { hasOpenModal: true }),
    'open-keys'
  );

  // Cmd/Ctrl + N starts a new chat
  assert.equal(
    matchGlobalShortcut({ ...base, key: 'n', metaKey: true }, { hasOpenModal: false }),
    'new-chat'
  );
  assert.equal(
    matchGlobalShortcut({ ...base, key: 'N', ctrlKey: true }, { hasOpenModal: true }),
    'new-chat'
  );

  // Guards: ignore plain keys, Shift/Alt combos, IME composition, or already-prevented events
  assert.equal(matchGlobalShortcut({ ...base, key: 'Enter' }, { hasOpenModal: false }), null);
  assert.equal(
    matchGlobalShortcut({ ...base, key: 'k', metaKey: true, shiftKey: true }, { hasOpenModal: false }),
    null
  );
  assert.equal(
    matchGlobalShortcut({ ...base, key: 'n', ctrlKey: true, altKey: true }, { hasOpenModal: false }),
    null
  );
  assert.equal(
    matchGlobalShortcut({ ...base, key: 'k', metaKey: true, isComposing: true }, { hasOpenModal: false }),
    null
  );
  assert.equal(
    matchGlobalShortcut({ ...base, key: 'Enter', ctrlKey: true, defaultPrevented: true }, { hasOpenModal: false }),
    null
  );

  assert.equal(isApplePlatform('MacIntel'), true);
  assert.equal(isApplePlatform('Win32'), false);
  assert.equal(formatShortcutHint('K', 'MacIntel'), '⌘K');
  assert.equal(formatShortcutHint('K', 'Linux x86_64'), 'Ctrl+K');
});

test('promptLibraryStorage saves, updates, filters, derives titles, and deletes system prompts cleanly', () => {
  const storage = createMemoryStorage();
  assert.deepEqual(loadPromptLibrary(storage), []);

  assert.equal(derivePromptTitle('# You are a SQL optimizer.\nBe concise.'), 'You are a SQL optimizer.');
  assert.equal(derivePromptTitle('   '), 'Untitled system prompt');

  let library = upsertSavedPrompt(
    [],
    {
      id: 'p-1',
      title: 'SQL Optimizer',
      category: 'Coding',
      content: 'Optimize PostgreSQL queries and explain index usage.',
      updatedAt: 1000,
    },
    storage
  );
  library = upsertSavedPrompt(
    library,
    {
      id: 'p-2',
      title: 'Release Notes Writer',
      category: 'Writing',
      content: 'Summarize PR diffs into crisp user-facing release notes.',
      updatedAt: 2000,
    },
    storage
  );

  // Reload from storage verifies persistence & recency ordering
  const reloaded = loadPromptLibrary(storage);
  assert.equal(reloaded.length, 2);
  assert.equal(reloaded[0].id, 'p-2');
  assert.equal(reloaded[1].id, 'p-1');

  // Updating existing ID replaces cleanly without duplicating
  const updated = upsertSavedPrompt(
    reloaded,
    {
      id: 'p-1',
      title: 'Postgres Query Reviewer',
      category: 'Coding',
      content: 'Review queries for missing indexes and seq scans.',
      updatedAt: 3000,
    },
    storage
  );
  assert.equal(updated.length, 2);
  assert.equal(updated[0].title, 'Postgres Query Reviewer');

  // Filtering combines user prompts + built-in templates cleanly
  const combined = [...updated, ...BUILT_IN_SYSTEM_PROMPTS];
  assert.equal(filterPromptLibrary(combined, '', 'Saved').length, 2);
  assert.equal(filterPromptLibrary(combined, 'postgres', 'All').length, 1);
  assert.ok(filterPromptLibrary(combined, '', 'Coding').length >= 2);

  // Deleting removes from both state and storage
  const afterDelete = deleteSavedPrompt(updated, 'p-1', storage);
  assert.equal(afterDelete.length, 1);
  assert.equal(loadPromptLibrary(storage).length, 1);
});

test('formatConversationMarkdown and buildMarkdownFilename preserve conversation formatting, reasoning, and citations', () => {
  const fixedDate = new Date('2026-11-20T01:30:00.000Z');

  // Empty conversation fallback
  assert.equal(buildMarkdownFilename([], ''), 'kool-playground-conversation.md');
  const emptyMd = formatConversationMarkdown({
    providerId: 'groq',
    modelId: 'llama-3.3-70b-versatile',
    systemPrompt: '',
    messages: [],
    params: DEFAULT_PLAYGROUND_PARAMS,
    exportedAt: fixedDate,
  });
  assert.match(emptyMd, /^# Kool PlayGround Conversation/m);
  assert.match(emptyMd, /\*No messages in this conversation yet\.\*/);
  assert.match(emptyMd, /2026-11-20T01:30:00\.000Z/);

  // Multi-turn formatted conversation with system prompt, reasoning trace, code fence, and citations
  const messages = [
    {
      id: 'u-1',
      role: 'user' as const,
      content: 'Compare Rust vs Go for high-throughput HTTP proxies?',
      createdAt: 1000,
    },
    {
      id: 'a-1',
      role: 'assistant' as const,
      modelUsed: 'openai/gpt-oss-120b',
      thinking: 'Consider memory overhead, GC pauses, and async ecosystem.',
      content: 'Here is a summary:\n\n```rust\nasync fn proxy() {}\n```\n\n- **Rust**: zero GC pauses\n- **Go**: fast compilation',
      citations: [
        { title: 'Tokio Docs', url: 'https://tokio.rs' },
        { title: 'Go net/http', url: 'https://pkg.go.dev/net/http' },
      ],
      createdAt: 2000,
    },
  ];

  assert.equal(
    buildMarkdownFilename(messages, 'Be concise.'),
    'kool-playground-compare-rust-vs-go-for-high-throughput-http-prox.md'
  );

  const md = formatConversationMarkdown({
    providerId: 'groq',
    modelId: 'openai/gpt-oss-120b',
    systemPrompt: 'Respond with crisp engineering trade-offs.',
    messages,
    params: {
      ...DEFAULT_PLAYGROUND_PARAMS,
      temperature: 0.4,
      browserSearch: true,
    },
    exportedAt: fixedDate,
  });

  assert.match(md, /^# Compare Rust vs Go for high-throughput HTTP proxies\?/m);
  assert.match(md, /- \*\*Provider:\*\* Groq/);
  assert.match(md, /- \*\*Model:\*\* `openai\/gpt-oss-120b`/);
  assert.match(md, /browser_search=on/);
  assert.match(md, /## System Prompt\n\nRespond with crisp engineering trade-offs\./);
  assert.match(md, /## User\n\nCompare Rust vs Go for high-throughput HTTP proxies\?/);
  assert.match(md, /## Assistant \(openai\/gpt-oss-120b\)/);
  assert.match(md, /<details>\n<summary>Reasoning trace<\/summary>\n\nConsider memory overhead/);
  assert.match(md, /```rust\nasync fn proxy\(\) \{\}\n```/);
  assert.match(md, /### Sources\n\n1\. \[Tokio Docs\]\(https:\/\/tokio\.rs\)\n2\. \[Go net\/http\]\(https:\/\/pkg\.go\.dev\/net\/http\)/);
});

test('estimateAssistantResponseStats estimates response tokens, words, and optional reasoning tokens cleanly', () => {
  const empty = estimateAssistantResponseStats('   ');
  assert.equal(empty.tokens, 0);
  assert.equal(empty.words, 0);
  assert.equal(empty.totalEstimatedTokens, 0);
  assert.equal(empty.label, '~0 tok · 0 words');

  const singleWord = estimateAssistantResponseStats('Hello');
  assert.equal(singleWord.words, 1);
  assert.equal(singleWord.tokens, 2);
  assert.equal(singleWord.label, '~2 tok · 1 word');
  assert.equal(singleWord.tooltip, 'Estimated ~2 response tokens (1 word)');

  const withReasoning = estimateAssistantResponseStats(
    'SQLite in WAL mode handles concurrent reads cleanly with minimal operational overhead.',
    'Compare WAL concurrency vs Postgres MVCC.'
  );
  assert.equal(withReasoning.words, 12);
  assert.equal(withReasoning.tokens, estimateTokens('SQLite in WAL mode handles concurrent reads cleanly with minimal operational overhead.'));
  assert.equal(withReasoning.thinkingTokens, estimateTokens('Compare WAL concurrency vs Postgres MVCC.'));
  assert.equal(withReasoning.totalEstimatedTokens, withReasoning.tokens + withReasoning.thinkingTokens);
  assert.match(withReasoning.label, /^~\d+ tok · 12 words$/);
  assert.match(withReasoning.tooltip, /reasoning tokens \(12 words\)$/);
});

test('shouldLaunchToVault and resolveInitialProvider direct users based on saved API keys', () => {
  const storage = createMemoryStorage();
  const emptyKeys = loadPersistedKeys(storage);
  assert.equal(shouldLaunchToVault(emptyKeys), true);
  assert.equal(resolveInitialProvider(emptyKeys), 'groq');

  // Saving an OpenAI key skips vault on next load and auto-selects OpenAI
  setProviderKey({}, 'openai', 'sk-saved-openai-key', 'local', storage);
  const reloadedOpenAI = loadPersistedKeys(storage);
  assert.equal(shouldLaunchToVault(reloadedOpenAI), false);
  assert.equal(resolveInitialProvider(reloadedOpenAI), 'openai');

  // If Groq is also saved, Groq takes priority as default
  setProviderKey(reloadedOpenAI, 'groq', 'gsk_saved_groq_key', 'local', storage);
  const reloadedBoth = loadPersistedKeys(storage);
  assert.equal(shouldLaunchToVault(reloadedBoth), false);
  assert.equal(resolveInitialProvider(reloadedBoth), 'groq');
});

test('computeTokenCapacityProgress calculates ratio, percent, clamping, and threshold levels', () => {
  assert.equal(computeTokenCapacityProgress(50, 0), null);
  assert.equal(computeTokenCapacityProgress(50, -100), null);

  const normal = computeTokenCapacityProgress(256, 2048);
  assert.deepEqual(normal, {
    usedTokens: 256,
    maxTokens: 2048,
    ratio: 0.125,
    percent: 13,
    level: 'normal',
  });

  const warning = computeTokenCapacityProgress(800, 1000);
  assert.equal(warning?.percent, 80);
  assert.equal(warning?.level, 'warning');

  const critical = computeTokenCapacityProgress(950, 1000);
  assert.equal(critical?.percent, 95);
  assert.equal(critical?.level, 'critical');

  const clamped = computeTokenCapacityProgress(1500, 1000);
  assert.equal(clamped?.ratio, 1);
  assert.equal(clamped?.percent, 100);
  assert.equal(clamped?.level, 'critical');
});

test('normalizeProviderModels discovers chat models per provider, filters non-chat models, and supports search', () => {
  assert.equal(formatContextWindow(1000000), '1M');
  assert.equal(formatContextWindow(128000), '128K');
  assert.equal(formatContextWindow(0), '—');

  // Groq filters out whisper/tts/inactive models and keeps live context windows
  const groqModels = normalizeProviderModels('groq', {
    data: [
      { id: 'whisper-large-v3', active: true },
      { id: 'playai-tts', active: true },
      { id: 'deprecated-model', active: false },
      { id: 'llama-3.3-70b-versatile', active: true, context_window: 131072 },
      { id: 'moonshotai/kimi-k2-instruct', active: true, context_window: 131072, max_completion_tokens: 16384 },
    ],
  });
  assert.deepEqual(
    groqModels.map((m) => m.id),
    ['llama-3.3-70b-versatile', 'moonshotai/kimi-k2-instruct']
  );
  assert.equal(groqModels[0].label, 'Llama 3.3 70B Versatile');
  assert.equal(groqModels[1].contextWindow, '131K');

  // OpenAI filters out embeddings/whisper/tts/dall-e and preserves reasoning flags
  const openaiModels = normalizeProviderModels('openai', {
    data: [
      { id: 'text-embedding-3-large', created: 1700 },
      { id: 'dall-e-3', created: 1700 },
      { id: 'whisper-1', created: 1700 },
      { id: 'o3-mini', created: 1738 },
      { id: 'gpt-4.1-nano', created: 1745 },
      { id: 'gpt-4o', created: 1720 },
    ],
  });
  assert.deepEqual(
    openaiModels.map((m) => m.id),
    ['gpt-4o', 'o3-mini', 'gpt-4.1-nano']
  );
  assert.equal(openaiModels.find((m) => m.id === 'o3-mini')?.supportsTemperature, false);

  // Anthropic preserves display_name labels
  const anthropicModels = normalizeProviderModels('anthropic', {
    data: [
      { id: 'claude-opus-4-20250514', display_name: 'Claude Opus 4', created_at: '2025-05-14T00:00:00Z' },
      { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4', created_at: '2025-05-14T00:00:00Z' },
    ],
  });
  assert.equal(anthropicModels.length, 2);
  assert.equal(anthropicModels.find((m) => m.id === 'claude-opus-4-20250514')?.label, 'Claude Opus 4');

  // OpenRouter parses context_length and top_provider limits
  const openrouterModels = normalizeProviderModels('openrouter', {
    data: [
      {
        id: 'google/gemini-2.5-pro',
        name: 'Google: Gemini 2.5 Pro',
        context_length: 1000000,
        top_provider: { max_completion_tokens: 65536 },
      },
    ],
  });
  assert.equal(openrouterModels[0].contextWindow, '1M');
  assert.equal(openrouterModels[0].maxOutputTokens, 65536);
  assert.equal(openrouterModels[0].label, 'Google: Gemini 2.5 Pro');

  // Custom endpoint models work with getEffectiveModelId without requiring manual override
  const customModels = normalizeProviderModels('custom', {
    data: [{ id: 'Qwen/Qwen2.5-72B-Instruct-Turbo' }, { id: 'BAAI/bge-large-en-v1.5-embedding' }],
  });
  assert.deepEqual(
    customModels.map((m) => m.id),
    ['Qwen/Qwen2.5-72B-Instruct-Turbo']
  );
  assert.equal(
    getEffectiveModelId('custom', 'Qwen/Qwen2.5-72B-Instruct-Turbo', ''),
    'Qwen/Qwen2.5-72B-Instruct-Turbo'
  );
  assert.equal(getEffectiveModelId('custom', 'custom-model', ''), '');

  // Query filtering matches both ID and display label
  assert.equal(filterModelsByQuery(openaiModels, 'nano').length, 1);
  assert.equal(filterModelsByQuery(groqModels, 'versatile').length, 1);
  assert.equal(filterModelsByQuery(groqModels, 'nonexistent').length, 0);
});

test('autoSaveStorage saves, restores, fingerprints, sanitizes, and clears chat state without storing API keys', () => {
  const storage = createMemoryStorage();

  const pristine = {
    provider: 'groq' as const,
    model: 'openai/gpt-oss-120b',
    customBaseUrl: 'https://api.together.xyz/v1',
    customModelId: '',
    systemPrompt: '',
    composerText: '',
    params: DEFAULT_PLAYGROUND_PARAMS,
    messages: [],
    activeSessionId: null,
  };
  assert.equal(hasMeaningfulChatState(pristine), false);

  const activeDraft = {
    ...pristine,
    provider: 'openai' as const,
    model: 'gpt-4.1-mini',
    systemPrompt: 'You are a concise staff engineer.',
    composerText: 'Compare Raft and Paxos',
    params: { ...DEFAULT_PLAYGROUND_PARAMS, temperature: 0.3, jsonMode: true },
    messages: [
      { id: 'u1', role: 'user' as const, content: 'Hello', createdAt: 1000 },
      {
        id: 'a1',
        role: 'assistant' as const,
        content: 'Hi there!',
        modelUsed: 'gpt-4.1-mini',
        providerUsed: 'openai' as const,
        createdAt: 1100,
      },
    ],
    activeSessionId: 'sess-42',
  };
  assert.equal(hasMeaningfulChatState(activeDraft), true);

  // Fingerprint is stable across identical state and detects edits
  const fp1 = createAutoSaveFingerprint(activeDraft);
  const fp2 = createAutoSaveFingerprint({ ...activeDraft });
  const fp3 = createAutoSaveFingerprint({ ...activeDraft, composerText: 'Compare Raft and Paxos!' });
  assert.equal(fp1, fp2);
  assert.notEqual(fp1, fp3);

  // Save & restore roundtrip
  const saveRes = saveAutoSavedChatState(activeDraft, storage, 5000);
  assert.equal(saveRes.saved, true);
  assert.equal(saveRes.savedAt, 5000);

  const rawStored = storage.getItem(AUTOSAVE_STORAGE_KEY) ?? '';
  assert.ok(!rawStored.includes('apiKey'));
  assert.ok(!rawStored.includes('apiKeys'));

  const restored = loadAutoSavedChatState(storage);
  assert.ok(restored);
  assert.equal(restored.provider, 'openai');
  assert.equal(restored.model, 'gpt-4.1-mini');
  assert.equal(restored.systemPrompt, 'You are a concise staff engineer.');
  assert.equal(restored.composerText, 'Compare Raft and Paxos');
  assert.equal(restored.params.temperature, 0.3);
  assert.equal(restored.params.jsonMode, true);
  assert.equal(restored.messages.length, 2);
  assert.equal(restored.activeSessionId, 'sess-42');
  assert.equal(restored.savedAt, 5000);

  // Corrupted or unknown-provider payloads fail safely to null
  assert.equal(sanitizeAutoSavedChatState({ provider: 'unknown-vendor' }), null);
  storage.setItem(AUTOSAVE_STORAGE_KEY, '{invalid-json');
  assert.equal(loadAutoSavedChatState(storage), null);

  // QuotaExceededError fallback trims to latest 20 messages and succeeds
  let attempts = 0;
  const tightStorage: StorageLike = {
    getItem: (k) => storage.getItem(k),
    setItem: (k, v) => {
      attempts += 1;
      if (attempts === 1) throw new Error('QuotaExceededError');
      storage.setItem(k, v);
    },
    removeItem: (k) => storage.removeItem(k),
  };
  const manyMessages = Array.from({ length: 35 }, (_, i) => ({
    id: `m-${i}`,
    role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
    content: `msg ${i}`,
    createdAt: 1000 + i,
  }));
  const quotaRes = saveAutoSavedChatState({ ...activeDraft, messages: manyMessages }, tightStorage);
  assert.equal(quotaRes.saved, true);
  const trimmedRestored = loadAutoSavedChatState(tightStorage);
  assert.equal(trimmedRestored?.messages.length, 20);
  assert.equal(trimmedRestored?.messages[0]?.id, 'm-15');

  // Clear removes persisted draft completely
  clearAutoSavedChatState(storage);
  assert.equal(loadAutoSavedChatState(storage), null);
});

test('computeSessionTokenHistory and formatCompactTokens aggregate per-turn measured and estimated token usage', () => {
  // Compact token formatting
  assert.equal(formatCompactTokens(0), '0');
  assert.equal(formatCompactTokens(420), '420');
  assert.equal(formatCompactTokens(1250), '1.3K');
  assert.equal(formatCompactTokens(125000), '125K');
  assert.equal(formatCompactTokens(1500000), '1.5M');

  // Empty chat produces zeroed summary
  const empty = computeSessionTokenHistory([], '');
  assert.equal(empty.turns.length, 0);
  assert.equal(empty.totalTokens, 0);
  assert.equal(empty.peakTurnTokens, 0);
  assert.equal(empty.averageTokensPerTurn, 0);
  assert.equal(empty.hasMeasuredUsage, false);

  // Multi-turn chat with measured API usage, fallback estimated turn with reasoning, and trailing user prompt
  const summary = computeSessionTokenHistory(
    [
      {
        id: 'u-1',
        role: 'user',
        content: 'Explain consistent hashing briefly.',
        createdAt: 1000,
      },
      {
        id: 'a-1',
        role: 'assistant',
        content: 'Consistent hashing maps keys and nodes onto a ring so resizing moves minimal keys.',
        modelUsed: 'gpt-4.1-mini',
        metrics: {
          promptTokens: 120,
          completionTokens: 80,
          totalTokens: 200,
          elapsedMs: 640,
        },
        createdAt: 1500,
      },
      {
        id: 'u-2',
        role: 'user',
        content: 'Now add virtual nodes.',
        createdAt: 2000,
      },
      {
        id: 'a-2',
        role: 'assistant',
        content: 'Virtual nodes place multiple tokens per physical server to smooth load variance.',
        thinking: 'Discuss ring hotspots and replication factor.',
        modelUsed: 'gpt-4.1-mini',
        createdAt: 2600,
      },
      {
        id: 'u-3',
        role: 'user',
        content: 'Show a Go example.',
        createdAt: 3000,
      },
      {
        id: 'a-err',
        role: 'assistant',
        content: '',
        error: 'Rate limit exceeded',
        createdAt: 3100,
      },
    ],
    'Be concise.'
  );

  assert.equal(summary.turns.length, 3);
  assert.equal(summary.hasMeasuredUsage, true);

  // Turn 1 uses exact measured API metrics
  assert.equal(summary.turns[0].label, 'T1');
  assert.equal(summary.turns[0].promptTokens, 120);
  assert.equal(summary.turns[0].completionTokens, 80);
  assert.equal(summary.turns[0].totalTokens, 200);
  assert.equal(summary.turns[0].cumulativeTokens, 200);
  assert.equal(summary.turns[0].estimated, false);
  assert.equal(summary.turns[0].modelUsed, 'gpt-4.1-mini');

  // Turn 2 falls back to character-based estimates including reasoning trace
  assert.equal(summary.turns[1].label, 'T2');
  assert.equal(summary.turns[1].estimated, true);
  assert.ok(summary.turns[1].promptTokens > 0);
  assert.ok(summary.turns[1].completionTokens > estimateTokens('Virtual nodes place multiple tokens per physical server to smooth load variance.'));
  assert.equal(
    summary.turns[1].cumulativeTokens,
    summary.turns[0].totalTokens + summary.turns[1].totalTokens
  );

  // Turn 3 captures the trailing user prompt cleanly and ignores empty error-only reply
  assert.equal(summary.turns[2].label, 'T3');
  assert.equal(summary.turns[2].estimated, true);
  assert.ok(summary.turns[2].promptTokens > 0);
  assert.equal(summary.turns[2].completionTokens, 0);

  // Totals, peak, and average remain internally consistent
  assert.equal(
    summary.totalTokens,
    summary.totalPromptTokens + summary.totalCompletionTokens
  );
  assert.equal(summary.totalTokens, summary.turns[2].cumulativeTokens);
  assert.equal(
    summary.peakTurnTokens,
    Math.max(...summary.turns.map((t) => t.totalTokens))
  );
  assert.equal(
    summary.averageTokensPerTurn,
    Math.round(summary.totalTokens / summary.turns.length)
  );
});


