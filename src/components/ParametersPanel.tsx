import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  ChevronDown,
  ChevronRight,
  Globe,
  KeyRound,
  LogOut,
  Plus,
  RotateCcw,
  X,
} from 'lucide-react';
import {
  PARAMETER_PRESETS,
  PROVIDERS,
  clampNumber,
  describeTemperature,
  detectParameterPreset,
  getModelOption,
  getProviderById,
} from '../lib/providers';
import { maskApiKey } from '../lib/keyStorage';
import type {
  ApiKeyEntry,
  PlaygroundParams,
  ProviderId,
  ReasoningEffort,
} from '../lib/types';

interface ParametersPanelProps {
  providerId: ProviderId;
  modelId: string;
  customBaseUrl: string;
  customModelId: string;
  params: PlaygroundParams;
  activeKeyEntry?: ApiKeyEntry;
  hasAnySessionKey: boolean;
  isOpenDesktop: boolean;
  isOpenMobile: boolean;
  onCloseMobile: () => void;
  onProviderChange: (provider: ProviderId) => void;
  onModelChange: (model: string) => void;
  onCustomBaseUrlChange: (url: string) => void;
  onCustomModelIdChange: (modelId: string) => void;
  onParamsChange: (next: PlaygroundParams) => void;
  onResetDefaults: () => void;
  onOpenApiKeyModal: () => void;
  onClearSessionKeys: () => void;
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  description: string;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <label
          htmlFor={id}
          className={`block text-xs font-medium ${
            disabled
              ? 'text-zinc-400 dark:text-zinc-600'
              : 'cursor-pointer text-zinc-800 dark:text-zinc-200'
          }`}
        >
          {label}
        </label>
        <p className="mt-0.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {description}
        </p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-[#E04F26]/40 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-40 ${
          checked
            ? 'bg-[#E04F26] dark:bg-[#F0643C]'
            : 'bg-zinc-200 dark:bg-zinc-700'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-xs transition-transform ${
            checked ? 'translate-x-[18px]' : 'translate-x-[3px]'
          }`}
        />
      </button>
    </div>
  );
}

function SliderControl({
  id,
  label,
  hint,
  qualifier,
  value,
  min,
  max,
  step,
  disabled,
  formatValue,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  qualifier?: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  formatValue?: (v: number) => string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-1.5">
          <label
            htmlFor={id}
            className={`text-xs font-medium ${
              disabled
                ? 'text-zinc-400 dark:text-zinc-600'
                : 'text-zinc-700 dark:text-zinc-300'
            }`}
          >
            {label}
          </label>
          {qualifier && !disabled && (
            <span className="truncate font-mono text-[10px] text-zinc-400 dark:text-zinc-500">
              {qualifier}
            </span>
          )}
        </div>
        <input
          type="number"
          aria-label={`${label} numeric value`}
          value={value}
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          onChange={(e) => {
            const parsed = Number(e.target.value);
            if (!Number.isNaN(parsed)) {
              onChange(clampNumber(parsed, min, max));
            }
          }}
          className="w-18 rounded border border-zinc-200 bg-transparent px-1.5 py-0.5 text-right font-mono text-xs text-zinc-900 tabular-nums focus:border-[#E04F26] focus:outline-none disabled:opacity-45 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-[#F0643C]"
        />
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        aria-valuetext={formatValue ? formatValue(value) : String(value)}
        onChange={(e) => onChange(Number(e.target.value))}
        className="kestrel-slider"
      />
      {hint && (
        <p className="text-[11px] leading-snug text-zinc-500 dark:text-zinc-400">
          {hint}
        </p>
      )}
    </div>
  );
}

export function ParametersPanel({
  providerId,
  modelId,
  customBaseUrl,
  customModelId,
  params,
  activeKeyEntry,
  hasAnySessionKey,
  isOpenDesktop,
  isOpenMobile,
  onCloseMobile,
  onProviderChange,
  onModelChange,
  onCustomBaseUrlChange,
  onCustomModelIdChange,
  onParamsChange,
  onResetDefaults,
  onOpenApiKeyModal,
  onClearSessionKeys,
}: ParametersPanelProps) {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [stopDraft, setStopDraft] = useState('');

  const provider = getProviderById(providerId);
  const modelOption = getModelOption(providerId, modelId);
  const samplingDisabled = modelOption?.supportsTemperature === false;
  const maxAllowedTokens = modelOption?.maxOutputTokens ?? 16384;
  const activePreset = detectParameterPreset(params, providerId);

  const handleApplyPreset = (presetId: (typeof PARAMETER_PRESETS)[number]['id']) => {
    const preset = PARAMETER_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    const maxTemp = providerId === 'anthropic' ? 1 : 2;
    onParamsChange({
      ...params,
      temperature: Math.min(preset.values.temperature, maxTemp),
      topP: preset.values.topP,
      frequencyPenalty: providerId === 'anthropic' ? 0 : preset.values.frequencyPenalty,
      presencePenalty: providerId === 'anthropic' ? 0 : preset.values.presencePenalty,
    });
  };

  const handleAddStop = () => {
    const trimmed = stopDraft.trim();
    if (!trimmed || params.stopSequences.length >= 4) return;
    if (params.stopSequences.includes(trimmed)) {
      setStopDraft('');
      return;
    }
    onParamsChange({
      ...params,
      stopSequences: [...params.stopSequences, trimmed],
    });
    setStopDraft('');
  };

  const handleRemoveStop = (seq: string) => {
    onParamsChange({
      ...params,
      stopSequences: params.stopSequences.filter((s) => s !== seq),
    });
  };

  const panelContent = (
    <div className="flex h-full flex-col bg-white dark:bg-[#111215]">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800 lg:hidden">
        <span className="font-display text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          Parameters
        </span>
        <button
          type="button"
          onClick={onCloseMobile}
          aria-label="Close parameters panel"
          className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="kestrel-scroll flex-1 divide-y divide-zinc-200 overflow-y-auto dark:divide-zinc-800/90">
        {/* Section 1: Provider & Model */}
        <section className="space-y-3.5 p-4">
          <div className="space-y-1.5">
            <label
              htmlFor="provider-select"
              className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
            >
              Provider
            </label>
            <div className="group relative">
              <select
                id="provider-select"
                value={providerId}
                onChange={(e) => onProviderChange(e.target.value as ProviderId)}
                className="w-full cursor-pointer appearance-none rounded-lg border border-zinc-200 bg-white py-2 pr-8 pl-2.5 text-xs font-medium text-zinc-900 transition-colors hover:border-zinc-300 focus:border-[#E04F26] focus:outline-none dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-100 dark:hover:border-zinc-600 dark:focus:border-[#F0643C]"
              >
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 transition-colors group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300"
              />
            </div>
          </div>

          {providerId !== 'custom' && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="model-select"
                  className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Model
                </label>
                {modelOption && (
                  <span className="font-mono text-[11px] text-zinc-500 tabular-nums dark:text-zinc-400">
                    {modelOption.contextWindow} ctx
                  </span>
                )}
              </div>
              <div className="group relative">
                <select
                  id="model-select"
                  value={modelId}
                  onChange={(e) => onModelChange(e.target.value)}
                  className="w-full cursor-pointer appearance-none rounded-lg border border-zinc-200 bg-white py-2 pr-8 pl-2.5 font-mono text-xs text-zinc-900 transition-colors hover:border-zinc-300 focus:border-[#E04F26] focus:outline-none dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-100 dark:hover:border-zinc-600 dark:focus:border-[#F0643C]"
                >
                  {provider.models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 text-zinc-400 transition-colors group-hover:text-zinc-600 dark:text-zinc-500 dark:group-hover:text-zinc-300"
                />
              </div>
            </div>
          )}

          {providerId === 'custom' && (
            <div className="space-y-3">
              <div className="space-y-1.5">
                <label
                  htmlFor="custom-base-url"
                  className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Base URL
                </label>
                <input
                  id="custom-base-url"
                  type="url"
                  value={customBaseUrl}
                  onChange={(e) => onCustomBaseUrlChange(e.target.value)}
                  placeholder="https://api.together.xyz/v1"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-[#E04F26] focus:outline-none dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-100 dark:focus:border-[#F0643C]"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="custom-model-id"
                  className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                >
                  Model ID
                </label>
                <input
                  id="custom-model-id"
                  type="text"
                  value={customModelId}
                  onChange={(e) => onCustomModelIdChange(e.target.value)}
                  placeholder="meta-llama/Llama-3.3-70B-Instruct-Turbo"
                  className="w-full rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-[#E04F26] focus:outline-none dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-100 dark:focus:border-[#F0643C]"
                />
              </div>
            </div>
          )}

          {providerId !== 'custom' && providerId !== 'sandbox' && (
            <div className="space-y-1">
              <label
                htmlFor="model-override-input"
                className="block text-[11px] text-zinc-500 dark:text-zinc-400"
              >
                Custom model ID override (optional)
              </label>
              <input
                id="model-override-input"
                type="text"
                value={customModelId}
                onChange={(e) => onCustomModelIdChange(e.target.value)}
                placeholder={modelId}
                className="w-full rounded-lg border border-zinc-200 bg-transparent px-2.5 py-1.5 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-[#E04F26] focus:outline-none dark:border-zinc-800 dark:text-zinc-100 dark:placeholder:text-zinc-600 dark:focus:border-[#F0643C]"
              />
            </div>
          )}

          {/* Key Status Summary */}
          {provider.requiresKey ? (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-700 dark:text-zinc-300">
                    <KeyRound className="h-3.5 w-3.5 shrink-0 text-zinc-400" />
                    <span className="truncate">
                      {activeKeyEntry
                        ? activeKeyEntry.mode === 'local'
                          ? 'Saved locally'
                          : 'Session key'
                        : 'No API key set'}
                    </span>
                  </div>
                  {activeKeyEntry && (
                    <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500 dark:text-zinc-400">
                      {maskApiKey(activeKeyEntry.key)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  {hasAnySessionKey && (
                    <button
                      type="button"
                      onClick={onClearSessionKeys}
                      aria-label="End session and clear temporary keys"
                      title="Clear temporary session keys"
                      className="rounded-md border border-zinc-200 p-1 text-zinc-500 transition-colors hover:bg-zinc-50 hover:text-zinc-900 dark:border-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onOpenApiKeyModal}
                    className="rounded-md border border-zinc-200 px-2.5 py-1 text-xs font-medium text-zinc-700 whitespace-nowrap transition-colors hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
                  >
                    {activeKeyEntry ? 'Manage' : 'Set key'}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400">
              Built-in Sandbox runs without an API key so you can test prompts and web search immediately.
            </p>
          )}
        </section>

        {/* Section 2: Sampling Controls */}
        <section className="space-y-4 p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-zinc-900 dark:text-zinc-100">
              Parameters
            </span>
            {samplingDisabled ? (
              <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                Auto-managed
              </span>
            ) : (
              <span className="font-mono text-[11px] capitalize text-zinc-400 dark:text-zinc-500">
                {activePreset}
              </span>
            )}
          </div>

          {/* Preset Bar */}
          {!samplingDisabled && (
            <div
              className="grid grid-cols-3 gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-[#181A1F]"
              role="group"
              aria-label="Sampling presets"
            >
              {PARAMETER_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  title={preset.description}
                  aria-pressed={activePreset === preset.id}
                  onClick={() => handleApplyPreset(preset.id)}
                  className={`rounded-md py-1 text-[11px] font-medium whitespace-nowrap transition-colors ${
                    activePreset === preset.id
                      ? 'bg-white text-zinc-950 shadow-xs dark:bg-[#262930] dark:text-zinc-50'
                      : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          )}

          <SliderControl
            id="param-temperature"
            label="Temperature"
            qualifier={describeTemperature(params.temperature)}
            hint="Controls randomness: lower is deterministic, higher is more varied."
            value={params.temperature}
            min={0}
            max={providerId === 'anthropic' ? 1 : 2}
            step={0.05}
            disabled={samplingDisabled}
            onChange={(temperature) => onParamsChange({ ...params, temperature })}
          />

          <SliderControl
            id="param-top-p"
            label="Top P"
            hint="Nucleus sampling: limits token choices to the top probability mass."
            value={params.topP}
            min={0}
            max={1}
            step={0.05}
            disabled={samplingDisabled}
            onChange={(topP) => onParamsChange({ ...params, topP })}
          />

          <SliderControl
            id="param-max-tokens"
            label="Max completion tokens"
            hint="Upper limit on tokens generated in a single reply."
            value={Math.min(params.maxTokens, maxAllowedTokens)}
            min={64}
            max={maxAllowedTokens}
            step={64}
            disabled={providerId === 'sandbox'}
            onChange={(maxTokens) => onParamsChange({ ...params, maxTokens })}
          />

          {/* Collapsible Advanced Section */}
          <div className="pt-1">
            <button
              type="button"
              onClick={() => setShowAdvanced((prev) => !prev)}
              aria-expanded={showAdvanced}
              className="flex w-full items-center justify-between py-1 text-xs font-medium text-zinc-600 transition-colors hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-100"
            >
              <span>Advanced</span>
              <ChevronRight
                className={`h-3.5 w-3.5 transition-transform duration-150 ${
                  showAdvanced ? 'rotate-90' : 'rotate-0'
                }`}
              />
            </button>

            <AnimatePresence initial={false}>
              {showAdvanced && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 space-y-4">
                <SliderControl
                  id="param-frequency-penalty"
                  label="Frequency penalty"
                  hint="Reduces verbatim repetition of frequent tokens."
                  value={params.frequencyPenalty}
                  min={-2}
                  max={2}
                  step={0.1}
                  disabled={samplingDisabled || providerId === 'anthropic'}
                  onChange={(frequencyPenalty) =>
                    onParamsChange({ ...params, frequencyPenalty })
                  }
                />

                <SliderControl
                  id="param-presence-penalty"
                  label="Presence penalty"
                  hint="Encourages introducing new topics and words."
                  value={params.presencePenalty}
                  min={-2}
                  max={2}
                  step={0.1}
                  disabled={samplingDisabled || providerId === 'anthropic'}
                  onChange={(presencePenalty) =>
                    onParamsChange({ ...params, presencePenalty })
                  }
                />

                <div className="space-y-1.5">
                  <label
                    htmlFor="param-seed"
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Seed (optional)
                  </label>
                  <input
                    id="param-seed"
                    type="text"
                    inputMode="numeric"
                    value={params.seed}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9-]/g, '');
                      onParamsChange({ ...params, seed: val });
                    }}
                    placeholder="e.g. 42"
                    className="w-full rounded-lg border border-zinc-200 bg-transparent px-2.5 py-1.5 font-mono text-xs text-zinc-900 tabular-nums placeholder:text-zinc-400 focus:border-[#E04F26] focus:outline-none dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-[#F0643C]"
                  />
                </div>

                {/* Stop Sequences */}
                <div className="space-y-1.5">
                  <label
                    htmlFor="param-stop-sequence"
                    className="block text-xs font-medium text-zinc-700 dark:text-zinc-300"
                  >
                    Stop sequences ({params.stopSequences.length}/4)
                  </label>
                  <div className="flex items-center gap-1.5">
                    <input
                      id="param-stop-sequence"
                      type="text"
                      value={stopDraft}
                      disabled={params.stopSequences.length >= 4 || providerId === 'sandbox'}
                      onChange={(e) => setStopDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddStop();
                        }
                      }}
                      placeholder="Add token or phrase"
                      className="min-w-0 flex-1 rounded-lg border border-zinc-200 bg-transparent px-2.5 py-1.5 font-mono text-xs text-zinc-900 placeholder:text-zinc-400 focus:border-[#E04F26] focus:outline-none disabled:opacity-45 dark:border-zinc-800 dark:text-zinc-100 dark:focus:border-[#F0643C]"
                    />
                    <button
                      type="button"
                      onClick={handleAddStop}
                      disabled={!stopDraft.trim() || params.stopSequences.length >= 4 || providerId === 'sandbox'}
                      aria-label="Add stop sequence"
                      className="rounded-lg border border-zinc-200 p-1.5 text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  </div>

                  {params.stopSequences.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      {params.stopSequences.map((seq) => (
                        <button
                          key={seq}
                          type="button"
                          onClick={() => handleRemoveStop(seq)}
                          aria-label={`Remove stop sequence ${seq}`}
                          className="inline-flex items-center gap-1 rounded border border-zinc-200 bg-zinc-50 px-2 py-0.5 font-mono text-[11px] text-zinc-700 hover:border-zinc-300 dark:border-zinc-700 dark:bg-[#181A1F] dark:text-zinc-300"
                        >
                          <span>{seq}</span>
                          <X className="h-3 w-3 text-zinc-400" />
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>

        {/* Section 3: Tools & Output */}
        <section className="space-y-4 p-4">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            <Globe className="h-3.5 w-3.5 text-zinc-400" />
            <span>Tools & Output</span>
          </div>

          <ToggleRow
            id="toggle-browser-search"
            label="Browser Search"
            description={
              modelOption?.nativeBrowserSearch
                ? 'Uses native web search grounding with citations.'
                : 'Fetches live web snippets and injects citations into context.'
            }
            checked={params.browserSearch}
            onChange={(checked) =>
              onParamsChange({
                ...params,
                browserSearch: checked,
                jsonMode: checked && providerId === 'sandbox' ? false : params.jsonMode,
              })
            }
          />

          <ToggleRow
            id="toggle-json-mode"
            label="JSON Mode"
            description="Constrain output to valid JSON object syntax."
            checked={params.jsonMode}
            disabled={providerId === 'anthropic' || (providerId === 'sandbox' && params.browserSearch)}
            onChange={(checked) => onParamsChange({ ...params, jsonMode: checked })}
          />

          <ToggleRow
            id="toggle-stream"
            label="Stream responses"
            description="Render tokens incrementally as they generate."
            checked={params.stream}
            onChange={(checked) => onParamsChange({ ...params, stream: checked })}
          />

          {modelOption?.supportsReasoning && (
            <div className="space-y-1.5 pt-1">
              <span className="block text-xs font-medium text-zinc-700 dark:text-zinc-300">
                Reasoning effort
              </span>
              <div className="grid grid-cols-4 gap-1 rounded-lg bg-zinc-100 p-0.5 dark:bg-[#181A1F]">
                {(['default', 'low', 'medium', 'high'] as ReasoningEffort[]).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => onParamsChange({ ...params, reasoningEffort: level })}
                    className={`rounded-md py-1 text-[11px] font-medium capitalize transition-colors ${
                      params.reasoningEffort === level
                        ? 'bg-white text-zinc-950 shadow-xs dark:bg-[#262930] dark:text-zinc-50'
                        : 'text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100'
                    }`}
                  >
                    {level === 'default' ? 'Auto' : level}
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Footer Reset */}
      <div className="border-t border-zinc-200 p-3 dark:border-zinc-800">
        <button
          type="button"
          onClick={onResetDefaults}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg py-1.5 text-xs font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-950 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-100"
        >
          <RotateCcw className="h-3.5 w-3.5" />
          <span>Reset defaults</span>
        </button>
      </div>
    </div>
  );

  return (
    <>
      {/* Desktop Rail */}
      {isOpenDesktop && (
        <aside
          aria-label="Model parameters"
          className="hidden w-[280px] shrink-0 border-l border-zinc-200 dark:border-zinc-800 lg:block xl:w-[312px] 2xl:w-[340px]"
        >
          {panelContent}
        </aside>
      )}

      {/* Mobile / Tablet Slide-over Drawer */}
      <AnimatePresence>
        {isOpenMobile && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16, ease: 'easeOut' }}
            className="fixed inset-0 z-40 flex justify-end bg-black/40 backdrop-blur-[1px] lg:hidden"
            role="dialog"
            aria-modal="true"
            aria-label="Model parameters drawer"
            onClick={(e) => {
              if (e.target === e.currentTarget) onCloseMobile();
            }}
          >
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
              className="h-full w-[308px] max-w-[88vw] border-l border-zinc-200 shadow-2xl dark:border-zinc-800"
            >
              {panelContent}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

