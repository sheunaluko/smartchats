/**
 * Behavioral spec for streamLlmToNdjson — the text-only twin of
 * streamLlmTtsToNdjson. Shorter contract: deltas, done, error,
 * onBeforeDone hook, aggregateOk.
 */

import { describe, it, expect } from 'vitest'
import { streamLlmToNdjson } from './stream_llm_to_ndjson.js'
import type { LLMStreamResponse, LLMResponse } from '../types.js'

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

interface Frame { t: string; [key: string]: unknown }

function parseFrames(res: FakeResponse): Frame[] {
    return res.chunks
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Frame)
}

function createFakeLlmStream(opts: {
    tokens: string[]
    streamError?: Error
    aggregateError?: Error
}): LLMStreamResponse {
    const fullText = opts.tokens.join('')

    async function* gen(): AsyncIterable<string> {
        for (const t of opts.tokens) {
            yield t
        }
        if (opts.streamError) throw opts.streamError
    }

    const aggregated: Promise<LLMResponse> = opts.aggregateError
        ? Promise.reject(opts.aggregateError)
        : Promise.resolve({
            output_text: fullText,
            usage: { input_tokens: 5, output_tokens: opts.tokens.length, cached_input_tokens: 0 },
            model: 'fake-model',
            provider: 'openai',
            finish_reason: 'stop',
            latency_ms: 50,
            raw: {},
        })

    return { stream: gen(), aggregated }
}

// ────────────────────────────────────────────────────────────────────────────
// Wire shape
// ────────────────────────────────────────────────────────────────────────────

describe('streamLlmToNdjson — wire shape', () => {
    it('sets NDJSON headers before writing any frame', async () => {
        const res = createFakeResponse()
        await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: ['Hello ', 'world.'] }),
        })
        expect(res.headers['Content-Type']).toBe('text/plain; charset=utf-8')
        expect(res.headers['Transfer-Encoding']).toBe('chunked')
        expect(res.headers['Cache-Control']).toBe('no-cache')
        expect(res.headers['X-Content-Type-Options']).toBe('nosniff')
    })

    it('emits a delta frame per non-empty token (using `t: delta` not `text`)', async () => {
        const res = createFakeResponse()
        await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: ['Hello ', 'world.'] }),
        })
        const frames = parseFrames(res)
        const deltas = frames.filter((f) => f.t === 'delta')
        expect(deltas.length).toBe(2)
        expect(deltas[0]!.d).toBe('Hello ')
        expect(deltas[1]!.d).toBe('world.')
    })

    it('terminates with exactly one done frame as the last line on happy path', async () => {
        const res = createFakeResponse()
        await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: ['Hi'] }),
        })
        const frames = parseFrames(res)
        const dones = frames.filter((f) => f.t === 'done')
        expect(dones.length).toBe(1)
        expect(frames[frames.length - 1]!.t).toBe('done')
    })

    it('skips empty/falsy chunks (no delta frame emitted)', async () => {
        const res = createFakeResponse()
        await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: ['A', '', 'B'] }),
        })
        const frames = parseFrames(res)
        const deltas = frames.filter((f) => f.t === 'delta')
        expect(deltas.length).toBe(2)
    })

    it('done.data carries aggregated LLM fields', async () => {
        const res = createFakeResponse()
        await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: ['Hello'] }),
        })
        const frames = parseFrames(res)
        const done = frames.find((f) => f.t === 'done')!
        const data = done.data as any
        expect(data.success).toBe(true)
        expect(data.output_text).toBe('Hello')
        expect(data.model).toBe('fake-model')
        expect(data.provider).toBe('openai')
        expect(data.finish_reason).toBe('stop')
        expect(typeof data.latency_ms).toBe('number')
        expect(data.usage.output_tokens).toBe(1)
    })
})

// ────────────────────────────────────────────────────────────────────────────
// Error handling
// ────────────────────────────────────────────────────────────────────────────

describe('streamLlmToNdjson — error handling', () => {
    it('emits an error frame when the LLM stream throws', async () => {
        const res = createFakeResponse()
        const result = await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({
                tokens: ['hi'],
                streamError: new Error('upstream provider 503'),
            }),
        })
        const frames = parseFrames(res)
        const errs = frames.filter((f) => f.t === 'error')
        expect(errs.length).toBe(1)
        expect(errs[0]!.error).toContain('upstream provider 503')
        expect(result.aggregateOk).toBe(false)
    })

    it('emits an error frame when aggregation rejects', async () => {
        const res = createFakeResponse()
        const result = await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({
                tokens: ['hi'],
                aggregateError: new Error('upstream aggregation failed'),
            }),
        })
        const frames = parseFrames(res)
        const errs = frames.filter((f) => f.t === 'error')
        expect(errs.length).toBe(1)
        expect(errs[0]!.error).toContain('aggregation')
        expect(result.aggregateOk).toBe(false)
    })

    it('does not emit done after an LLM stream error', async () => {
        const res = createFakeResponse()
        await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({
                tokens: ['hi'],
                streamError: new Error('boom'),
            }),
        })
        const frames = parseFrames(res)
        expect(frames.filter((f) => f.t === 'done').length).toBe(0)
    })
})

// ────────────────────────────────────────────────────────────────────────────
// onBeforeDone hook
// ────────────────────────────────────────────────────────────────────────────

describe('streamLlmToNdjson — onBeforeDone hook', () => {
    it('merges hook return value into done.data', async () => {
        const res = createFakeResponse()
        await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: ['Hi'] }),
            onBeforeDone: () => ({ billing: { credits_used: 3, charged_from: 'credits' } }),
        })
        const frames = parseFrames(res)
        const done = frames.find((f) => f.t === 'done')!
        const data = done.data as any
        expect(data.billing).toEqual({ credits_used: 3, charged_from: 'credits' })
        expect(data.output_text).toBe('Hi')
    })

    it('awaits an async hook before writing done', async () => {
        const res = createFakeResponse()
        let settled = false
        await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: ['Hi'] }),
            onBeforeDone: async () => {
                await new Promise((r) => setTimeout(r, 5))
                settled = true
                return { async_field: 'present' }
            },
        })
        const frames = parseFrames(res)
        const done = frames.find((f) => f.t === 'done')!
        expect(settled).toBe(true)
        expect((done.data as any).async_field).toBe('present')
    })

    it('passes aggregated + msTotal into the hook', async () => {
        const res = createFakeResponse()
        let received: any = null
        await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: ['Hi'] }),
            onBeforeDone: (info) => { received = info; return {} },
        })
        expect(received).not.toBeNull()
        expect(received.aggregated.output_text).toBe('Hi')
        expect(received.msTotal).toBeGreaterThanOrEqual(0)
    })

    it('continues with base done when the hook throws', async () => {
        const res = createFakeResponse()
        await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: ['Hi'] }),
            onBeforeDone: () => { throw new Error('billing service down') },
        })
        const frames = parseFrames(res)
        const done = frames.find((f) => f.t === 'done')!
        expect(done).toBeDefined()
        expect((done.data as any).output_text).toBe('Hi')
        expect((done.data as any).billing).toBeUndefined()
    })

    it('is not called when LLM aggregation rejects', async () => {
        const res = createFakeResponse()
        let called = false
        await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({
                tokens: ['Hi'],
                aggregateError: new Error('upstream aggregation failed'),
            }),
            onBeforeDone: () => { called = true; return {} },
        })
        expect(called).toBe(false)
    })
})

// ────────────────────────────────────────────────────────────────────────────
// Return value
// ────────────────────────────────────────────────────────────────────────────

describe('streamLlmToNdjson — return value', () => {
    it('returns aggregateOk=true on happy path with resolved aggregated', async () => {
        const res = createFakeResponse()
        const result = await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({ tokens: ['Hi'] }),
        })
        expect(result.aggregateOk).toBe(true)
        expect(result.aggregated.output_text).toBe('Hi')
        expect(result.msTotal).toBeGreaterThanOrEqual(0)
    })

    it('returns aggregateOk=false and a stub aggregated when stream errors', async () => {
        const res = createFakeResponse()
        const result = await streamLlmToNdjson({
            res,
            llmStream: createFakeLlmStream({
                tokens: ['Hi'],
                streamError: new Error('boom'),
            }),
        })
        expect(result.aggregateOk).toBe(false)
        expect(result.aggregated.model).toBe('')
        expect(result.aggregated.finish_reason).toBe('error')
    })
})
