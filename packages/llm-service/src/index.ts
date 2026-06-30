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

// OpenAI embeddings — shared helper consumed by both the open
// /embeddings/embed route and the cloud openaiEmbedding Cloud Function.
export {
    openaiEmbedding,
    EMBEDDING_MODEL,
    OpenAIEmbeddingError,
} from './embeddings.js'
export type {
    OpenAIEmbeddingOptions,
    OpenAIEmbeddingResult,
} from './embeddings.js'

// TTS provider registry — shared between the open local-server and the cloud
// llmTtsStreamHttp function so both call the same set of adapters. See
// ./tts_providers/index.ts for the registry; ./tts_providers/_types.ts for
// the ServerTtsAdapter interface implementations must satisfy.
export {
  resolveAdapter,
  DEFAULT_TTS_PROVIDER,
  getProviderStatus,
} from './tts_providers/index.js'
export type {
  TtsProviderId,
  TtsAdapterConfig,
  ServerTtsAdapter,
  TtsStreamOpts,
  TtsCostOpts,
  TtsCostEstimate,
} from './tts_providers/index.js'

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
  streamLlmTtsToNdjson,
  streamLlmToNdjson,
} from './streaming/index.js'
export type {
  ResponseSplitterOptions,
  OpenAITtsStreamOptions,
  NdjsonStreamResponse,
  StreamLlmTtsToNdjsonOptions,
  StreamLlmTtsToNdjsonResult,
  StreamLlmToNdjsonOptions,
  StreamLlmToNdjsonResult,
  NdjsonFrame,
  TextFrame, AudioStartFrame, AudioFrame, AudioEndFrame, AudioErrorFrame,
  ErrorFrame, LlmDoneFrame, DoneFrame, ServerTimingFrame,
  ServerTimingEvent, ServerTimingPhase,
  LlmServerTimingPhase, TtsServerTimingPhase,
  TtsTimingEvent, TtsStreamFn, TtsStreamFnOpts,
} from './streaming/index.js'
