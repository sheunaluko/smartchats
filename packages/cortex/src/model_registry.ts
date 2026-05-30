/**
 * Model Registry - Token limits and pricing for AI models
 * Updated: 2026-02-01 from official provider documentation
 * Prices are in USD per million tokens (MTok)
 */

import { Provider } from './types.js'

/**
 * Structural shape we accept for cost calculation. Mirrors llm-service's
 * LLMUsage but defined locally to avoid adding cortex → llm-service dep.
 */
export interface UsageForCost {
  input_tokens: number
  output_tokens: number
  cached_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface ModelInfo {
  id: string
  provider: Provider
  contextWindow: number
  maxOutputTokens: number
  inputPricePer1M: number
  outputPricePer1M: number
  cachedInputPricePer1M?: number  // Defaults to inputPricePer1M / 10
  cacheWritePricePer1M?: number   // Defaults to inputPricePer1M (no surcharge).
                                  // For Anthropic 5-min ephemeral cache: 1.25× base.
  description?: string
  tiktokenEncoding?: string  // e.g., 'cl100k_base', 'o200k_base'
}

/**
 * Get the cached input price for a model. Falls back to inputPricePer1M / 10
 * (most providers use ~90% discount for cached prompt tokens).
 */
export function getCachedInputPrice(info: ModelInfo): number {
  return info.cachedInputPricePer1M ?? info.inputPricePer1M / 10
}

/**
 * Get the cache-WRITE price (tokens billed when a new cache entry is created).
 * Anthropic ephemeral 5-min cache writes at 1.25× base input; Anthropic 1-hour
 * cache writes at 2× (we deliberately do not enable that path — see
 * smartchats-cloud/profitability_considerations.txt).
 *
 * Defensive fallback: when unset, returns inputPricePer1M (= the pre-fix
 * behavior). Better than 0 (silent zero-billing) for any future Claude model
 * added without the explicit cacheWritePricePer1M field.
 */
export function getCacheWritePrice(info: ModelInfo): number {
  return info.cacheWritePricePer1M ?? info.inputPricePer1M
}

export const MODEL_REGISTRY: Record<string, ModelInfo> = {
  // ============================================
  // ANTHROPIC MODELS
  // ============================================
  "claude-opus-4-5": {
    id: "claude-opus-4-5-20251101",
    provider: "anthropic",
    inputPricePer1M: 5,
    outputPricePer1M: 25,
    cacheWritePricePer1M: 6.25,   // 1.25× base — Anthropic 5m ephemeral
    contextWindow: 200000,
    maxOutputTokens: 64000,
    description: "Premium model combining maximum intelligence with practical performance",
    tiktokenEncoding: "cl100k_base",
  },
  "claude-sonnet-4-5": {
    id: "claude-sonnet-4-5-20250929",
    provider: "anthropic",
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    cacheWritePricePer1M: 3.75,   // 1.25× base — Anthropic 5m ephemeral
    contextWindow: 200000,  // 1M tokens available in beta
    maxOutputTokens: 64000,
    description: "Smart model for complex agents and coding",
    tiktokenEncoding: "cl100k_base",
  },
  "claude-haiku-4-5": {
    id: "claude-haiku-4-5-20251001",
    provider: "anthropic",
    inputPricePer1M: 1,
    outputPricePer1M: 5,
    cacheWritePricePer1M: 1.25,   // 1.25× base — Anthropic 5m ephemeral
    contextWindow: 200000,
    maxOutputTokens: 64000,
    description: "Fastest model with near-frontier intelligence",
    tiktokenEncoding: "cl100k_base",
  },
  "claude-opus-4-6": {
    id: "claude-opus-4-6",
    provider: "anthropic",
    inputPricePer1M: 5,           // same as opus 4.5
    outputPricePer1M: 25,
    cacheWritePricePer1M: 6.25,   // 1.25× base — Anthropic 5m ephemeral
    contextWindow: 1000000,       // 1M GA starting in 4.6 (was 200K in 4.5)
    maxOutputTokens: 128000,      // grew from 64K in 4.5
    description: "Opus 4.6 — 1M context window",
    tiktokenEncoding: "cl100k_base",
  },
  "claude-opus-4-7": {
    id: "claude-opus-4-7",
    provider: "anthropic",
    inputPricePer1M: 5,           // same as opus 4.5
    outputPricePer1M: 25,
    cacheWritePricePer1M: 6.25,   // 1.25× base — Anthropic 5m ephemeral
    contextWindow: 1000000,
    maxOutputTokens: 128000,
    description: "Most intelligent Claude — 1M context, 128K output",
    tiktokenEncoding: "cl100k_base",
  },
  "claude-sonnet-4-6": {
    id: "claude-sonnet-4-6",
    provider: "anthropic",
    inputPricePer1M: 3,           // same as sonnet 4.5
    outputPricePer1M: 15,
    cacheWritePricePer1M: 3.75,   // 1.25× base — Anthropic 5m ephemeral
    contextWindow: 1000000,       // 1M GA in 4.6
    maxOutputTokens: 64000,
    description: "Sonnet 4.6 — agentic coding with 1M context",
    tiktokenEncoding: "cl100k_base",
  },

  // ============================================
  // GOOGLE GEMINI MODELS
  // ============================================
  // Retired by Google (2026-05): `models/gemini-3-pro-preview` returns 404
  // "no longer available". Successor on the same pricing tier is
  // gemini-3.1-pro-preview (defined below). Kept commented for grep-history.
  // "gemini-3-pro-preview": {
  //   id: "gemini-3-pro-preview",
  //   provider: "gemini",
  //   inputPricePer1M: 2,         // $4/MTok for >200k tokens
  //   outputPricePer1M: 12,       // $18/MTok for >200k tokens
  //   contextWindow: 1000000,
  //   maxOutputTokens: 64000,
  //   description: "Best for complex tasks requiring broad world knowledge and advanced reasoning",
  //   tiktokenEncoding: "cl100k_base",
  // },
  "gemini-3-flash-preview": {
    id: "gemini-3-flash-preview",
    provider: "gemini",
    inputPricePer1M: 0.5,
    outputPricePer1M: 3,
    contextWindow: 1000000,
    maxOutputTokens: 64000,
    description: "Pro-level intelligence at Flash speed and pricing",
    tiktokenEncoding: "cl100k_base",
  },
  "gemini-3-pro-image-preview": {
    id: "gemini-3-pro-image-preview",
    provider: "gemini",
    inputPricePer1M: 2,
    outputPricePer1M: 0.134,    // per image output
    contextWindow: 65000,
    maxOutputTokens: 32000,
    description: "Highest quality image generation model",
    tiktokenEncoding: "cl100k_base",
  },
  "gemini-3.1-pro-preview": {
    id: "gemini-3.1-pro-preview",
    provider: "gemini",
    inputPricePer1M: 2,           // $4/MTok for prompts >200k tokens
    outputPricePer1M: 12,         // $18/MTok for prompts >200k tokens
    cachedInputPricePer1M: 0.2,   // not officially listed; mirrors 3-pro convention (input/10)
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    description: "Improved multimodal + agentic reasoning preview",
    tiktokenEncoding: "cl100k_base",
  },
  "gemini-3.5-flash": {
    id: "gemini-3.5-flash",
    provider: "gemini",
    inputPricePer1M: 1.5,
    outputPricePer1M: 9,          // includes thinking tokens
    cachedInputPricePer1M: 0.15,  // context caching price (paid tier)
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    description: "Frontier intelligence at Flash speed; built for search + grounding",
    tiktokenEncoding: "cl100k_base",
  },
  "gemini-3.1-flash-lite": {
    id: "gemini-3.1-flash-lite",
    provider: "gemini",
    inputPricePer1M: 0.25,        // $0.50/MTok for audio input
    outputPricePer1M: 1.5,        // includes thinking tokens
    cachedInputPricePer1M: 0.025, // $0.05/MTok for audio
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    description: "Cost-efficient model for high-volume agentic tasks + translation",
    tiktokenEncoding: "cl100k_base",
  },

  // ============================================
  // OPENAI MODELS
  // ============================================
  "gpt-4.1": {
    id: "gpt-4.1-2025-04-14",
    provider: "openai",
    inputPricePer1M: 2,
    outputPricePer1M: 8,
    contextWindow: 1047576,
    maxOutputTokens: 32768,
    description: "Smartest non-reasoning model with 1M context window",
    tiktokenEncoding: "o200k_base",
  },
  "gpt-5": {
    id: "gpt-5-2025-08-07",
    provider: "openai",
    inputPricePer1M: 1.25,
    outputPricePer1M: 10,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    description: "Intelligent reasoning model for coding and agentic tasks",
    tiktokenEncoding: "o200k_base",
  },
  "gpt-5-mini": {
    id: "gpt-5-mini-2025-08-07",
    provider: "openai",
    inputPricePer1M: 0.25,
    outputPricePer1M: 2,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    description: "Faster, cost-efficient version of GPT-5",
    tiktokenEncoding: "o200k_base",
  },
  "gpt-5-nano": {
    id: "gpt-5-nano-2025-08-07",
    provider: "openai",
    inputPricePer1M: 0.05,
    outputPricePer1M: 0.4,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    description: "Fastest, most cost-efficient version of GPT-5",
    tiktokenEncoding: "o200k_base",
  },
  "gpt-5.2": {
    id: "gpt-5.2-2025-12-11",
    provider: "openai",
    inputPricePer1M: 1.75,
    outputPricePer1M: 14,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    description: "Best model for coding and agentic tasks across industries",
    tiktokenEncoding: "o200k_base",
  },
  "gpt-5.2-pro": {
    id: "gpt-5.2-pro-2025-12-11",
    provider: "openai",
    inputPricePer1M: 21,
    outputPricePer1M: 168,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    description: "Smarter, more precise version of GPT-5.2",
    tiktokenEncoding: "o200k_base",
  },
  "gpt-5.2-codex": {
    id: "gpt-5.2-codex",
    provider: "openai",
    inputPricePer1M: 1.75,
    outputPricePer1M: 14,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    description: "Most intelligent coding model for long-horizon agentic tasks",
    tiktokenEncoding: "o200k_base",
  },
  "gpt-5.4": {
    id: "gpt-5.4",
    provider: "openai",
    inputPricePer1M: 2.5,
    cachedInputPricePer1M: 0.25,
    outputPricePer1M: 15,
    contextWindow: 1000000,       // prompts >272K input → 2x input / 1.5x output for the session
    maxOutputTokens: 128000,
    description: "GPT-5.4 — 1M context, coding + agentic",
    tiktokenEncoding: "o200k_base",
  },
  "gpt-5.4-mini": {
    id: "gpt-5.4-mini",
    provider: "openai",
    inputPricePer1M: 0.75,
    cachedInputPricePer1M: 0.075,
    outputPricePer1M: 4.5,
    contextWindow: 400000,
    maxOutputTokens: 128000,
    description: "Cost-efficient version of GPT-5.4",
    tiktokenEncoding: "o200k_base",
  },
  "gpt-5.5": {
    id: "gpt-5.5",
    provider: "openai",
    inputPricePer1M: 5,
    cachedInputPricePer1M: 0.5,
    outputPricePer1M: 30,
    contextWindow: 1000000,       // prompts >272K input → 2x input / 1.5x output for the session
    maxOutputTokens: 128000,
    description: "Most intelligent GPT — 1M context, frontier reasoning",
    tiktokenEncoding: "o200k_base",
  },
  "o4-mini": {
    id: "o4-mini-2025-04-16",
    provider: "openai",
    inputPricePer1M: 1.1,
    outputPricePer1M: 4.4,
    contextWindow: 200000,
    maxOutputTokens: 100000,
    description: "Fast, cost-efficient reasoning model for coding and visual tasks",
    tiktokenEncoding: "o200k_base",
  },
}

// ============================================================================
// TTS pricing (not in MODEL_REGISTRY — different semantics: byte output)
// ============================================================================

/**
 * Pricing for OpenAI `gpt-4o-mini-tts`.
 *
 * Input:  $0.60 / 1M input tokens   (text, counted via tiktoken o200k_base)
 * Output: $12.00 / 1M audio tokens  (approximated from PCM byte count)
 *
 * The speech endpoint does NOT return usage counts in the response — we must
 * estimate. Approach:
 *   - Input tokens: caller tokenizes the input text and passes `inputTokens`.
 *   - Output tokens: 1 audio token = 50ms of audio (OpenAI Realtime API convention,
 *     likely identical for gpt-4o-mini-tts). At 24kHz mono 16-bit PCM:
 *       50ms × 24000 samples/s × 2 bytes/sample = 2400 bytes/token
 *   - Safety margin (1.02): biases the estimate upward by ~2% so we don't
 *     under-charge when the ratio drifts or short utterances have framing
 *     overhead. Users of this cost in billing contexts absorb <2% overcharge
 *     in exchange for never running a per-call loss. Revisit when OpenAI
 *     ships token counts in response headers.
 */
export const GPT4O_MINI_TTS_PRICING = {
    model: 'gpt-4o-mini-tts',
    provider: 'openai' as const,
    inputPricePer1M: 0.60,
    outputPricePer1M: 12.00,
    pcmBytesPerAudioToken: 2400,
    pcmSampleRate: 24000,
    safetyMargin: 1.02,
    tiktokenEncoding: 'o200k_base',
} as const;

export interface TtsCostEstimate {
    inputTokens: number;
    outputTokens: number;
    rawCostUsd: number;
    costUsd: number;
    breakdown: { inputCostUsd: number; outputCostUsd: number; safetyMargin: number };
}

/**
 * Compute gpt-4o-mini-tts cost from pre-counted input tokens + output PCM byte count.
 * Caller is responsible for tiktoken-counting the input text with o200k_base.
 */
export function estimateGpt4oMiniTtsCost(args: {
    inputTokens: number;
    outputPcmBytes: number;
}): TtsCostEstimate {
    const p = GPT4O_MINI_TTS_PRICING;
    const outputTokens = Math.ceil(args.outputPcmBytes / p.pcmBytesPerAudioToken);
    const inputCostUsd = (args.inputTokens * p.inputPricePer1M) / 1_000_000;
    const outputCostUsd = (outputTokens * p.outputPricePer1M) / 1_000_000;
    const rawCostUsd = inputCostUsd + outputCostUsd;
    return {
        inputTokens: args.inputTokens,
        outputTokens,
        rawCostUsd,
        costUsd: rawCostUsd * p.safetyMargin,
        breakdown: { inputCostUsd, outputCostUsd, safetyMargin: p.safetyMargin },
    };
}

const DEFAULT_MODEL_INFO: Record<Provider, Omit<ModelInfo, 'id'>> = {
  openai: {
    provider: 'openai',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputPricePer1M: 2,
    outputPricePer1M: 8,
    tiktokenEncoding: 'o200k_base',
  },
  anthropic: {
    provider: 'anthropic',
    contextWindow: 200000,
    maxOutputTokens: 64000,
    inputPricePer1M: 3,
    outputPricePer1M: 15,
    tiktokenEncoding: 'cl100k_base',
  },
  gemini: {
    provider: 'gemini',
    contextWindow: 1048576,
    maxOutputTokens: 65536,
    inputPricePer1M: 0.5,
    outputPricePer1M: 3,
    tiktokenEncoding: 'cl100k_base',
  },
}

/**
 * Get model info by name, with optional provider for fallback defaults
 */
export function getModelInfo(model: string, provider?: Provider): ModelInfo {
  // Direct lookup
  if (MODEL_REGISTRY[model]) {
    return MODEL_REGISTRY[model]
  }

  // Try prefix matching (e.g., "gpt-5.2-2025-12-11" matches "gpt-5.2")
  for (const [key, info] of Object.entries(MODEL_REGISTRY)) {
    if (model.startsWith(key) || key.startsWith(model)) {
      return { ...info, id: model }
    }
  }

  // Fall back to defaults
  const inferredProvider = provider || inferProviderFromModel(model)
  const defaults = DEFAULT_MODEL_INFO[inferredProvider]
  return { id: model, ...defaults }
}

function inferProviderFromModel(model: string): Provider {
  if (model.startsWith('claude-')) return 'anthropic'
  if (model.startsWith('gemini-')) return 'gemini'
  return 'openai'
}

/**
 * Get list of all registered model names
 */
export function getRegisteredModels(): string[] {
  return Object.keys(MODEL_REGISTRY)
}

/**
 * Calculate cost for a request in USD.
 *
 * Accepts the full usage object so each token-class is billed at its correct rate:
 *   - cache_creation_input_tokens → cacheWritePricePer1M (Anthropic 5m: 1.25× base)
 *   - cached_input_tokens         → cachedInputPricePer1M (~10% of base)
 *   - everything else (input_tokens - cached - creation) → inputPricePer1M
 *   - output_tokens               → outputPricePer1M
 *
 * Provider semantic: providers normalize `input_tokens` to be the TOTAL (matches
 * OpenAI's convention), so the uncached portion is the total minus both cache
 * sub-counts. See packages/llm-service/src/providers/anthropic.ts:59,89 for the
 * normalization step.
 */
export function calculateCost(
  model: string,
  usage: UsageForCost,
  provider?: Provider
): number {
  const info = getModelInfo(model, provider)
  const cached = usage.cached_input_tokens ?? 0
  const creation = usage.cache_creation_input_tokens ?? 0
  const uncached = usage.input_tokens - cached - creation
  const inputCost = (uncached / 1_000_000) * info.inputPricePer1M
  const cachedCost = (cached / 1_000_000) * getCachedInputPrice(info)
  const creationCost = (creation / 1_000_000) * getCacheWritePrice(info)
  const outputCost = (usage.output_tokens / 1_000_000) * info.outputPricePer1M
  return inputCost + cachedCost + creationCost + outputCost
}

/**
 * Get all models for a specific provider
 */
export function getModelsByProvider(provider: Provider): ModelInfo[] {
  return Object.values(MODEL_REGISTRY).filter(m => m.provider === provider)
}
