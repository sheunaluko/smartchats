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
 *   - Server timing stamps (always-on by default)
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
 *   8. done (terminal — exactly once on the happy path; replaced by a
 *      terminal `error` frame on LLM aggregation failure)
 */

import { JsonStreamParser } from 'cortex'
import type { LLMStreamResponse, LLMResponse } from '../types.js'
import { beginNdjsonStream, writeNdjsonLine } from './ndjson_writer.js'
import type { NdjsonStreamResponse } from './ndjson_writer.js'
import { ResponseSplitter } from './response_splitter.js'
import type { ServerTimingEvent, TtsStreamFn } from './types.js'

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
    /** Resolved LLM aggregation (output_text, usage, finish_reason, etc.).
     *  When aggregation rejects, this carries a zero-valued stub and the
     *  wire ended with an `error` frame instead of `done`. */
    aggregated: LLMResponse

    /** Total text chars fed to TTS across all chunks. Used by callers for
     *  per-call TTS billing (e.g. cloud's TTS-cost envelope). */
    totalTtsChars: number

    /** Number of TTS chunks fired. Lower bound is 0 (text-only mode or
     *  empty response); upper bound is unbounded by current splitter but
     *  in practice ≤ 2 (early split + remainder). */
    ttsChunkCount: number

    /** Total ms from orchestrator entry to terminal frame written. */
    msTotal: number
}

/** Zero-valued LLMResponse returned to the caller when aggregation rejects. */
function emptyAggregated(): LLMResponse {
    return {
        output_text: '',
        usage: { input_tokens: 0, output_tokens: 0, cached_input_tokens: 0 },
        model: '',
        provider: 'openai',
        finish_reason: 'error',
        latency_ms: 0,
        raw: {},
    }
}

/**
 * Run the combined LLM + TTS NDJSON orchestration end-to-end. See module
 * doc-comment for the contract; see ./CLAUDE.md for the wire-format and
 * server_timing schema; see ./stream_llm_tts_to_ndjson.test.ts for the
 * behavioral spec the test suite locks in.
 */
export async function streamLlmTtsToNdjson(
    opts: StreamLlmTtsToNdjsonOptions,
): Promise<StreamLlmTtsToNdjsonResult> {
    const {
        res,
        llmStream,
        tts,
        voice,
        firstChunkWordThreshold,
        firstChunkTimeThresholdMs,
        emitServerTiming = true,
    } = opts

    const orchestratorStartMs = Date.now()
    const funcReceivedMs = opts.funcReceivedMs ?? orchestratorStartMs

    beginNdjsonStream(res)

    // ── timing emit helper ───────────────────────────────────────────────
    const emitTiming = (event: ServerTimingEvent): void => {
        if (!emitServerTiming) return
        writeNdjsonLine(res, event)
    }

    emitTiming({ t: 'server_timing', phase: 'llm_function_received', ts: funcReceivedMs })
    const llmRequestStartMs = Date.now()
    emitTiming({
        t: 'server_timing',
        phase: 'llm_request_start',
        ts: llmRequestStartMs,
        ms_since_function_received: llmRequestStartMs - funcReceivedMs,
    })

    // ── TTS dispatch ─────────────────────────────────────────────────────
    let totalTtsChars = 0
    let ttsChunkCount = 0
    const ttsPromises: Promise<void>[] = []

    // Returns true if a fire was actually scheduled (tts + voice present).
    function fireTts(text: string): boolean {
        if (!tts || !voice) return false
        const chunkIdx = ttsChunkCount++
        totalTtsChars += text.length
        const promise = (async () => {
            const ttsReqStartMs = Date.now()
            try {
                emitTiming({
                    t: 'server_timing',
                    phase: 'tts_request_start',
                    s: chunkIdx,
                    ts: ttsReqStartMs - llmRequestStartMs,
                })
                writeNdjsonLine(res, {
                    t: 'audio_start',
                    s: chunkIdx,
                    text: text.slice(0, 80),
                    ms: ttsReqStartMs - llmRequestStartMs,
                })

                let c = 0
                let firstByteSeen = false
                let lastBatchYieldMs = ttsReqStartMs

                for await (const pcm of tts({
                    text,
                    voice,
                    onTiming: (event) => {
                        try {
                            if (event.phase === 'first_byte') {
                                if (!firstByteSeen) {
                                    firstByteSeen = true
                                    emitTiming({
                                        t: 'server_timing',
                                        phase: 'tts_first_byte',
                                        s: chunkIdx,
                                        ts: event.ms_since_request,
                                    })
                                }
                            } else if (event.phase === 'batch_yield') {
                                emitTiming({
                                    t: 'server_timing',
                                    phase: 'tts_batch_yield',
                                    s: chunkIdx,
                                    batch: event.batch_index,
                                    ts: event.ms_since_request,
                                    bytes: event.bytes,
                                    provider_bytes_total: event.provider_bytes_cumulative,
                                })
                                lastBatchYieldMs = ttsReqStartMs + event.ms_since_request
                            }
                        } catch { /* swallow telemetry errors */ }
                    },
                })) {
                    writeNdjsonLine(res, { t: 'audio', s: chunkIdx, c: c++, b64: pcm.toString('base64') })
                }

                writeNdjsonLine(res, {
                    t: 'audio_end',
                    s: chunkIdx,
                    ms: Date.now() - llmRequestStartMs,
                })
                emitTiming({
                    t: 'server_timing',
                    phase: 'tts_request_complete',
                    s: chunkIdx,
                    ts: Date.now() - ttsReqStartMs,
                    total_batches: c,
                    ms_since_first_byte: Date.now() - lastBatchYieldMs,
                })
            } catch (err) {
                writeNdjsonLine(res, {
                    t: 'audio_error',
                    s: chunkIdx,
                    error: (err as Error).message,
                })
            }
        })()
        ttsPromises.push(promise)
        return true
    }

    // ── Parser + splitter wiring ────────────────────────────────────────
    const splitter = new ResponseSplitter({
        wordThreshold: firstChunkWordThreshold,
        timeThresholdMs: firstChunkTimeThresholdMs,
        startTime: llmRequestStartMs,
        onFirstChunk: (text) => { fireTts(text) },
    })

    const parser = new JsonStreamParser({
        onResponseChunk: (text) => splitter.feed(text),
        onTextStreamDone: () => {
            // Closing quote of the response field arrived mid-stream. Flush
            // whatever the splitter has buffered as the remainder chunk.
            const remainder = splitter.flushRemainder()
            if (remainder) fireTts(remainder)
        },
    })

    // ── Stream LLM tokens ────────────────────────────────────────────────
    let llmFirstByteStamped = false
    try {
        for await (const chunk of llmStream.stream) {
            if (!chunk) continue
            if (!llmFirstByteStamped) {
                llmFirstByteStamped = true
                const llmFirstByteMs = Date.now()
                emitTiming({
                    t: 'server_timing',
                    phase: 'llm_first_byte',
                    ts: llmFirstByteMs,
                    ms_since_request_start: llmFirstByteMs - llmRequestStartMs,
                    ms_since_function_received: llmFirstByteMs - funcReceivedMs,
                })
            }
            writeNdjsonLine(res, { t: 'text', d: chunk })
            parser.feed(chunk)
        }
    } catch (err) {
        writeNdjsonLine(res, { t: 'error', error: (err as Error).message })
    }

    parser.finalize()

    // If the splitter never fired (short response below threshold, no
    // onTextStreamDone), flush whatever is buffered as one final chunk.
    // After onTextStreamDone has run, the buffer is empty and this is a
    // no-op.
    if (!splitter.hasFiredFirst) {
        const remainder = splitter.flushRemainder()
        if (remainder) fireTts(remainder)
    }

    // ── Await aggregation ────────────────────────────────────────────────
    let aggregated: LLMResponse
    try {
        aggregated = await llmStream.aggregated
    } catch (err) {
        writeNdjsonLine(res, {
            t: 'error',
            error: `aggregation failed: ${(err as Error).message}`,
        })
        // Drain still-running TTS before returning so the response isn't
        // truncated mid-stream.
        await Promise.allSettled(ttsPromises)
        return {
            aggregated: emptyAggregated(),
            totalTtsChars,
            ttsChunkCount,
            msTotal: Date.now() - orchestratorStartMs,
        }
    }

    writeNdjsonLine(res, {
        t: 'llm_done',
        data: {
            success: true,
            output_text: aggregated.output_text,
            usage: aggregated.usage,
            model: aggregated.model,
            provider: aggregated.provider,
            finish_reason: aggregated.finish_reason,
            latency_ms: Date.now() - llmRequestStartMs,
        },
    })

    // ── Wait for every TTS chunk to finish before terminal frame ────────
    await Promise.allSettled(ttsPromises)

    const msTotal = Date.now() - orchestratorStartMs
    writeNdjsonLine(res, {
        t: 'done',
        data: {
            success: true,
            ms_total: msTotal,
            total_tts_chars: totalTtsChars,
            tts_chunk_count: ttsChunkCount,
        },
    })

    return { aggregated, totalTtsChars, ttsChunkCount, msTotal }
}
