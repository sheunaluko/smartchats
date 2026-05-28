/**
 * OpenAI TTS streaming generator.
 *
 * Wraps `openai.audio.speech.create` with three concerns that every caller
 * ends up re-implementing otherwise:
 *
 *  1. **PCM batching.** Raw TCP fragments arrive tiny and inconsistent.
 *     We accumulate until ~6400 bytes (≈133ms of audio at 24kHz mono PCM16)
 *     before yielding — this dramatically reduces NDJSON + scheduler overhead
 *     downstream without hurting perceived latency. Optionally a smaller
 *     `firstBatchBytes` can be set to yield chunk 0 faster (~33ms) while
 *     keeping the steady-state target larger.
 *
 *  2. **Sample alignment.** PCM16 is 2 bytes per sample, so any batch handed
 *     to base64-encode must have an even byte count. An odd trailing byte is
 *     carried into the next batch.
 *
 *  3. **Optional timing callback** — fires for `first_byte` (OpenAI's first
 *     raw HTTP chunk arrives) and `batch_yield` (each batch we yield). Lets
 *     the caller correlate server-side encoder behavior with client-side
 *     scheduling — essential for diagnosing first-chunk audio glitches.
 *
 * Usage:
 *   for await (const pcm of openaiTtsStream(openai, { text, voice, model, speed })) {
 *     // pcm is a Node Buffer of PCM16 samples, already aligned + batched.
 *   }
 */

import type OpenAI from 'openai'

/** Default batch size — ≈133ms at 24kHz mono PCM16. */
export const TTS_TARGET_BYTES = 6400

export type OpenAITtsTimingEvent =
    | { phase: 'first_byte'; ms_since_request: number }
    | { phase: 'batch_yield'; batch_index: number; ms_since_request: number; bytes: number; openai_bytes_cumulative: number }

export interface OpenAITtsStreamOptions {
    text: string
    voice: string
    model: string
    speed: number
    /** Voice-style directive; only sent when model === 'gpt-4o-mini-tts'. */
    instructions?: string
    /** Steady-state batch size in bytes. Default TTS_TARGET_BYTES (6400). */
    targetBytes?: number
    /** Optional smaller first-batch size — gets chunk 0 to the wire faster.
     *  Defaults to `targetBytes` (same size for first + subsequent). */
    firstBatchBytes?: number
    /** Optional timing-event callback. Fires for `first_byte` (OpenAI's first
     *  raw HTTP chunk arrives) and once per yielded batch (`batch_yield`).
     *  Synchronous + best-effort; callback errors are swallowed. */
    onTiming?: (event: OpenAITtsTimingEvent) => void
}

export async function* openaiTtsStream(
    client: OpenAI,
    opts: OpenAITtsStreamOptions,
): AsyncGenerator<Buffer> {
    const { text, voice, model, speed, instructions, onTiming } = opts
    const targetBytes = opts.targetBytes ?? TTS_TARGET_BYTES
    const firstBatchBytes = opts.firstBatchBytes ?? targetBytes

    const fireTiming = (event: OpenAITtsTimingEvent) => {
        if (!onTiming) return
        try { onTiming(event) } catch { /* swallow telemetry errors */ }
    }

    const createParams: Record<string, unknown> = {
        model,
        voice,
        input: text,
        response_format: 'pcm',
        speed,
    }
    if (instructions && model === 'gpt-4o-mini-tts') {
        createParams.instructions = instructions
    }

    const requestStartMs = Date.now()
    const response = await client.audio.speech.create(createParams as any)
    const body = response.body as unknown as NodeJS.ReadableStream

    const parts: Buffer[] = []
    let accumulated = 0
    let batchIndex = 0
    let openaiBytesCumulative = 0
    let sawFirstByte = false

    for await (const rawChunk of body) {
        const buf = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as any)
        if (!sawFirstByte) {
            sawFirstByte = true
            fireTiming({ phase: 'first_byte', ms_since_request: Date.now() - requestStartMs })
        }
        parts.push(buf)
        accumulated += buf.length
        openaiBytesCumulative += buf.length

        const currentTarget = batchIndex === 0 ? firstBatchBytes : targetBytes
        if (accumulated >= currentTarget) {
            let batch = Buffer.concat(parts)
            parts.length = 0
            accumulated = 0

            // PCM16 sample alignment: defer any trailing odd byte to the next batch.
            if (batch.length % 2 !== 0) {
                parts.push(batch.subarray(batch.length - 1))
                accumulated = 1
                batch = batch.subarray(0, batch.length - 1)
            }
            fireTiming({
                phase: 'batch_yield',
                batch_index: batchIndex,
                ms_since_request: Date.now() - requestStartMs,
                bytes: batch.length,
                openai_bytes_cumulative: openaiBytesCumulative,
            })
            yield batch
            batchIndex++
        }
    }

    // Flush remainder (if any), also aligned.
    if (parts.length > 0) {
        let batch = Buffer.concat(parts)
        if (batch.length % 2 !== 0) batch = batch.subarray(0, batch.length - 1)
        if (batch.length > 0) {
            fireTiming({
                phase: 'batch_yield',
                batch_index: batchIndex,
                ms_since_request: Date.now() - requestStartMs,
                bytes: batch.length,
                openai_bytes_cumulative: openaiBytesCumulative,
            })
            yield batch
        }
    }
}
