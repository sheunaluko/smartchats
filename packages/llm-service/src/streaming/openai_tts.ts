/**
 * OpenAI TTS streaming generator.
 *
 * Wraps `openai.audio.speech.create` with two concerns that every caller
 * ends up re-implementing otherwise:
 *
 *  1. **PCM batching.** Raw TCP fragments arrive tiny and inconsistent.
 *     We accumulate until ~6400 bytes (≈133ms of audio at 24kHz mono PCM16)
 *     before yielding — this dramatically reduces NDJSON + scheduler overhead
 *     downstream without hurting perceived latency.
 *
 *  2. **Sample alignment.** PCM16 is 2 bytes per sample, so any batch handed
 *     to base64-encode must have an even byte count. An odd trailing byte is
 *     carried into the next batch.
 *
 * Usage:
 *   const openai = new OpenAI({ apiKey })
 *   for await (const pcm of openaiTtsStream(openai, text, 'alloy', 'gpt-4o-mini-tts', 1)) {
 *     // pcm is a Node Buffer of PCM16 samples, already aligned + batched.
 *   }
 */

import type OpenAI from 'openai'

/** Target batch size for PCM chunks — ≈133ms at 24kHz mono PCM16. */
export const TTS_TARGET_BYTES = 6400

export interface OpenAITtsStreamOptions {
    text: string
    voice: string
    model: string
    speed: number
    /** Voice-style directive; only sent when model === 'gpt-4o-mini-tts'. */
    instructions?: string
}

export async function* openaiTtsStream(
    client: OpenAI,
    opts: OpenAITtsStreamOptions,
): AsyncGenerator<Buffer> {
    const { text, voice, model, speed, instructions } = opts

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

    const response = await client.audio.speech.create(createParams as any)
    const body = response.body as unknown as NodeJS.ReadableStream

    const parts: Buffer[] = []
    let accumulated = 0

    for await (const rawChunk of body) {
        const buf = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk as any)
        parts.push(buf)
        accumulated += buf.length

        if (accumulated >= TTS_TARGET_BYTES) {
            let batch = Buffer.concat(parts)
            parts.length = 0
            accumulated = 0

            // PCM16 sample alignment: defer any trailing odd byte to the next batch.
            if (batch.length % 2 !== 0) {
                parts.push(batch.subarray(batch.length - 1))
                accumulated = 1
                batch = batch.subarray(0, batch.length - 1)
            }
            yield batch
        }
    }

    // Flush remainder (if any), also aligned.
    if (parts.length > 0) {
        let batch = Buffer.concat(parts)
        if (batch.length % 2 !== 0) batch = batch.subarray(0, batch.length - 1)
        if (batch.length > 0) yield batch
    }
}
