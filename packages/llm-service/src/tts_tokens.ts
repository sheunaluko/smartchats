/**
 * Tokenizer helper for gpt-4o-mini-tts input-token counting.
 *
 * Counts tokens with the encoding named in `GPT4O_MINI_TTS_PRICING.tiktokenEncoding`
 * (currently `o200k_base`). The returned count feeds directly into
 * `estimateGpt4oMiniTtsCost({ inputTokens, outputPcmBytes })` from cortex.
 *
 * Uses js-tiktoken (pure JS port of OpenAI's tiktoken) instead of the WASM
 * variant. The WASM build embeds tiktoken_bg.wasm via fs.readFileSync at
 * candidate paths baked at build time — bun --compile can't find those paths
 * at runtime, so the server crashes at first encoding load. js-tiktoken
 * has the BPE table inline and works everywhere, including in bun-compiled
 * binaries. Pay ~3x token-encoding throughput for portability.
 *
 * Encoding is lazy-loaded once per process and reused across calls.
 */

import { getEncoding, type TiktokenEncoding } from 'js-tiktoken'
import { GPT4O_MINI_TTS_PRICING } from 'cortex'

let _encoding: ReturnType<typeof getEncoding> | null = null

export function countGpt4oMiniTtsInputTokens(text: string): number {
    if (!_encoding) {
        _encoding = getEncoding(GPT4O_MINI_TTS_PRICING.tiktokenEncoding as TiktokenEncoding)
    }
    return _encoding.encode(text).length
}
