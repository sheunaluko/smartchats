/**
 * OpenAI embeddings helper — single source of truth for "POST text to
 * OpenAI's embeddings endpoint and unwrap the response." Both the open
 * self-hosted /embeddings/embed route and the cloud openaiEmbedding
 * Cloud Function call this.
 *
 * Locked to text-embedding-3-small. Adding another model means either
 * extending the options here (with a price lookup keyed by model) or
 * shipping a parallel helper. Today nothing in the stack needs another
 * model — keep this narrow until that changes.
 *
 * Pricing: $0.02 per 1M tokens (OpenAI text-embedding-3-small as of
 * 2026-06-30). Recompute if OpenAI drops their per-model rate.
 */

import OpenAI from 'openai'

export const EMBEDDING_MODEL = 'text-embedding-3-small'
const USD_PER_1M_TOKENS = 0.02

export interface OpenAIEmbeddingOptions {
    /** OpenAI API key. Required. */
    apiKey: string
    text: string
    /** Optional explicit output dimensions. OpenAI's embeddings-3 family
     *  supports dimension reduction via this param. */
    dimensions?: number
    /** Optional abort signal. */
    signal?: AbortSignal
}

export interface OpenAIEmbeddingResult {
    embedding: number[]
    model: string
    /** Resolved dimensions (embedding.length). Returned so callers can
     *  surface this without computing it themselves. */
    dimensions: number
    /** Tokens charged for the input — read from response.usage.total_tokens. */
    inputTokens: number
    /** Derived USD cost based on inputTokens × per-token rate. */
    costUsd: number
}

export class OpenAIEmbeddingError extends Error {
    constructor(message: string, public readonly cause?: unknown) {
        super(message)
        this.name = 'OpenAIEmbeddingError'
    }
}

export async function openaiEmbedding(opts: OpenAIEmbeddingOptions): Promise<OpenAIEmbeddingResult> {
    if (!opts.apiKey) throw new OpenAIEmbeddingError('OpenAI API key not configured')
    if (!opts.text || opts.text.length === 0) {
        throw new OpenAIEmbeddingError('text is required')
    }

    let response: { data: Array<{ embedding: number[] }>; usage?: { total_tokens?: number } }
    try {
        const client = new OpenAI({ apiKey: opts.apiKey })
        response = await client.embeddings.create({
            input: opts.text,
            model: EMBEDDING_MODEL,
            ...(opts.dimensions && { dimensions: opts.dimensions }),
        })
    } catch (err) {
        throw new OpenAIEmbeddingError(
            `OpenAI embedding failed: ${(err as Error).message}`,
            err,
        )
    }

    const embedding = response.data[0]?.embedding ?? []
    const inputTokens = response.usage?.total_tokens ?? 0
    const costUsd = (inputTokens * USD_PER_1M_TOKENS) / 1_000_000

    return {
        embedding,
        model: EMBEDDING_MODEL,
        dimensions: embedding.length,
        inputTokens,
        costUsd,
    }
}
