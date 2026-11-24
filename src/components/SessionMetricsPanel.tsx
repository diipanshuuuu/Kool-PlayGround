import { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  computeSessionTokenHistory,
  formatCompactTokens,
  type TurnTokenPoint,
} from '../lib/sessionMetrics';
import type { ChatMessage } from '../lib/types';

interface SessionMetricsPanelProps {
  messages: ChatMessage[];
  systemPrompt: string;
  isDark: boolean;
}

interface CustomTooltipProps {
  active?: boolean;
  payload?: Array<{ payload: TurnTokenPoint }>;
}

function TokenTooltip({ active, payload }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;
  const point = payload[0]?.payload;
  if (!point) return null;
  const prefix = point.estimated ? '~' : '';

  return (
    <div className="rounded-lg border border-zinc-200 bg-white/95 px-2.5 py-2 text-[11px] shadow-md backdrop-blur-xs dark:border-zinc-700/90 dark:bg-[#14161A]/95">
      <div className="mb-1 flex items-center justify-between gap-3">
        <span className="font-mono font-medium text-zinc-900 dark:text-zinc-100">
          Turn {point.turn}
        </span>
        {point.modelUsed && (
          <span className="max-w-[120px] truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
            {point.modelUsed}
          </span>
        )}
      </div>

      <div className="space-y-0.5 font-mono tabular-nums">
        <div className="flex items-center justify-between gap-4 text-zinc-600 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px] bg-slate-400 dark:bg-zinc-600" />
            Input
          </span>
          <span className="text-zinc-900 dark:text-zinc-100">
            {prefix}
            {point.promptTokens.toLocaleString()}
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 text-zinc-600 dark:text-zinc-400">
          <span className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-[2px] bg-[#E04F26] dark:bg-[#F0643C]" />
            Output
          </span>
          <span className="text-zinc-900 dark:text-zinc-100">
            {prefix}
            {point.completionTokens.toLocaleString()}
          </span>
        </div>
        <div className="mt-1 flex items-center justify-between gap-4 border-t border-zinc-200/80 pt-1 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          <span>Turn total</span>
          <span className="font-medium text-zinc-950 dark:text-zinc-50">
            {prefix}
            {point.totalTokens.toLocaleString()} tok
          </span>
        </div>
        <div className="flex items-center justify-between gap-4 text-[10px] text-zinc-400 dark:text-zinc-500">
          <span>Cumulative</span>
          <span>
            {prefix}
            {point.cumulativeTokens.toLocaleString()} tok
          </span>
        </div>
      </div>
    </div>
  );
}

export function SessionMetricsPanel({
  messages,
  systemPrompt,
  isDark,
}: SessionMetricsPanelProps) {
  const summary = useMemo(
    () => computeSessionTokenHistory(messages, systemPrompt),
    [messages, systemPrompt]
  );

  const colors = isDark
    ? {
        grid: '#27272A',
        axis: '#71717A',
        promptFill: '#52525B',
        completionFill: '#F0643C',
        cursor: 'rgba(255, 255, 255, 0.04)',
      }
    : {
        grid: '#E4E4E7',
        axis: '#71717A',
        promptFill: '#94A3B8',
        completionFill: '#E04F26',
        cursor: 'rgba(17, 17, 19, 0.04)',
      };

  const prefix = summary.turns.length > 0 && !summary.hasMeasuredUsage ? '~' : '';

  return (
    <section
      data-testid="session-metrics-panel"
      aria-label="Session metrics"
      className="space-y-3 p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
          <BarChart3 className="h-3.5 w-3.5 text-zinc-400" />
          <span>Session Metrics</span>
        </div>
        <span
          data-testid="session-total-tokens"
          className="font-mono text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400"
        >
          {summary.totalTokens > 0
            ? `${prefix}${summary.totalTokens.toLocaleString()} tok`
            : '0 tok'}
        </span>
      </div>

      {/* Compact 3-metric summary strip */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/70 px-2 py-1.5 dark:border-zinc-800/80 dark:bg-[#14161A]">
          <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">Input</span>
          <span
            data-testid="session-input-tokens"
            className="mt-0.5 block font-mono text-xs font-medium text-zinc-900 tabular-nums dark:text-zinc-100"
          >
            {formatCompactTokens(summary.totalPromptTokens)}
          </span>
        </div>
        <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/70 px-2 py-1.5 dark:border-zinc-800/80 dark:bg-[#14161A]">
          <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">Output</span>
          <span
            data-testid="session-output-tokens"
            className="mt-0.5 block font-mono text-xs font-medium text-[#E04F26] tabular-nums dark:text-[#F0643C]"
          >
            {formatCompactTokens(summary.totalCompletionTokens)}
          </span>
        </div>
        <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/70 px-2 py-1.5 dark:border-zinc-800/80 dark:bg-[#14161A]">
          <span className="block text-[10px] text-zinc-500 dark:text-zinc-400">Avg/turn</span>
          <span
            data-testid="session-avg-tokens"
            className="mt-0.5 block font-mono text-xs font-medium text-zinc-900 tabular-nums dark:text-zinc-100"
          >
            {formatCompactTokens(summary.averageTokensPerTurn)}
          </span>
        </div>
      </div>

      {/* Recharts Stacked Bar Chart */}
      {summary.turns.length === 0 ? (
        <div className="flex h-[132px] items-center justify-center rounded-lg border border-dashed border-zinc-200 bg-zinc-50/40 px-4 text-center dark:border-zinc-800 dark:bg-[#14161A]/50">
          <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
            Send a prompt to visualize input and output token usage across turns.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div
            data-testid="session-metrics-chart"
            className="h-[154px] w-full min-w-0 rounded-lg border border-zinc-200/80 bg-zinc-50/40 pt-2.5 pr-2 pb-1 pl-1 dark:border-zinc-800/80 dark:bg-[#14161A]/60"
          >
            <ResponsiveContainer width="100%" height="100%" minWidth={0}>
              <BarChart
                data={summary.turns}
                margin={{ top: 6, right: 6, left: 0, bottom: 0 }}
                barCategoryGap="24%"
              >
                <CartesianGrid
                  vertical={false}
                  stroke={colors.grid}
                  strokeDasharray="2 3"
                  strokeOpacity={0.75}
                />
                <XAxis
                  dataKey="label"
                  tickLine={false}
                  axisLine={false}
                  tick={{
                    fill: colors.axis,
                    fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                  }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={36}
                  tickFormatter={(v: number) => formatCompactTokens(v)}
                  tick={{
                    fill: colors.axis,
                    fontSize: 10,
                    fontFamily: 'var(--font-mono)',
                  }}
                />
                <Tooltip
                  cursor={{ fill: colors.cursor, stroke: 'none', radius: 4 }}
                  wrapperStyle={{ zIndex: 20, pointerEvents: 'none' }}
                  content={<TokenTooltip />}
                />
                <Bar
                  dataKey="promptTokens"
                  name="Input"
                  stackId="tokens"
                  fill={colors.promptFill}
                  maxBarSize={24}
                  isAnimationActive={false}
                  radius={[0, 0, 2, 2]}
                />
                <Bar
                  dataKey="completionTokens"
                  name="Output"
                  stackId="tokens"
                  fill={colors.completionFill}
                  maxBarSize={24}
                  isAnimationActive={false}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="flex items-center justify-between text-[10px] text-zinc-500 dark:text-zinc-400">
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[2px] bg-slate-400 dark:bg-zinc-600" />
                <span>Input</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-[2px] bg-[#E04F26] dark:bg-[#F0643C]" />
                <span>Output</span>
              </span>
            </div>
            <span className="font-mono tabular-nums text-zinc-400 dark:text-zinc-500">
              {summary.turns.length} {summary.turns.length === 1 ? 'turn' : 'turns'}
            </span>
          </div>
        </div>
      )}
    </section>
  );
}
