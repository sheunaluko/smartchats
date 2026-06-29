/**
 * Formalized types for the combined LLM+TTS streaming pipeline.
 *
 * Two discriminated unions live here:
 *
 *   1. **NdjsonFrame** — every line type that may appear on the wire. The
 *      `t` discriminator is the contract clients (smartchats-backend-local,
 *      smartchats-backend-firebase, future wire consumers) parse against.
 *      Adding a new `t` value is a wire-format change and demands a client
 *      update in the same commit.
 *
 *   2. **ServerTimingEvent** — every phase the server may stamp for the
 *      client to emit as `tts_server_timing` / `llm_server_timing` insights
 *      events. The phase set was historically scattered between the cloud
 *      handler's `writeLine` calls (where it lived as ad-hoc string
 *      literals) and the openai_tts `OpenAITtsTimingEvent` (which fed those
 *      lines via the `onTiming` hook). Promoting both to a single typed
 *      union here lets test code, client parsers, and Sail dashboard
 *      schemas all reference the same source of truth.
 *
 * Stable across cloud + local handlers — both emit the same union, both
 * sets of clients parse against the same shape. Telemetry dashboards keyed
 * off `phase` work against either source unchanged.
 */

// ────────────────────────────────────────────────────────────────────────────
// ServerTimingEvent — telemetry phases stamped on the NDJSON stream
// ────────────────────────────────────────────────────────────────────────────

/**
 * LLM-side phases. Stamped at most once per request.
 *
 * Timeline:
 *   client_click → llm_function_received → llm_request_start → llm_first_byte
 *
 * Cross-process clock deltas (e.g. client_click → llm_function_received) are
 * caveat'd in dashboards because browser and Functions clocks may drift tens
 * of ms; same-process deltas (e.g. function_received → request_start) are
 * wall-clock-safe.
 */
export type LlmServerTimingPhase =
    | 'llm_function_received'
    | 'llm_request_start'
    | 'llm_first_byte'

/**
 * TTS-side phases. Stamped per-chunk; `s` (chunk index) discriminates.
 *
 * Per-chunk timeline:
 *   tts_request_start → tts_first_byte → tts_batch_yield* → tts_request_complete
 *
 * `tts_first_byte` is the OpenAI / provider HTTP first-byte arrival. Each
 * `tts_batch_yield` corresponds to one PCM batch the orchestrator hands
 * downstream as an `audio` frame.
 */
export type TtsServerTimingPhase =
    | 'tts_request_start'
    | 'tts_first_byte'
    | 'tts_batch_yield'
    | 'tts_request_complete'

export type ServerTimingPhase = LlmServerTimingPhase | TtsServerTimingPhase

/**
 * Common fields on every server_timing event. Note that absolute `ts` is
 * wall-clock ms (`Date.now()`) and primarily useful for cross-process
 * correlation; same-process deltas (`ms_since_*`) are derived in-handler
 * and preferred for in-dashboard math.
 */
interface ServerTimingBase {
    t: 'server_timing'
}

export type ServerTimingEvent =
    | (ServerTimingBase & { phase: 'llm_function_received'; ts: number })
    | (ServerTimingBase & { phase: 'llm_request_start'; ts: number; ms_since_function_received: number })
    | (ServerTimingBase & { phase: 'llm_first_byte'; ts: number; ms_since_request_start: number; ms_since_function_received: number })
    | (ServerTimingBase & { phase: 'tts_request_start'; s: number; ts: number })
    | (ServerTimingBase & { phase: 'tts_first_byte'; s: number; ts: number })
    | (ServerTimingBase & {
        phase: 'tts_batch_yield'
        s: number
        batch: number
        ts: number
        bytes: number
        /** Cumulative provider HTTP-body bytes received since `tts_request_start`. */
        provider_bytes_total: number
    })
    | (ServerTimingBase & {
        phase: 'tts_request_complete'
        s: number
        /** ms from `tts_request_start` to completion. */
        ts: number
        total_batches: number
        /** ms from the most recent `batch_yield` to completion (i.e. flush tail). */
        ms_since_first_byte: number
    })

// ────────────────────────────────────────────────────────────────────────────
// TtsTimingEvent — adapter-emitted hook (provider-agnostic shape)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Adapter-side timing hook. Any TTS adapter the orchestrator accepts may
 * call this with these events; the orchestrator translates them into
 * `tts_first_byte` / `tts_batch_yield` server_timing frames.
 *
 * Renamed from `OpenAITtsTimingEvent` to generalize beyond OpenAI — the
 * field `provider_bytes_cumulative` replaces `openai_bytes_cumulative` so
 * Azure / xAI WS / Gemini Live adapters can populate the same shape.
 */
export type TtsTimingEvent =
    | { phase: 'first_byte'; ms_since_request: number }
    | {
        phase: 'batch_yield'
        batch_index: number
        ms_since_request: number
        bytes: number
        /** Cumulative HTTP-body bytes received from the provider since request_start. */
        provider_bytes_cumulative: number
    }

// ────────────────────────────────────────────────────────────────────────────
// NdjsonFrame — every line type the combined LLM+TTS stream may write
// ────────────────────────────────────────────────────────────────────────────

/** LLM text token delta. */
export interface TextFrame {
    t: 'text'
    /** Token / text delta from the upstream LLM stream. */
    d: string
}

/** TTS chunk about to start streaming PCM. */
export interface AudioStartFrame {
    t: 'audio_start'
    /** Chunk index, monotonic from 0 per response. */
    s: number
    /** First ~80 chars of the chunk text — diagnostic / debug only. */
    text: string
    /** ms since request start (handler-local). */
    ms: number
}

/** One PCM batch for TTS chunk `s`. */
export interface AudioFrame {
    t: 'audio'
    s: number
    /** Sequence number within this chunk, monotonic from 0. */
    c: number
    /** PCM16 24kHz mono bytes, base64-encoded. */
    b64: string
}

/** TTS chunk finished streaming. */
export interface AudioEndFrame {
    t: 'audio_end'
    s: number
    /** ms since request start at end. */
    ms: number
}

/** TTS chunk failed; LLM stream is unaffected. */
export interface AudioErrorFrame {
    t: 'audio_error'
    s: number
    error: string
}

/** LLM-stream-level error. Terminal for the LLM half; `done` may still come if at least one TTS chunk completed. */
export interface ErrorFrame {
    t: 'error'
    error: string
}

/** LLM aggregation arrived; client may finalize the turn (assistant message, response_complete) without waiting for trailing TTS audio. */
export interface LlmDoneFrame {
    t: 'llm_done'
    data: {
        success: boolean
        output_text: string
        usage: { input_tokens: number; output_tokens: number; cached_input_tokens: number }
        model: string
        provider: string
        finish_reason: string
        latency_ms: number
    }
}

/** Terminal frame — written exactly once on the happy path, only after every
 *  TTS promise settles. Extra fields beyond the core stats are merged from the
 *  `onBeforeDone` hook in `StreamLlmTtsToNdjsonOptions` — wrappers use this
 *  to append concern-specific data (cloud: billing envelope). */
export interface DoneFrame {
    t: 'done'
    data: {
        success: true
        /** ms from orchestrator entry to this `done` frame written. Named to
         *  match the existing wire convention (cloud + local handlers both
         *  emitted `latency_ms` historically). */
        latency_ms: number
        total_tts_chars: number
        tts_chunk_count: number
        /** Arbitrary fields merged via the `onBeforeDone` hook. */
        [key: string]: unknown
    }
}

/** Server timing line — see ServerTimingEvent for the discriminated phases. */
export type ServerTimingFrame = ServerTimingEvent

export type NdjsonFrame =
    | TextFrame
    | AudioStartFrame
    | AudioFrame
    | AudioEndFrame
    | AudioErrorFrame
    | ErrorFrame
    | LlmDoneFrame
    | DoneFrame
    | ServerTimingFrame

// ────────────────────────────────────────────────────────────────────────────
// TtsStreamFn — adapter contract the orchestrator accepts
// ────────────────────────────────────────────────────────────────────────────

export interface TtsStreamFnOpts {
    /** Text to synthesize. */
    text: string
    /** Provider-specific voice id (e.g. 'alloy', 'en-US-AvaMultilingualNeural'). */
    voice: string
    /** Optional adapter-emitted timing hook — orchestrator wires this into server_timing frames. */
    onTiming?: (event: TtsTimingEvent) => void
}

/**
 * Provider-agnostic TTS stream callable. The orchestrator takes one of these
 * (not an adapter object) so it stays trivially mockable from unit tests and
 * doesn't couple to the local-server's richer ServerTtsAdapter (which adds
 * voice catalog + cost estimate, neither of which the orchestrator needs).
 *
 * Cloud passes: `(opts) => openaiTtsStream(client, { ...opts, model, speed })`.
 * Local passes: `(opts) => adapter.stream({ ...opts })` for the resolved adapter.
 */
export type TtsStreamFn = (opts: TtsStreamFnOpts) => AsyncIterable<Buffer>
