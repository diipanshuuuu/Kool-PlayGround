import { estimateAssistantResponseStats, estimateTokens } from './streamParser';
import type { ChatMessage } from './types';

export interface TurnTokenPoint {
  turn: number;
  label: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cumulativeTokens: number;
  estimated: boolean;
  modelUsed?: string;
  elapsedMs?: number;
}

export interface SessionMetricsSummary {
  turns: TurnTokenPoint[];
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  peakTurnTokens: number;
  averageTokensPerTurn: number;
  systemPromptTokens: number;
  hasMeasuredUsage: boolean;
}

/**
 * Formats token counts compactly for chart axes and summary readouts (e.g. 1.2K, 2.4M).
 */
export function formatCompactTokens(tokens: number): string {
  if (!Number.isFinite(tokens) || tokens <= 0) return '0';
  if (tokens >= 1_000_000) {
    const m = tokens / 1_000_000;
    return `${m >= 10 ? Math.round(m) : Number(m.toFixed(1))}M`;
  }
  if (tokens >= 1_000) {
    const k = tokens / 1_000;
    return `${k >= 100 ? Math.round(k) : Number(k.toFixed(1))}K`;
  }
  return String(Math.round(tokens));
}

/**
 * Computes per-turn and cumulative token consumption across the current chat session.
 * Prefers provider-reported API usage metrics when present and falls back smoothly
 * to character-based estimates during streaming or when a provider omits usage stats.
 */
export function computeSessionTokenHistory(
  messages: ChatMessage[],
  systemPrompt = ''
): SessionMetricsSummary {
  const systemPromptTokens = estimateTokens(systemPrompt);
  const turns: TurnTokenPoint[] = [];

  let runningContextTokens = systemPromptTokens;
  let pendingUserTokens = 0;
  let hasPendingUser = false;
  let totalPromptTokens = 0;
  let totalCompletionTokens = 0;
  let cumulativeTokens = 0;
  let peakTurnTokens = 0;
  let hasMeasuredUsage = false;

  for (const msg of messages) {
    if (msg.role === 'user') {
      const userTok = estimateTokens(msg.content);
      // If two user messages appear back-to-back without an assistant reply, flush the first
      if (hasPendingUser && pendingUserTokens > 0) {
        const turnNum = turns.length + 1;
        const promptTokens = runningContextTokens;
        const turnTotal = promptTokens;
        cumulativeTokens += turnTotal;
        totalPromptTokens += promptTokens;
        peakTurnTokens = Math.max(peakTurnTokens, turnTotal);
        turns.push({
          turn: turnNum,
          label: `T${turnNum}`,
          promptTokens,
          completionTokens: 0,
          totalTokens: turnTotal,
          cumulativeTokens,
          estimated: true,
        });
      }
      pendingUserTokens = userTok;
      runningContextTokens += userTok;
      hasPendingUser = true;
      continue;
    }

    // Assistant message
    const estimatedAssistant = estimateAssistantResponseStats(msg.content, msg.thinking);
    const measuredPrompt = msg.metrics?.promptTokens;
    const measuredCompletion = msg.metrics?.completionTokens;

    const hasMeasuredPrompt =
      typeof measuredPrompt === 'number' && Number.isFinite(measuredPrompt) && measuredPrompt > 0;
    const hasMeasuredCompletion =
      typeof measuredCompletion === 'number' &&
      Number.isFinite(measuredCompletion) &&
      measuredCompletion > 0;

    if (hasMeasuredPrompt || hasMeasuredCompletion) {
      hasMeasuredUsage = true;
    }

    const promptTokens = hasMeasuredPrompt
      ? Math.round(measuredPrompt)
      : hasPendingUser
        ? runningContextTokens
        : systemPromptTokens;

    const completionTokens = hasMeasuredCompletion
      ? Math.round(measuredCompletion)
      : estimatedAssistant.totalEstimatedTokens;

    // Skip completely empty failed assistant placeholders that consumed zero tokens
    if (promptTokens === 0 && completionTokens === 0 && !hasPendingUser) {
      continue;
    }

    const turnNum = turns.length + 1;
    const turnTotal = promptTokens + completionTokens;
    cumulativeTokens += turnTotal;
    totalPromptTokens += promptTokens;
    totalCompletionTokens += completionTokens;
    peakTurnTokens = Math.max(peakTurnTokens, turnTotal);

    turns.push({
      turn: turnNum,
      label: `T${turnNum}`,
      promptTokens,
      completionTokens,
      totalTokens: turnTotal,
      cumulativeTokens,
      estimated: !(hasMeasuredPrompt && hasMeasuredCompletion),
      modelUsed: msg.modelUsed,
      elapsedMs: msg.metrics?.elapsedMs,
    });

    runningContextTokens += completionTokens;
    pendingUserTokens = 0;
    hasPendingUser = false;
  }

  // Handle a trailing user message that doesn't yet have an assistant reply
  if (hasPendingUser && pendingUserTokens > 0) {
    const turnNum = turns.length + 1;
    const promptTokens = runningContextTokens;
    cumulativeTokens += promptTokens;
    totalPromptTokens += promptTokens;
    peakTurnTokens = Math.max(peakTurnTokens, promptTokens);
    turns.push({
      turn: turnNum,
      label: `T${turnNum}`,
      promptTokens,
      completionTokens: 0,
      totalTokens: promptTokens,
      cumulativeTokens,
      estimated: true,
    });
  }

  const totalTokens = totalPromptTokens + totalCompletionTokens;
  const averageTokensPerTurn = turns.length > 0 ? Math.round(totalTokens / turns.length) : 0;

  return {
    turns,
    totalPromptTokens,
    totalCompletionTokens,
    totalTokens,
    peakTurnTokens,
    averageTokensPerTurn,
    systemPromptTokens,
    hasMeasuredUsage,
  };
}
