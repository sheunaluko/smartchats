export {
    ResponseSplitter,
    wordCount,
    nthWordEndPosition,
    findBoundaryAfter,
} from './response_splitter.js'
export type { ResponseSplitterOptions } from './response_splitter.js'

export { openaiTtsStream, TTS_TARGET_BYTES } from './openai_tts.js'
export type { OpenAITtsStreamOptions } from './openai_tts.js'

export { beginNdjsonStream, writeNdjsonLine } from './ndjson_writer.js'
export type { NdjsonStreamResponse } from './ndjson_writer.js'

// Combined LLM + TTS orchestrator — see ./CLAUDE.md for the contract.
export { streamLlmTtsToNdjson } from './stream_llm_tts_to_ndjson.js'
export type {
    StreamLlmTtsToNdjsonOptions,
    StreamLlmTtsToNdjsonResult,
} from './stream_llm_tts_to_ndjson.js'

// Text-only LLM streaming orchestrator — the smaller twin of the combined
// one. Wire-format discriminator is { t: 'delta', d } (NOT 'text') for
// historical compat with client adapters.
export { streamLlmToNdjson } from './stream_llm_to_ndjson.js'
export type {
    StreamLlmToNdjsonOptions,
    StreamLlmToNdjsonResult,
} from './stream_llm_to_ndjson.js'

// Formalized telemetry + wire schemas (see ./CLAUDE.md § ServerTimingEvent
// schema and § NDJSON wire format).
export type {
    NdjsonFrame,
    TextFrame, AudioStartFrame, AudioFrame, AudioEndFrame, AudioErrorFrame,
    ErrorFrame, LlmDoneFrame, DoneFrame, ServerTimingFrame,
    ServerTimingEvent, ServerTimingPhase,
    LlmServerTimingPhase, TtsServerTimingPhase,
    TtsTimingEvent, TtsStreamFn, TtsStreamFnOpts,
} from './types.js'
