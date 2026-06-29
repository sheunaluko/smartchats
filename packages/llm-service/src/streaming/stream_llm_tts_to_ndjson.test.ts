/**
 * Behavioral spec for streamLlmTtsToNdjson — the shared module that both
 * the cloud `/llm_tts_stream_http` Firebase Function and the local
 * `/llm/streamWithTTS` Express route will share.
 *
 * These tests are intentionally written *before* the implementation. They
 * will all fail until streamLlmTtsToNdjson is implemented. Each `it()`
 * locks in one behavioral claim from the contract documented in
 * ./CLAUDE.md and ./stream_llm_tts_to_ndjson.ts.
 *
 * What makes this test file possible without a real LLM / OpenAI client:
 *   - The orchestrator takes a `llmStream: LLMStreamResponse` (already
 *     resolved). We hand it a fake async iterable backed by a controlled
 *     queue, so we drive token-by-token timing from the test.
 *   - The orchestrator takes a `tts: TtsStreamFn` (provider-agnostic
 *     callable). We hand it a stub that yields pre-canned PCM buffers on
 *     a controlled timeline + fires synthetic `onTiming` events.
 *   - The orchestrator takes a `res: NdjsonStreamResponse` — we hand it a
 *     buffer-backed fake that records every `write()` call so we can
 *     parse the NDJSON output line-by-line.
 *
 * No network, no real LLM, no real TTS. Pure orchestration testing.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { streamLlmTtsToNdjson } from './stream_llm_tts_to_ndjson.js'
import type { TtsStreamFn, TtsTimingEvent, NdjsonFrame, ServerTimingEvent } from './types.js'
import type { LLMStreamResponse, LLMResponse } from '../types.js'

// ────────────────────────────────────────────────────────────────────────────
// Test doubles — fake res, fake llmStream, fake tts
// ────────────────────────────────────────────────────────────────────────────

interface FakeResponse {
    headers: Record<string, string>
    chunks: string[]
    ended: boolean
    setHeader: (name: string, value: string) => void
    write: (chunk: string | Buffer) => void
    end: () => void
}

function createFakeResponse(): FakeResponse {
    const r: FakeResponse = {
        headers: {},
        chunks: [],
        ended: false,
        setHeader(name, value) { this.headers[name] = value },
        write(chunk) { this.chunks.push(typeof chunk === 'string' ? chunk : chunk.toString()) },
        end() { this.ended = true },
    }
    return r
}

/** Parse the recorded `res.write` chunks back into a stream of NdjsonFrames. */
function parseFrames(res: FakeResponse): NdjsonFrame[] {
    const joined = res.chunks.join('')
    return joined
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as NdjsonFrame)
}

/**
 * Build a fake LLMStreamResponse. Tokens stream from `tokens` on the
 * order/timeline the caller pushes them; `aggregated` resolves to a
 * deterministic LLMResponse derived from the full text.
 */
function createFakeLlmStream(opts: {
    tokens: string[]
    /** Inter-token delay in ms; constant across tokens. Default 0. */
    interTokenMs?: number
    /** Force the aggregated promise to reject (e.g. provider error) instead of resolving. */
    aggregateError?: Error
}): LLMStreamResponse {
    const interTokenMs = opts.interTokenMs ?? 0
    const fullText = opts.tokens.join('')

    async function* gen(): AsyncIterable<string> {
        for (const t of opts.tokens) {
            if (interTokenMs > 0) await new Promise((r) => setTimeout(r, interTokenMs))
            yield t
        }
    }

    const aggregated: Promise<LLMResponse> = opts.aggregateError
        ? Promise.reject(opts.aggregateError)
        : Promise.resolve({
            output_text: fullText,
            usage: { input_tokens: 10, output_tokens: opts.tokens.length, cached_input_tokens: 0 },
            model: 'fake-model',
            provider: 'openai',
            finish_reason: 'stop',
            latency_ms: opts.tokens.length * interTokenMs,
            raw: {},
        })

    return { stream: gen(), aggregated }
}

/**
 * Build a fake TtsStreamFn. Each call yields `batchCount` 32-byte PCM
 * buffers (aligned to 2-byte sample boundaries). Optionally fires
 * `onTiming` events on a controlled schedule.
 *
 * `behavior` lets a test inject failure (throws), latency, or arbitrary
 * batch counts on a per-call basis.
 */
function createFakeTts(behavior?: {
    perCall?: Array<{ batchCount?: number; throws?: Error; firstByteMs?: number; batchYieldMs?: number[] }>
    defaultBatchCount?: number
}): TtsStreamFn & { calls: Array<{ text: string; voice: string }> } {
    const calls: Array<{ text: string; voice: string }> = []
    let callIdx = -1

    const inner: TtsStreamFn = async function* (opts) {
        callIdx++
        calls.push({ text: opts.text, voice: opts.voice })
        const spec = behavior?.perCall?.[callIdx]
        if (spec?.throws) throw spec.throws

        const batchCount = spec?.batchCount ?? behavior?.defaultBatchCount ?? 2
        let cumulative = 0

        if (opts.onTiming && spec?.firstByteMs !== undefined) {
            opts.onTiming({ phase: 'first_byte', ms_since_request: spec.firstByteMs })
        }

        for (let i = 0; i < batchCount; i++) {
            const batch = Buffer.alloc(32, i + 1)  // distinct per-batch byte pattern
            cumulative += batch.length
            if (opts.onTiming && spec?.batchYieldMs?.[i] !== undefined) {
                opts.onTiming({
                    phase: 'batch_yield',
                    batch_index: i,
                    ms_since_request: spec.batchYieldMs[i]!,
                    bytes: batch.length,
                    provider_bytes_cumulative: cumulative,
                })
            }
            yield batch
        }
    }

    const fn = inner as TtsStreamFn & { calls: typeof calls }
    fn.calls = calls
    return fn
}

// ────────────────────────────────────────────────────────────────────────────
// Conventions used across tests
// ────────────────────────────────────────────────────────────────────────────

/**
 * Standard LLM token stream — produces a JsonStreamParser-parseable response
 * shape because the local + cloud handlers wrap the LLM in a `{"response":
 * "..."}` JSON envelope.
 *
 * Two sentence boundaries inside the response so the 5-word threshold has a
 * subsequent `. ` to split on. The ResponseSplitter's threshold-position
 * lookup lands past the 5th word; if there's no sentence boundary after
 * that position, it can't fire — which means the data needs at least one
 * sentence break *after* the 5th word.
 */
const STANDARD_TOKENS = [
    '{"response":"',
    'The ', 'quick ', 'brown ', 'fox ',
    'jumps ', 'over ', 'the ', 'lazy ', 'dog. ',
    'Then ', 'it ', 'sleeps. ',
    'And ', 'dreams.',
    '"}',
]

// ────────────────────────────────────────────────────────────────────────────
// 1. Wire shape — frame discriminators + ordering
// ────────────────────────────────────────────────────────────────────────────

describe('streamLlmTtsToNdjson — wire shape', () => {
    let res: FakeResponse
    beforeEach(() => { res = createFakeResponse() })

    it('sets NDJSON headers before writing any frame', async () => {
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8')
        expect(res.headers['Transfer-Encoding']).toBe('chunked')
        expect(res.headers['Cache-Control']).toBe('no-cache')
        expect(res.headers['X-Content-Type-Options']).toBe('nosniff')
    })

    it('every line parses as JSON with a known `t` discriminator', async () => {
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const frames = parseFrames(res)
        const known: NdjsonFrame['t'][] = [
            'text', 'audio_start', 'audio', 'audio_end', 'audio_error',
            'error', 'llm_done', 'done', 'server_timing',
        ]
        for (const f of frames) {
            expect(known).toContain(f.t)
        }
    })

    it('terminates with exactly one `done` frame as the last line', async () => {
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const frames = parseFrames(res)
        const doneIdx = frames.findIndex((f) => f.t === 'done')
        expect(doneIdx).toBeGreaterThanOrEqual(0)
        expect(doneIdx).toBe(frames.length - 1)
        const onlyOne = frames.filter((f) => f.t === 'done')
        expect(onlyOne.length).toBe(1)
    })

    it('emits text frames in order before the corresponding llm_done', async () => {
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const frames = parseFrames(res)
        const llmDoneIdx = frames.findIndex((f) => f.t === 'llm_done')
        const lastTextIdx = frames.map((f) => f.t).lastIndexOf('text')
        expect(lastTextIdx).toBeGreaterThanOrEqual(0)
        expect(lastTextIdx).toBeLessThan(llmDoneIdx)
    })

    it('each audio_start has a matching audio_end with the same `s`', async () => {
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts({ defaultBatchCount: 3 }),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const frames = parseFrames(res)
        const starts = frames.filter((f): f is Extract<NdjsonFrame, { t: 'audio_start' }> => f.t === 'audio_start').map((f) => f.s)
        const ends = frames.filter((f): f is Extract<NdjsonFrame, { t: 'audio_end' }> => f.t === 'audio_end').map((f) => f.s)
        expect(ends.sort()).toEqual(starts.sort())
    })

    it('audio `c` sequence within a chunk is monotonic from 0', async () => {
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts({ defaultBatchCount: 4 }),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const frames = parseFrames(res)
        const audio = frames.filter((f): f is Extract<NdjsonFrame, { t: 'audio' }> => f.t === 'audio')
        const byChunk = new Map<number, number[]>()
        for (const a of audio) {
            const arr = byChunk.get(a.s) ?? []
            arr.push(a.c)
            byChunk.set(a.s, arr)
        }
        for (const seq of byChunk.values()) {
            expect(seq).toEqual([...seq].sort((a, b) => a - b))
            expect(seq[0]).toBe(0)
            for (let i = 1; i < seq.length; i++) expect(seq[i]).toBe(seq[i - 1]! + 1)
        }
    })
})

// ────────────────────────────────────────────────────────────────────────────
// 2. Early-split behavior — first TTS fires before LLM finishes
// ────────────────────────────────────────────────────────────────────────────

describe('streamLlmTtsToNdjson — early split', () => {
    it('fires the first audio_start before the last text frame', async () => {
        const res = createFakeResponse()
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const frames = parseFrames(res)
        const firstAudioStart = frames.findIndex((f) => f.t === 'audio_start')
        const lastText = frames.map((f) => f.t).lastIndexOf('text')
        expect(firstAudioStart).toBeLessThan(lastText)
    })

    it('passes the first chunk text (up to ~80 chars) to audio_start', async () => {
        const res = createFakeResponse()
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const frames = parseFrames(res)
        const firstStart = frames.find((f): f is Extract<NdjsonFrame, { t: 'audio_start' }> => f.t === 'audio_start')
        expect(firstStart).toBeDefined()
        expect(firstStart!.text.length).toBeGreaterThan(0)
        expect(firstStart!.text.length).toBeLessThanOrEqual(80)
    })

    it('passes splitter knobs through (changes observable behavior)', async () => {
        const resHigh = createFakeResponse()
        const resLow = createFakeResponse()
        await streamLlmTtsToNdjson({
            res: resHigh,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 100,  // never fires before end
            firstChunkTimeThresholdMs: 0,
        })
        await streamLlmTtsToNdjson({
            res: resLow,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 2,
            firstChunkTimeThresholdMs: 0,
        })
        const highFrames = parseFrames(resHigh)
        const lowFrames = parseFrames(resLow)
        const highStartCount = highFrames.filter((f) => f.t === 'audio_start').length
        const lowStartCount = lowFrames.filter((f) => f.t === 'audio_start').length
        // High threshold: only the flushRemainder chunk fires (1 audio_start).
        // Low threshold: early-split fires + remainder fires (2 audio_start).
        expect(highStartCount).toBe(1)
        expect(lowStartCount).toBe(2)
    })

    it('flushes the remainder as a final chunk after LLM stream ends', async () => {
        const tts = createFakeTts()
        const res = createFakeResponse()
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts,
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        // The second TTS call carries the post-split remainder.
        expect(tts.calls.length).toBe(2)
        expect(tts.calls[1]!.text.length).toBeGreaterThan(0)
        // First chunk + second chunk concat covers the full response (modulo
        // whitespace at the join — splitter trims).
        const combined = (tts.calls[0]!.text + ' ' + tts.calls[1]!.text).replace(/\s+/g, ' ').trim()
        expect(combined).toContain('quick brown fox')
        expect(combined).toContain('lazy dog')
    })
})

// ────────────────────────────────────────────────────────────────────────────
// 3. Parallel TTS — chunk 1's audio frames may interleave with chunk 0's
// ────────────────────────────────────────────────────────────────────────────

describe('streamLlmTtsToNdjson — parallel TTS dispatch', () => {
    it('does not serialize chunks: chunk 1 may start before chunk 0 ends', async () => {
        // Make chunk 0 slow + chunk 1 fast. If serialized, chunk 0's audio_end
        // would precede chunk 1's audio_start. If parallel, chunk 1's
        // audio_start lands while chunk 0 is still streaming.
        const res = createFakeResponse()
        const tts: TtsStreamFn = async function* (opts) {
            const slow = opts.text.includes('quick')  // first chunk
            for (let i = 0; i < 4; i++) {
                if (slow) await new Promise((r) => setTimeout(r, 10))
                yield Buffer.alloc(32, i)
            }
        }
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts,
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const frames = parseFrames(res)
        const audioStarts = frames
            .map((f, i) => ({ f, i }))
            .filter((x) => x.f.t === 'audio_start')
        const firstChunkEndIdx = frames.findIndex((f) => f.t === 'audio_end' && f.s === 0)
        const secondChunkStartIdx = audioStarts.find((x) => (x.f as any).s === 1)?.i ?? -1
        expect(secondChunkStartIdx).toBeGreaterThanOrEqual(0)
        expect(secondChunkStartIdx).toBeLessThan(firstChunkEndIdx)
    })

    it('done waits for every TTS chunk to settle, even slow ones', async () => {
        const res = createFakeResponse()
        const tts: TtsStreamFn = async function* (_opts) {
            await new Promise((r) => setTimeout(r, 30))
            for (let i = 0; i < 2; i++) yield Buffer.alloc(32, i)
        }
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts,
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const frames = parseFrames(res)
        const lastAudioEndIdx = frames.map((f) => f.t).lastIndexOf('audio_end')
        const doneIdx = frames.findIndex((f) => f.t === 'done')
        expect(lastAudioEndIdx).toBeGreaterThanOrEqual(0)
        expect(doneIdx).toBeGreaterThan(lastAudioEndIdx)
    })
})

// ────────────────────────────────────────────────────────────────────────────
// 4. TTS failure isolation — audio_error doesn't break LLM stream
// ────────────────────────────────────────────────────────────────────────────

describe('streamLlmTtsToNdjson — TTS failure isolation', () => {
    it('emits audio_error and keeps streaming when a TTS call throws', async () => {
        const res = createFakeResponse()
        const tts = createFakeTts({
            perCall: [{ throws: new Error('TTS provider unavailable') }, { batchCount: 2 }],
        })
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts,
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const frames = parseFrames(res)
        const errs = frames.filter((f): f is Extract<NdjsonFrame, { t: 'audio_error' }> => f.t === 'audio_error')
        expect(errs.length).toBe(1)
        expect(errs[0]!.s).toBe(0)
        expect(errs[0]!.error).toContain('TTS provider unavailable')
        // Text frames still flowed; done still emitted.
        expect(frames.some((f) => f.t === 'text')).toBe(true)
        expect(frames.some((f) => f.t === 'done')).toBe(true)
    })

    it('emits an `error` frame and aborts when LLM aggregation fails', async () => {
        const res = createFakeResponse()
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({
                tokens: STANDARD_TOKENS,
                aggregateError: new Error('upstream aggregation failed'),
            }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const frames = parseFrames(res)
        const errs = frames.filter((f): f is Extract<NdjsonFrame, { t: 'error' }> => f.t === 'error')
        expect(errs.length).toBe(1)
        expect(errs[0]!.error).toContain('aggregation')
    })
})

// ────────────────────────────────────────────────────────────────────────────
// 5. server_timing — always-on, schema matches ServerTimingEvent
// ────────────────────────────────────────────────────────────────────────────

describe('streamLlmTtsToNdjson — server_timing schema', () => {
    it('emits llm_function_received, llm_request_start, llm_first_byte once each (in order)', async () => {
        const res = createFakeResponse()
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const timings = parseFrames(res).filter((f): f is ServerTimingEvent => f.t === 'server_timing')
        const llmPhases = timings
            .filter((e) => e.phase.startsWith('llm_'))
            .map((e) => e.phase)
        expect(llmPhases).toEqual(['llm_function_received', 'llm_request_start', 'llm_first_byte'])
    })

    it('llm_request_start carries ms_since_function_received', async () => {
        const res = createFakeResponse()
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS, interTokenMs: 5 }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const timings = parseFrames(res).filter((f): f is ServerTimingEvent => f.t === 'server_timing')
        const rs = timings.find((e) => e.phase === 'llm_request_start')
        expect(rs).toBeDefined()
        expect((rs as any).ms_since_function_received).toBeGreaterThanOrEqual(0)
    })

    it('llm_first_byte carries both ms_since_request_start and ms_since_function_received', async () => {
        const res = createFakeResponse()
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS, interTokenMs: 3 }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const timings = parseFrames(res).filter((f): f is ServerTimingEvent => f.t === 'server_timing')
        const fb = timings.find((e) => e.phase === 'llm_first_byte') as any
        expect(fb).toBeDefined()
        expect(fb.ms_since_request_start).toBeGreaterThanOrEqual(0)
        expect(fb.ms_since_function_received).toBeGreaterThanOrEqual(0)
        expect(fb.ms_since_function_received).toBeGreaterThanOrEqual(fb.ms_since_request_start)
    })

    it('per-TTS-chunk timing phases follow tts_request_start → tts_first_byte → tts_batch_yield* → tts_request_complete', async () => {
        const res = createFakeResponse()
        const tts = createFakeTts({
            perCall: [
                { batchCount: 2, firstByteMs: 5, batchYieldMs: [10, 20] },
                { batchCount: 1, firstByteMs: 4, batchYieldMs: [8] },
            ],
        })
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts,
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const timings = parseFrames(res).filter((f): f is ServerTimingEvent => f.t === 'server_timing')
        for (const chunkIdx of [0, 1]) {
            const phases = timings
                .filter((e) => e.phase.startsWith('tts_') && (e as any).s === chunkIdx)
                .map((e) => e.phase)
            expect(phases[0]).toBe('tts_request_start')
            expect(phases[1]).toBe('tts_first_byte')
            expect(phases[phases.length - 1]).toBe('tts_request_complete')
            for (let i = 2; i < phases.length - 1; i++) {
                expect(phases[i]).toBe('tts_batch_yield')
            }
        }
    })

    it('tts_batch_yield carries bytes + provider_bytes_total + batch index', async () => {
        const res = createFakeResponse()
        const tts = createFakeTts({
            perCall: [
                { batchCount: 3, firstByteMs: 5, batchYieldMs: [10, 20, 30] },
                { batchCount: 1, firstByteMs: 4, batchYieldMs: [8] },
            ],
        })
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts,
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const timings = parseFrames(res).filter((f): f is ServerTimingEvent => f.t === 'server_timing')
        const yields = timings.filter((e) => e.phase === 'tts_batch_yield')
        for (const y of yields as any[]) {
            expect(typeof y.s).toBe('number')
            expect(typeof y.batch).toBe('number')
            expect(typeof y.bytes).toBe('number')
            expect(typeof y.provider_bytes_total).toBe('number')
            expect(y.bytes).toBeGreaterThan(0)
            expect(y.provider_bytes_total).toBeGreaterThanOrEqual(y.bytes)
        }
    })

    it('emitServerTiming=false suppresses all server_timing frames', async () => {
        const res = createFakeResponse()
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts({ perCall: [{ batchCount: 2, firstByteMs: 5, batchYieldMs: [10, 20] }] }),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
            emitServerTiming: false,
        })
        const timings = parseFrames(res).filter((f) => f.t === 'server_timing')
        expect(timings.length).toBe(0)
    })
})

// ────────────────────────────────────────────────────────────────────────────
// 6. Text-only mode — no tts/voice
// ────────────────────────────────────────────────────────────────────────────

describe('streamLlmTtsToNdjson — text-only mode (no tts)', () => {
    it('emits no audio_* frames when tts is omitted', async () => {
        const res = createFakeResponse()
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const frames = parseFrames(res)
        for (const f of frames) {
            expect(['audio_start', 'audio', 'audio_end', 'audio_error']).not.toContain(f.t)
        }
        expect(frames.some((f) => f.t === 'text')).toBe(true)
        expect(frames.some((f) => f.t === 'llm_done')).toBe(true)
        expect(frames.some((f) => f.t === 'done')).toBe(true)
    })

    it('emits no tts_* server_timing phases when tts is omitted', async () => {
        const res = createFakeResponse()
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const timings = parseFrames(res).filter((f): f is ServerTimingEvent => f.t === 'server_timing')
        for (const e of timings) {
            expect(e.phase.startsWith('tts_')).toBe(false)
        }
    })
})

// ────────────────────────────────────────────────────────────────────────────
// 7. Return value — aggregated + counters + timing
// ────────────────────────────────────────────────────────────────────────────

describe('streamLlmTtsToNdjson — return value', () => {
    it('returns the resolved aggregated LLM response', async () => {
        const res = createFakeResponse()
        const result = await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        expect(result.aggregated.output_text).toContain('quick brown fox')
        expect(result.aggregated.model).toBe('fake-model')
        expect(result.aggregated.finish_reason).toBe('stop')
    })

    it('returns totalTtsChars matching the sum of text passed to tts', async () => {
        const res = createFakeResponse()
        const tts = createFakeTts()
        const result = await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts,
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const expectedChars = tts.calls.reduce((sum, c) => sum + c.text.length, 0)
        expect(result.totalTtsChars).toBe(expectedChars)
        expect(result.ttsChunkCount).toBe(tts.calls.length)
    })

    it('returns msTotal ≥ the orchestrator real elapsed time', async () => {
        const res = createFakeResponse()
        const start = Date.now()
        const result = await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS, interTokenMs: 1 }),
            tts: createFakeTts(),
            voice: 'alloy',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        const realElapsed = Date.now() - start
        expect(result.msTotal).toBeGreaterThanOrEqual(0)
        // Allow some scheduler slop, but msTotal shouldn't exceed real elapsed.
        expect(result.msTotal).toBeLessThanOrEqual(realElapsed + 5)
    })
})

// ────────────────────────────────────────────────────────────────────────────
// 8. Adapter abstraction — TtsStreamFn is the only contract
// ────────────────────────────────────────────────────────────────────────────

describe('streamLlmTtsToNdjson — adapter abstraction', () => {
    it('accepts a TtsStreamFn that yields buffers and calls onTiming', async () => {
        const res = createFakeResponse()
        let sawFirstByte = false
        let yieldedBatches = 0
        const tts: TtsStreamFn = async function* (opts) {
            if (opts.onTiming) {
                opts.onTiming({ phase: 'first_byte', ms_since_request: 1 })
                sawFirstByte = true
            }
            for (let i = 0; i < 2; i++) {
                if (opts.onTiming) {
                    opts.onTiming({
                        phase: 'batch_yield',
                        batch_index: i,
                        ms_since_request: 2 + i,
                        bytes: 32,
                        provider_bytes_cumulative: 32 * (i + 1),
                    })
                }
                yieldedBatches++
                yield Buffer.alloc(32, i)
            }
        }
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts,
            voice: 'azure-voice',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        expect(sawFirstByte).toBe(true)
        expect(yieldedBatches).toBeGreaterThan(0)
    })

    it('passes the configured `voice` through unchanged to every tts call', async () => {
        const res = createFakeResponse()
        const tts = createFakeTts()
        await streamLlmTtsToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: STANDARD_TOKENS }),
            tts,
            voice: 'en-US-AvaMultilingualNeural',
            firstChunkWordThreshold: 5,
            firstChunkTimeThresholdMs: 0,
        })
        for (const c of tts.calls) {
            expect(c.voice).toBe('en-US-AvaMultilingualNeural')
        }
    })
})
