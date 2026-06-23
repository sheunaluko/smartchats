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
import { openaiTtsStream } from 'llm-service';

import type {
    ConnectOpts, CostEstimate, StreamOpts,
    TtsConnection, TtsProvider,
} from './_types.js';

// Per-million-token pricing for gpt-4o-mini-tts (OpenAI, approximate).
// $0.60 / 1M input tokens, $12 / 1M output tokens. Output tokens are
// roughly bytes / 24 for PCM16 24kHz mono encoded as audio_tokens.
// Coarse model; we'll refine if we use this for serious billing decisions.
const PRICE_PER_M_INPUT_TOKENS = 0.60;
const PRICE_PER_M_OUTPUT_TOKENS = 12.0;
const TOKENS_PER_CHAR_APPROX = 0.27;          // gpt-4o-mini-tts char→token ratio
const OUTPUT_TOKENS_PER_BYTE_APPROX = 1 / 24; // crude PCM→token estimate

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
        const inputTokens = Math.ceil(opts.text.length * TOKENS_PER_CHAR_APPROX);
        const outputTokens = Math.ceil(opts.outputBytes * OUTPUT_TOKENS_PER_BYTE_APPROX);
        const usd =
            (inputTokens / 1_000_000) * PRICE_PER_M_INPUT_TOKENS +
            (outputTokens / 1_000_000) * PRICE_PER_M_OUTPUT_TOKENS;
        return { usd, unit: 'tokens', quantity: inputTokens + outputTokens };
    }

    listVoices(): string[] {
        return VOICES;
    }
}
