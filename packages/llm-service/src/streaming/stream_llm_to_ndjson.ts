/**
 * Text-only LLM streaming orchestrator.
 *
 * The smaller twin of streamLlmTtsToNdjson — no TTS, no JsonStreamParser,
 * no ResponseSplitter. Just pipe LLM token chunks as NDJSON `delta`
 * frames, await aggregation, write a single `done` (or `error`) frame.
 *
 * Both the open self-hosted /llm/stream Express route and the cloud
 * llmStreamHttp Firebase Function call this. Each wrapper supplies
 * its own auth + billing + usage-write concerns via the onBeforeDone
 * hook that enriches the terminal `done` frame.
 *
 * Wire-format note: emits `{ t: 'delta', d: chunk }` for each token,
 * NOT `{ t: 'text', d: chunk }` (the combined LLM+TTS handler's name).
 * Historical split — client adapters parse two different wire formats.
 * Don't unify the discriminator without updating every client.
 *
 * Frame order:
 *   1. delta(*) — one per non-empty LLM token chunk
 *   2. done    — terminal on happy path, after aggregation
 *      OR
 *      error  — terminal on stream / aggregation failure
 */

import type { LLMStreamResponse, LLMResponse } from '../types.js'
import { beginNdjsonStream, writeNdjsonLine } from './ndjson_writer.js'
import type { NdjsonStreamResponse } from './ndjson_writer.js'

export interface StreamLlmToNdjsonOptions {
    /** HTTP response stream. Framework-agnostic — Express + Firebase onRequest both satisfy. */
    res: NdjsonStreamResponse & { end?: () => void }

    /** Already-resolved LLM stream. Caller picks provider, apiKey, params. */
    llmStream: LLMStreamResponse

    /** Optional hook called after aggregation succeeds, before `done` is
     *  written. Returns extra fields to merge into done.data. Cloud uses
     *  this to append the billing envelope. Hook errors are swallowed
     *  (console.error only) so a flaky billing service never breaks the
     *  terminal frame. */
    onBeforeDone?: (info: {
        aggregated: LLMResponse
        msTotal: number
    }) => Record<string, unknown> | Promise<Record<string, unknown>>
}

export interface StreamLlmToNdjsonResult {
    /** Resolved LLM aggregation, or a zero-valued stub when aggregateOk is false. */
    aggregated: LLMResponse

    /** Total ms from orchestrator entry to terminal frame written. */
    msTotal: number

    /** True when the LLM aggregated promise resolved; false when it rejected
     *  (in which case the orchestrator wrote a terminal `error` frame and
     *  `aggregated` is a zero-valued stub). */
    aggregateOk: boolean
}

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

export async function streamLlmToNdjson(
    opts: StreamLlmToNdjsonOptions,
): Promise<StreamLlmToNdjsonResult> {
    const { res, llmStream } = opts
    const startMs = Date.now()

    beginNdjsonStream(res)

    // ── Stream LLM tokens as delta frames ─────────────────────────
    try {
        for await (const chunk of llmStream.stream) {
            if (!chunk) continue
            writeNdjsonLine(res, { t: 'delta', d: chunk })
        }
    } catch (err) {
        writeNdjsonLine(res, { t: 'error', error: (err as Error).message })
        return {
            aggregated: emptyAggregated(),
            msTotal: Date.now() - startMs,
            aggregateOk: false,
        }
    }

    // ── Await aggregation ──────────────────────────────────────────
    let aggregated: LLMResponse
    try {
        aggregated = await llmStream.aggregated
    } catch (err) {
        writeNdjsonLine(res, {
            t: 'error',
            error: `aggregation failed: ${(err as Error).message}`,
        })
        return {
            aggregated: emptyAggregated(),
            msTotal: Date.now() - startMs,
            aggregateOk: false,
        }
    }

    // ── onBeforeDone hook for wrapper-specific data merge ─────────
    let extra: Record<string, unknown> = {}
    if (opts.onBeforeDone) {
        try {
            extra = await opts.onBeforeDone({
                aggregated,
                msTotal: Date.now() - startMs,
            })
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('streamLlmToNdjson: onBeforeDone threw', err)
        }
    }

    const msTotal = Date.now() - startMs
    writeNdjsonLine(res, {
        t: 'done',
        data: {
            success: true,
            output_text: aggregated.output_text,
            usage: aggregated.usage,
            model: aggregated.model,
            provider: aggregated.provider,
            finish_reason: aggregated.finish_reason,
            latency_ms: aggregated.latency_ms,
            ...extra,
        },
    })

    return { aggregated, msTotal, aggregateOk: true }
}
