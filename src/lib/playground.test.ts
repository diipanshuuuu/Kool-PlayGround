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
  setProviderKey,
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
  estimateTokens,
  formatElapsedMs,
  formatProviderError,
  formatTokensPerSec,
  parseAnthropicSseLine,
  parseAppSseLine,
  parseOpenAISseLine,
} from './streamParser';
import { generateCodeSnippet } from './codeGen';
import {
  deleteSessionFromStorage,
  deriveSessionTitle,
  loadSavedSessions,
  saveSessionToStorage,
} from './sessionsStorage';
import { classifyPromptShotType } from './promptAnalysis';
import {
  buildDirectProviderRequest,
  isStaticFallbackResponse,
  resolveDirectProviderBaseUrl,
} from './directClient';

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
  assert.equal(getDefaultModelForProvider('groq'), 'llama-3.3-70b-versatile');
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
  assert.match(groqCurl, /"temperature": 0.25/);
  assert.match(groqCurl, /"browser_search"/);
  assert.match(groqCurl, /"json_object"/);

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




