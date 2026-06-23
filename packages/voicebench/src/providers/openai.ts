/**
 * OpenAI reference adapter.
 *
 * Thin wrapper over `openaiTtsStream` from llm-service — that function is
 * already the "for await (pcm of ...)" shape we want, so the adapter just
 * surfaces the timing callbacks and packages it as a TtsConnection.
 *
 * connect() is essentially free for OpenAI because the SDK uses an HTTP
 * client with keepalive — the first request pays a TCP+TLS handshake but
 * subsequent calls on the same OpenAI client reuse the connection pool.
 * We can't observe handshake time from the SDK directly, so `setup_ms`
 * is reported as 0 and `is_cold` as false. (For comparing against
 * fresh-WS providers, the relevant metric is `time_to_first_byte_ms`
 * inside stream(), which captures everything end-to-end.)
 *
 * Voice list mirrors what's accepted by gpt-4o-mini-tts in production.
 */

import OpenAI from 'openai';
import { openaiTtsStream, countGpt4oMiniTtsInputTokens } from 'llm-service';
import { estimateGpt4oMiniTtsCost } from 'cortex';

import type {
    ConnectOpts, CostEstimate, StreamOpts,
    TtsConnection, TtsProvider,
} from './_types.js';

// Cost model delegates to cortex's estimateGpt4oMiniTtsCost — the same
// function prod billing uses (functions/src/llm/tts_stream_http.ts +
// llm_tts_stream_http.ts). Previous hand-rolled constants here were
// 100x off because the PCM-bytes-per-audio-token ratio was wrong
// (24 vs the actual 2400 in model_registry.ts:342).

const VOICES = [
    'alloy', 'ash', 'ballad', 'cedar', 'coral', 'echo',
    'marin', 'nova', 'onyx', 'sage', 'shimmer', 'verse',
];

class OpenAIConnection implements TtsConnection {
    readonly is_cold = false;
    readonly setup_ms = 0;

    constructor(
        private readonly client: OpenAI,
        private readonly opts: ConnectOpts,
    ) {}

    async *stream(streamOpts: StreamOpts): AsyncIterable<Buffer> {
        const t0 = Date.now();
        let firstByteReported = false;
        let batchIndex = 0;

        const gen = openaiTtsStream(this.client, {
            text: streamOpts.text,
            voice: this.opts.voice,
            model: this.opts.model ?? 'gpt-4o-mini-tts',
            speed: streamOpts.speed ?? 1.0,
            ...(streamOpts.instructions ? { instructions: streamOpts.instructions } : {}),
            ...(this.opts.targetBytes !== undefined ? { targetBytes: this.opts.targetBytes } : {}),
            ...(this.opts.firstBatchBytes !== undefined ? { firstBatchBytes: this.opts.firstBatchBytes } : {}),
            onTiming: (event) => {
                if (event.phase === 'first_byte' && !firstByteReported) {
                    firstByteReported = true;
                    streamOpts.onFirstByte?.(Date.now() - t0);
                }
                // batch_yield is fired BEFORE the yield statement in
                // openaiTtsStream; we re-fire onBatchYield here to keep the
                // provider-agnostic shape consistent (and because the SDK
                // only tells us ms_since_request, not bytes-since-stream-call).
            },
        });

        for await (const pcm of gen) {
            streamOpts.onBatchYield?.({
                batchIndex,
                bytes: pcm.length,
                msFromStreamCall: Date.now() - t0,
                // openai_bytes_cumulative isn't exposed via the public
                // generator return; matches the output cumulative bytes
                // here, which is good enough for benchmark math.
                providerBytesCumulative: pcm.length, // approx; would need SDK-level access to be exact
            });
            batchIndex += 1;
            yield pcm;
        }
    }

    async close(): Promise<void> {
        // OpenAI HTTP client doesn't expose explicit close; rely on GC.
    }
}

export class OpenAITtsProvider implements TtsProvider {
    readonly name = 'openai';

    constructor(
        private readonly apiKey: string = process.env['OPENAI_API_KEY'] ?? '',
    ) {
        if (!this.apiKey) {
            throw new Error('OpenAI provider needs OPENAI_API_KEY (env or constructor arg)');
        }
    }

    async connect(opts: ConnectOpts): Promise<TtsConnection> {
        const client = new OpenAI({ apiKey: this.apiKey });
        return new OpenAIConnection(client, opts);
    }

    estimateCost(opts: { text: string; outputBytes: number; voice: string; model?: string }): CostEstimate {
        const inputTokens = countGpt4oMiniTtsInputTokens(opts.text);
        const est = estimateGpt4oMiniTtsCost({ inputTokens, outputPcmBytes: opts.outputBytes });
        return {
            usd: est.costUsd,
            unit: 'tokens',
            quantity: est.inputTokens + est.outputTokens,
        };
    }

    listVoices(): string[] {
        return VOICES;
    }
}
