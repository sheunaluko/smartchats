/**
 * Azure Cognitive Services TTS adapter (production shape).
 *
 * Ported from packages/voicebench/src/providers/azure.ts — same Speech SDK
 * usage, same Raw24Khz16BitMonoPcm output format, but stripped of the bench
 * timing harness (no onFirstByte / onBatchYield callbacks, no setup_ms).
 *
 * Key reuse: a single SpeechConfig is built lazily on first stream() call,
 * then reused across calls. The SDK internally pools the underlying WS
 * connection, so the first call has a small handshake cost (~100-300ms)
 * and subsequent calls reuse the connection at near-zero overhead.
 *
 * Auth: pass key + region in the constructor (resolved from
 * SMARTCHATS_AZURE_SPEECH_KEY + SMARTCHATS_AZURE_SPEECH_REGION env vars
 * by the config layer).
 *
 * Pricing: Azure Neural TTS Standard = $16 / 1M characters at time of
 * writing. HD voices are $30 / 1M. This adapter assumes standard pricing;
 * recalibrate against the Azure billing console after first batch if HD
 * voices get used.
 */

import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

import type {
    ServerTtsAdapter, TtsStreamOpts, TtsCostOpts, TtsCostEstimate,
} from './_types.js';

const PRICE_PER_M_CHARS = 16.0;

/**
 * Multilingual + EN-US neural voices commonly used by SmartChats voice agent.
 * Azure's full catalog has 200+ voices including regional + speaker styles —
 * we'll add a runtime catalog API later if the static list isn't enough.
 */
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

export class AzureTtsAdapter implements ServerTtsAdapter {
    readonly name = 'azure';
    private speechConfig: sdk.SpeechConfig | null = null;

    constructor(
        private readonly apiKey: string,
        private readonly region: string,
    ) {
        if (!apiKey) throw new Error('AzureTtsAdapter requires apiKey');
        if (!region) throw new Error('AzureTtsAdapter requires region');
    }

    private getConfig(voice: string): sdk.SpeechConfig {
        if (!this.speechConfig) {
            this.speechConfig = sdk.SpeechConfig.fromSubscription(this.apiKey, this.region);
            // Raw PCM 24kHz mono 16-bit — matches the rest of the pipeline.
            this.speechConfig.speechSynthesisOutputFormat =
                sdk.SpeechSynthesisOutputFormat.Raw24Khz16BitMonoPcm;
        }
        this.speechConfig.speechSynthesisVoiceName = voice;
        return this.speechConfig;
    }

    async *stream(opts: TtsStreamOpts): AsyncIterable<Buffer> {
        const speechConfig = this.getConfig(opts.voice);
        // Per Microsoft's pattern: pass null AudioConfig to stream from the
        // synthesizing event (no default speaker/file sink). Required for
        // our async-iterator bridge.
        const synthesizer = new sdk.SpeechSynthesizer(speechConfig, null);

        // Bridge: SDK's synthesizing event → AsyncIterable queue.
        const queue: { value: Buffer | null; err?: Error }[] = [];
        let resolveNext: ((v: { value: Buffer | null; err?: Error }) => void) | null = null;
        const push = (item: { value: Buffer | null; err?: Error }) => {
            if (resolveNext) { resolveNext(item); resolveNext = null; }
            else queue.push(item);
        };

        synthesizer.synthesizing = (_s, event) => {
            const ab = event.result.audioData;
            if (!ab || ab.byteLength === 0) return;
            push({ value: Buffer.from(ab) });
        };

        // Trigger synthesis. CRITICAL: don't also push result.audioData from
        // the callback — the synthesizing event has already streamed all
        // audio. Doubling would duplicate the output.
        const synthesisPromise = new Promise<sdk.SpeechSynthesisResult>((resolve, reject) => {
            synthesizer.speakTextAsync(
                opts.text,
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

        // End-of-stream signal: push null when synthesis finishes (or errors).
        synthesisPromise
            .then(() => push({ value: null }))
            .catch((err) => push({ value: null, err }));

        try {
            while (true) {
                const item = queue.length > 0
                    ? queue.shift()!
                    : await new Promise<{ value: Buffer | null; err?: Error }>((res) => { resolveNext = res; });
                if (item.err) throw item.err;
                if (item.value === null) break;
                yield item.value;
            }
        } finally {
            synthesizer.close();
        }
    }

    estimateCost(opts: TtsCostOpts): TtsCostEstimate {
        const chars = opts.text.length;
        const usd = (chars / 1_000_000) * PRICE_PER_M_CHARS;
        return { usd, unit: 'characters', quantity: chars };
    }

    listVoices(): string[] { return VOICES; }
}
