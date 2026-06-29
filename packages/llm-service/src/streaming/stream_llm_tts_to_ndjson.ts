/**
 * Combined LLM + TTS NDJSON streaming orchestrator — the shared module that
 * both `smartchats-cloud/functions/src/llm/llm_tts_stream_http.ts` and
 * `smartchats-local-server/src/routes/llm.ts` `/llm/streamWithTTS` collapse
 * into.
 *
 * Contract: given a pre-resolved LLM stream + (optional) TTS adapter
 * callable, frame the combined output as NDJSON exactly matching the
 * `NdjsonFrame` discriminated union in ./types.ts. Stamp the documented
 * `ServerTimingEvent` phases. Return aggregated LLM result + per-call
 * counters so the caller can do its wrapper-specific concerns (billing
 * envelope on cloud, usage write on local, audit logging, etc.).
 *
 * The orchestrator owns:
 *   - JsonStreamParser → ResponseSplitter → TTS fire ladder
 *   - Audio chunk dispatch + `ttsPromises[]` accounting
 *   - NDJSON framing of every frame type
 *   - Server timing stamps (always-on)
 *   - Final `llm_done` after aggregation, `done` after all TTS settles
 *
 * The caller owns:
 *   - Auth / billing gate (cloud only)
 *   - Provider routing (which apiKey, which LLMProvider)
 *   - Resolving the right TTS adapter (which voice, which provider)
 *   - Usage write on completion (writeUsageRecord)
 *   - Constructing the `tts` callable (closing over model/speed/instructions/
 *     target_bytes/first_batch_bytes — orchestrator never sees those)
 *
 * Wire-format invariant: the order of frame types is:
 *   1. server_timing(llm_function_received)
 *   2. server_timing(llm_request_start)
 *   3. text(*), interleaved with audio_start / audio(*) / audio_end per chunk
 *   4. server_timing(llm_first_byte) — between first text and any audio
 *   5. server_timing(tts_*) interleaved with audio_*
 *   6. llm_done (single, after aggregated resolves)
 *   7. audio_end / audio_error tails for any still-streaming chunks
 *   8. done (terminal — exactly once)
 *
 * NB: This is the SIGNATURE STUB. Implementation lives in a follow-up
 * commit. The function throws so the tests that lock in the contract
 * fail loudly until the implementation lands.
 */

import type { LLMStreamResponse, LLMResponse } from '../types.js'
import type { NdjsonStreamResponse } from './ndjson_writer.js'
import type { TtsStreamFn } from './types.js'

export interface StreamLlmTtsToNdjsonOptions {
    /** HTTP response stream. Framework-agnostic — Express and Firebase
     *  onRequest Response objects both satisfy this shape. The orchestrator
     *  calls beginNdjsonStream() on it before writing any frame. */
    res: NdjsonStreamResponse & { end?: () => void }

    /** Already-resolved LLM stream. Caller picks provider, apiKey, params. */
    llmStream: LLMStreamResponse

    /** TTS callable. When omitted, no audio frames are emitted (text-only mode). */
    tts?: TtsStreamFn

    /** Voice to pass to `tts`. Required when `tts` is provided; ignored otherwise. */
    voice?: string

    /** First TTS chunk fires once accumulated response text crosses this many
     *  words AND lands at a sentence boundary. Production default 8. */
    firstChunkWordThreshold: number

    /** Alternate trigger: elapsed wall-clock ms since `llmRequestStartMs`. `0` disables. */
    firstChunkTimeThresholdMs: number

    /** Wall-clock ms when the handler was entered (for the
     *  `llm_function_received` server_timing frame). Defaults to Date.now()
     *  at orchestrator entry, which is a slight under-count by the handler's
     *  own preamble cost — supplying it explicitly is preferred. */
    funcReceivedMs?: number

    /** Emit server_timing frames? Default true. Disable only if you've
     *  measured the wire-overhead cost matters in your context. */
    emitServerTiming?: boolean
}

export interface StreamLlmTtsToNdjsonResult {
    /** Resolved LLM aggregation (output_text, usage, finish_reason, etc.). */
    aggregated: LLMResponse

    /** Total text chars fed to TTS across all chunks. Used by callers for
     *  per-call TTS billing (e.g. cloud's TTS-cost envelope). */
    totalTtsChars: number

    /** Number of TTS chunks fired. Lower bound is 0 (text-only mode or
     *  empty response); upper bound is unbounded by current splitter but
     *  in practice ≤ 2 (early split + remainder). */
    ttsChunkCount: number

    /** Total ms from orchestrator entry to `done` frame written. */
    msTotal: number
}

/**
 * Run the combined LLM + TTS NDJSON orchestration end-to-end. See module
 * doc-comment for the contract; see ./CLAUDE.md for the wire-format and
 * server_timing schema; see ./stream_llm_tts_to_ndjson.test.ts for the
 * behavioral spec the test suite locks in.
 */
export async function streamLlmTtsToNdjson(
    _opts: StreamLlmTtsToNdjsonOptions,
): Promise<StreamLlmTtsToNdjsonResult> {
    throw new Error(
        'streamLlmTtsToNdjson: not implemented yet — signature is fixed; ' +
        'implementation lands in a follow-up commit. See ' +
        'packages/llm-service/src/streaming/CLAUDE.md.',
    )
}
