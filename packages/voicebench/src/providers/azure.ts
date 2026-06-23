/**
 * Azure Cognitive Services Speech — TTS adapter using the Speech SDK.
 *
 * Pattern follows the maintainer's Azure spec:
 *   - SpeechConfig.fromSubscription(key, region) — shared config built in connect()
 *   - new SpeechSynthesizer(config, null) per stream() call (per Microsoft's
 *     guidance; the SDK pools the underlying WS connection so per-request
 *     instantiation is cheap once warm)
 *   - synthesizer.synthesizing event fires incrementally with event.result.audioData
 *     buffers — this is the streaming surface we tap, NOT the result.audioData
 *     from the speakTextAsync callback (that would double-count audio)
 *   - Built-in latency properties on the result expose finer-grained Azure-side
 *     metrics (SynthesisConnectionLatencyMs / FirstByteLatencyMs etc) — we log
 *     them but use our own wall-clock for the TTFB metric so it stays
 *     comparable to other providers
 *
 * Output format: Raw24Khz16BitMonoPcm — drop-in match for the other adapters'
 * PCM16 24kHz mono pipeline. MP3 / Opus / μ-law are all available via the SDK
 * but would break cross-provider comparability; if a real prod swap to Azure
 * happens, the cloud handler can switch to MP3 separately for browser playback.
 *
 * connect() is effectively free (just builds a SpeechConfig). The first
 * stream() call after process start eats the cold WS handshake (~100-300ms);
 * subsequent calls reuse the connection. The SDK exposes that via
 * SynthesisConnectionLatencyMs (= 0 when reused) so we can verify the
 * speculative-connect savings empirically later.
 *
 * Auth: AZURE_SPEECH_KEY + AZURE_SPEECH_REGION env vars. Voice defaults to
 * AZURE_SPEECH_VOICE or "en-US-AvaMultilingualNeural".
 *
 * Pricing: Azure Neural TTS Standard is $16/M characters at time of writing;
 * HD voices are $30/M. Placeholder constant; calibrate against the actual
 * Azure billing console after a first batch.
 */

import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

import type {
    ConnectOpts, CostEstimate, StreamOpts,
    TtsConnection, TtsProvider,
} from './_types.js';

const DEFAULT_VOICE = process.env['AZURE_SPEECH_VOICE'] ?? 'en-US-AvaMultilingualNeural';
const DEFAULT_TARGET_BYTES = 6400;
const PRICE_PER_M_CHARS = 16.0;

const VOICES = [
    'en-US-AvaMultilingualNeural',
    'en-US-AndrewMultilingualNeural',
    'en-US-EmmaMultilingualNeural',
    'en-US-BrianMultilingualNeural',
    'en-US-JennyNeural',
    'en-US-GuyNeural',
    'en-US-AriaNeural',
    'en-US-DavisNeural',
];

class AzureTtsConnection implements TtsConnection {
    readonly is_cold: boolean;
    readonly setup_ms: number;

    constructor(
        private readonly speechConfig: sdk.SpeechConfig,
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

        // Per the spec: passing null AudioConfig means "stream from the
        // synthesizing event, no default speaker/file sink." Required for
        // our event-driven AsyncIterable pattern.
        const synthesizer = new sdk.SpeechSynthesizer(this.speechConfig, null);

        // Bridge synthesizing events → AsyncIterable queue.
        const queue: { value: Buffer | null; err?: Error }[] = [];
        let resolveNext: ((v: { value: Buffer | null; err?: Error }) => void) | null = null;
        const push = (item: { value: Buffer | null; err?: Error }) => {
            if (resolveNext) { resolveNext(item); resolveNext = null; }
            else queue.push(item);
        };

        let firstByteReported = false;
        synthesizer.synthesizing = (_s, event) => {
            const ab = event.result.audioData;
            if (!ab || ab.byteLength === 0) return;
            if (!firstByteReported) {
                firstByteReported = true;
                streamOpts.onFirstByte?.(Date.now() - t0);
            }
            push({ value: Buffer.from(ab) });
        };

        // Kick off the synthesis. Callback-style → Promise wrap.
        // CRITICAL: don't also yield result.audioData from this callback
        // — synthesizing already collected the full audio. Per spec:
        // "Do not write result.audioData again in the final callback,
        // or you may duplicate audio."
        const synthesisPromise = new Promise<sdk.SpeechSynthesisResult>((resolve, reject) => {
            synthesizer.speakTextAsync(
                streamOpts.text,
                (result) => {
                    if (result.reason === sdk.ResultReason.SynthesizingAudioCompleted) {
                        resolve(result);
                    } else {
                        reject(new Error(`Azure synthesis failed (reason=${result.reason}): ${result.errorDetails || 'no details'}`));
                    }
                },
                (err) => reject(new Error(`Azure speakTextAsync error: ${String(err)}`)),
            );
        });

        // When synthesis completes (or errors), signal end-of-stream.
        synthesisPromise
            .then(() => push({ value: null }))
            .catch((err) => push({ value: null, err }));

        try {
            let buffer: Buffer = Buffer.alloc(0);
            let providerBytesCumulative = 0;
            let batchIndex = 0;

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
                    let batch = Buffer.from(buffer.subarray(0, currentTarget));
                    buffer = Buffer.from(buffer.subarray(currentTarget));
                    if (batch.length % 2 !== 0) {
                        buffer = Buffer.concat([batch.subarray(batch.length - 1), buffer]);
                        batch = Buffer.from(batch.subarray(0, batch.length - 1));
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

            if (buffer.length > 0) {
                if (buffer.length % 2 !== 0) buffer = Buffer.from(buffer.subarray(0, buffer.length - 1));
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
        } finally {
            synthesizer.close();
        }
    }

    async close(): Promise<void> {
        // Per-call synthesizer is closed in stream()'s finally;
        // the SpeechConfig itself has no explicit close needed.
    }
}

export class AzureTtsProvider implements TtsProvider {
    readonly name = 'azure';
    private speechConfig: sdk.SpeechConfig | null = null;

    constructor(
        private readonly apiKey: string = process.env['AZURE_SPEECH_KEY'] ?? '',
        private readonly region: string = process.env['AZURE_SPEECH_REGION'] ?? 'eastus',
    ) {
        if (!this.apiKey) throw new Error('azure provider needs AZURE_SPEECH_KEY');
        if (!this.region) throw new Error('azure provider needs AZURE_SPEECH_REGION');
    }

    async connect(opts: ConnectOpts): Promise<TtsConnection> {
        const isCold = this.speechConfig === null;
        const t0 = Date.now();
        if (!this.speechConfig) {
            this.speechConfig = sdk.SpeechConfig.fromSubscription(this.apiKey, this.region);
            // Raw PCM 24kHz mono 16-bit — matches the other adapters' output
            // shape so cross-provider numbers stay comparable. The SDK
            // supports MP3/Opus/μ-law too; switch in the cloud handler
            // separately if browser playback drives a different choice.
            this.speechConfig.speechSynthesisOutputFormat =
                sdk.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm;
        }
        this.speechConfig.speechSynthesisVoiceName = opts.voice;
        const setupMs = isCold ? Date.now() - t0 : 0;
        return new AzureTtsConnection(this.speechConfig, opts, isCold, setupMs);
    }

    estimateCost(opts: { text: string; outputBytes: number; voice: string; model?: string }): CostEstimate {
        const chars = opts.text.length;
        const usd = (chars / 1_000_000) * PRICE_PER_M_CHARS;
        return { usd, unit: 'characters', quantity: chars };
    }

    listVoices(): string[] { return VOICES; }
}
