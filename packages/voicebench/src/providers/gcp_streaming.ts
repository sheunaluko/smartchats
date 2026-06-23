/**
 * Google Cloud TTS — StreamingSynthesize adapter.
 *
 * Uses @google-cloud/text-to-speech's bidirectional gRPC streaming API.
 * Pattern lifted from tidyscripts/bin/dev/ws_stream_server_gcp.ts:
 *   - Open duplex stream
 *   - Write streamingConfig (voice, audio encoding, sample rate)
 *   - Write { input: { text } } once per chunk of text
 *   - Read audioContent chunks back
 *   - Call .end() to signal end-of-input
 *
 * One stream() call = one TTS turn. The gRPC duplex stream is created
 * lazily inside stream() (not connect()) because GCP's streaming surface
 * is per-request — there's no persistent session to pre-warm. connect()
 * just constructs the client, which reuses the gRPC channel pool
 * underneath.
 *
 * Voice: only Chirp 3 HD voices support streaming. Default is Charon
 * (informative tone — pairs well with the existing "marin" energy in
 * our prod voice choice).
 *
 * Auth: GOOGLE_APPLICATION_CREDENTIALS env var pointing at a service
 * account JSON, OR running in a GCP environment with workload identity.
 * The TextToSpeechClient picks this up ambiently; if neither is present,
 * connect() throws.
 *
 * Audio format: PCM 24kHz mono — drop-in match for our existing
 * openaiTtsStream-shaped output.
 */

import { TextToSpeechClient } from '@google-cloud/text-to-speech';

import type {
    ConnectOpts, CostEstimate, StreamOpts,
    TtsConnection, TtsProvider,
} from './_types.js';

// Chirp 3 HD voice list (full set: en-US-Chirp3-HD-{Achernar, Achird,
// Algenib, Algieba, ..., Charon, ..., Zubenelgenubi}). Only Chirp 3 HD
// supports streaming — Studio / Neural2 / WaveNet voices don't.
const VOICES = [
    'en-US-Chirp3-HD-Charon',       // informative
    'en-US-Chirp3-HD-Aoede',        // breezy
    'en-US-Chirp3-HD-Puck',         // upbeat
    'en-US-Chirp3-HD-Kore',         // firm
    'en-US-Chirp3-HD-Leda',         // youthful
    'en-US-Chirp3-HD-Orus',         // firm-alt
    'en-US-Chirp3-HD-Zephyr',       // bright
    'en-US-Chirp3-HD-Sulafat',      // warm
];

// Per-1M-char pricing for Chirp 3 HD voices. Approximate — Google's
// pricing page is the source of truth. Rounding up for safety.
// See https://cloud.google.com/text-to-speech/pricing
const PRICE_PER_M_CHARS = 30.0;     // USD per 1M characters, Chirp HD tier
const DEFAULT_TARGET_BYTES = 6400;  // ~133ms of PCM16 24kHz mono — matches our cross-provider unit

class GcpStreamingConnection implements TtsConnection {
    readonly is_cold: boolean;
    readonly setup_ms: number;

    constructor(
        private readonly client: TextToSpeechClient,
        private readonly opts: ConnectOpts,
        isCold: boolean,
        setupMs: number,
    ) {
        this.is_cold = isCold;
        this.setup_ms = setupMs;
    }

    async *stream(streamOpts: StreamOpts): AsyncIterable<Buffer> {
        const t0 = Date.now();
        const targetBytes = this.opts.targetBytes ?? DEFAULT_TARGET_BYTES;
        const firstBatchBytes = this.opts.firstBatchBytes ?? targetBytes;

        // Open the gRPC duplex stream for this TTS turn.
        const grpc = this.client.streamingSynthesize();

        // First write: streaming config (voice + audio encoding).
        // Send before any text input, per the API contract.
        grpc.write({
            streamingConfig: {
                voice: {
                    name: this.opts.voice,
                    languageCode: this.opts.voice.split('-').slice(0, 2).join('-'),
                },
                streamingAudioConfig: {
                    audioEncoding: 'PCM' as any,
                    speakingRate: streamOpts.speed ?? 1.0,
                    sampleRateHertz: 24000,
                },
            },
        });

        // Write the text input. GCP accepts incremental text writes but
        // for benchmark parity we send the whole utterance as one chunk
        // (same shape as openaiTtsStream's atomic input call).
        grpc.write({ input: { text: streamOpts.text } });
        grpc.end();

        // Collect responses into our 6400-byte batcher.
        // Explicit `: Buffer` annotation widens to Buffer<ArrayBufferLike>
        // so we can accept chunks from item.value (the SDK delivers wide
        // Buffers); narrowing only happens at the yield via Buffer.from.
        let buffer: Buffer = Buffer.alloc(0);
        let providerBytesCumulative = 0;
        let batchIndex = 0;
        let firstByteReported = false;

        // Queue audioContent chunks so the async iterator can pull them.
        const queue: { value: Buffer | null; err?: Error }[] = [];
        let resolveNext: ((v: { value: Buffer | null; err?: Error }) => void) | null = null;
        const pushQueue = (item: { value: Buffer | null; err?: Error }) => {
            if (resolveNext) { resolveNext(item); resolveNext = null; }
            else queue.push(item);
        };

        grpc.on('data', (response: { audioContent?: Buffer | Uint8Array }) => {
            if (!response.audioContent || response.audioContent.length === 0) return;
            const chunk = Buffer.isBuffer(response.audioContent)
                ? response.audioContent
                : Buffer.from(response.audioContent);
            if (!firstByteReported) {
                firstByteReported = true;
                streamOpts.onFirstByte?.(Date.now() - t0);
            }
            pushQueue({ value: chunk });
        });
        grpc.on('end', () => pushQueue({ value: null }));
        grpc.on('error', (err: Error) => pushQueue({ value: null, err }));

        // Drain loop: pull raw chunks → accumulate into 6400-byte batches.
        while (true) {
            const item = queue.length > 0
                ? queue.shift()!
                : await new Promise<{ value: Buffer | null; err?: Error }>((res) => { resolveNext = res; });
            if (item.err) throw item.err;
            if (item.value === null) break;

            const chunk = item.value;
            providerBytesCumulative += chunk.length;
            buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);

            const currentTarget = batchIndex === 0 ? firstBatchBytes : targetBytes;
            while (buffer.length >= currentTarget) {
                let batch = buffer.subarray(0, currentTarget);
                buffer = buffer.subarray(currentTarget);
                // PCM16 alignment — even byte boundary.
                if (batch.length % 2 !== 0) {
                    buffer = Buffer.concat([batch.subarray(batch.length - 1), buffer]);
                    batch = batch.subarray(0, batch.length - 1);
                }
                streamOpts.onBatchYield?.({
                    batchIndex,
                    bytes: batch.length,
                    msFromStreamCall: Date.now() - t0,
                    providerBytesCumulative,
                });
                yield batch;
                batchIndex++;
            }
        }

        // Flush remainder.
        if (buffer.length > 0) {
            if (buffer.length % 2 !== 0) buffer = buffer.subarray(0, buffer.length - 1);
            if (buffer.length > 0) {
                streamOpts.onBatchYield?.({
                    batchIndex,
                    bytes: buffer.length,
                    msFromStreamCall: Date.now() - t0,
                    providerBytesCumulative,
                });
                yield buffer;
            }
        }
    }

    async close(): Promise<void> {
        // Per-call gRPC streams are closed on .end() above; the client itself
        // is shared across stream() calls and closes at provider-level.
    }
}

export class GcpStreamingTtsProvider implements TtsProvider {
    readonly name = 'gcp_streaming';
    private client: TextToSpeechClient | null = null;
    private clientInitMs = 0;

    async connect(opts: ConnectOpts): Promise<TtsConnection> {
        const isCold = this.client === null;
        const t0 = Date.now();
        if (!this.client) {
            // The TextToSpeechClient picks up GOOGLE_APPLICATION_CREDENTIALS
            // (or GCE/workload identity) ambiently. Constructor does the
            // auth scope setup; the actual gRPC channel is lazy-opened on
            // first call.
            this.client = new TextToSpeechClient();
            this.clientInitMs = Date.now() - t0;
        }
        const setupMs = isCold ? this.clientInitMs : 0;
        return new GcpStreamingConnection(this.client, opts, isCold, setupMs);
    }

    estimateCost(opts: { text: string; outputBytes: number; voice: string; model?: string }): CostEstimate {
        const chars = opts.text.length;
        const usd = (chars / 1_000_000) * PRICE_PER_M_CHARS;
        return { usd, unit: 'characters', quantity: chars };
    }

    listVoices(): string[] {
        return VOICES;
    }
}
