/**
 * LLM Service — provider-agnostic LLM request handling.
 *
 * One handler per provider (OpenAI, Anthropic, Gemini) plus a router that
 * dispatches by model name. Each handler normalizes the provider response
 * into a common LLMResponse shape.
 */

export type { LLMRequest, LLMResponse, LLMUsage, LLMStreamRequest, LLMStreamResponse, Message, Provider } from './types.js'

export {
  handleLLMRequest,
  handleLLMStreamRequest,
  handleAnthropicRequest,
  handleOpenAIRequest,
  handleGeminiRequest,
  handleOpenAIStreamRequest,
  getProviderForModel,
} from './providers/index.js'

// Tiktoken helper for gpt-4o-mini-tts input-token counting.
export { countGpt4oMiniTtsInputTokens } from './tts_tokens.js'

// Streaming utilities — response splitting + TTS batching + NDJSON framing
// primitives reused across LLM + combined LLM+TTS endpoints (see streaming/).
export {
  ResponseSplitter,
  wordCount,
  nthWordEndPosition,
  findBoundaryAfter,
  openaiTtsStream,
  TTS_TARGET_BYTES,
  beginNdjsonStream,
  writeNdjsonLine,
} from './streaming/index.js'
export type {
  ResponseSplitterOptions,
  OpenAITtsStreamOptions,
  NdjsonStreamResponse,
} from './streaming/index.js'
