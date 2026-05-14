/**
 * Tiktoken helper for gpt-4o-mini-tts input-token counting.
 *
 * Counts tokens with the encoding named in `GPT4O_MINI_TTS_PRICING.tiktokenEncoding`
 * (currently `o200k_base`). The returned count feeds directly into
 * `estimateGpt4oMiniTtsCost({ inputTokens, outputPcmBytes })` from cortex.
 *
 * The encoding is lazy-loaded once per process and reused across calls —
 * WASM init is non-trivial, so we pay it once at first call, not per request.
 */

import { get_encoding } from 'tiktoken'
import { GPT4O_MINI_TTS_PRICING } from 'cortex'

let _encoding: ReturnType<typeof get_encoding> | null = null

export function countGpt4oMiniTtsInputTokens(text: string): number {
    if (!_encoding) {
        _encoding = get_encoding(GPT4O_MINI_TTS_PRICING.tiktokenEncoding as any)
    }
    return _encoding.encode(text).length
}
