/**
 * Gemini Flash TTS (deferred-style, streaming) adapter.
 *
 * Separate from gemini_live — this is the `client.interactions.create({
 * model, response_format: { type: 'audio' }, stream: true })` surface,
 * positioned by Google's docs for "podcast/audiobook generation" but
 * supporting incremental streaming via the `stream: true` flag. Per the
 * docs:
 *
 *   for await (const event of stream) {
 *     if (event.event_type === 'step.delta' && event.delta.type === 'audio') {
 *       const audioBuffer = Buffer.from(event.delta.data, 'base64');
 *     }
 *   }
 *
 * Worth benchmarking because (a) Google's framing of "not for real-time"
 * may understate the actual latency, and (b) it avoids the heavy
 * bidirectional Live API surface. If gemini_tts matches gemini_live's
 * stutter numbers without the Live complexity, it's a simpler integration
 * target.
 *
 * Audio output: PCM 16-bit 24kHz mono — same as Live, drop-in match.
 *
 * Model is constructor-configurable; default is gemini-3.1-flash-tts-preview.
 * Other plausibles: gemini-2.5-flash-preview-tts, gemini-2.5-pro-preview-tts.
 */

import { GoogleGenAI } from '@google/genai';

import type {
    ConnectOpts, CostEstimate, StreamOpts,
    TtsConnection, TtsProvider,
} from './_types.js';

const DEFAULT_MODEL = 'gemini-3.1-flash-tts-preview';
const DEFAULT_TARGET_BYTES = 6400;
const PRICE_PER_AUDIO_SECOND_OUTPUT_USD = 0.000125;  // placeholder, calibrate later

const VOICES = [
    'Kore', 'Puck', 'Charon', 'Aoede', 'Leda', 'Zephyr', 'Sulafat', 'Achird',
    'Fenrir', 'Orus', 'Autonoe', 'Algenib',
];

class GeminiTtsConnection implements TtsConnection {
    readonly is_cold = true;
    readonly setup_ms: number;

    constructor(
        private readonly ai: GoogleGenAI,
        private readonly model: string,
        private readonly opts: ConnectOpts,
        setupMs: number,
    ) {
        this.setup_ms = setupMs;
    }

    async *stream(streamOpts: StreamOpts): AsyncIterable<Buffer> {
        const t0 = Date.now();
        const targetBytes = this.opts.targetBytes ?? DEFAULT_TARGET_BYTES;
        const firstBatchBytes = this.opts.firstBatchBytes ?? targetBytes;

        // interactions.create returns an async iterator when stream:true.
        // Per Google's docs each yielded event has shape:
        //   { event_type, delta?: { type, data } }
        // Audio frames are step.delta with delta.type === 'audio'.
        const stream = await (this.ai as any).interactions.create({
            model: this.model,
            input: streamOpts.text,
            response_format: { type: 'audio' },
            generation_config: {
                speech_config: [{ voice: this.opts.voice }],
                ...(streamOpts.speed !== undefined ? { speech_rate: streamOpts.speed } : {}),
            },
            stream: true,
        });

        let buffer: Buffer = Buffer.alloc(0);
        let providerBytesCumulative = 0;
        let batchIndex = 0;
        let firstByteReported = false;

        // SDK 2.x schema (verified empirically via probe — Google's
        // breaking-changes doc says `type` but the SDK actually still
        // emits `event_type` for these frames):
        //   { event_type: 'step.delta', index, delta: { type: 'audio',
        //     mime_type: 'audio/l16', sample_rate: 24000, channels: 1,
        //     data: '<base64 PCM16>' } }
        for await (const event of stream as AsyncIterable<any>) {
            if (event?.event_type !== 'step.delta' || event?.delta?.type !== 'audio') continue;
            const b64 = event?.delta?.data;
            if (typeof b64 !== 'string' || !b64) continue;
            const chunk = Buffer.from(b64, 'base64');
            if (!firstByteReported) {
                firstByteReported = true;
                streamOpts.onFirstByte?.(Date.now() - t0);
            }
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
    }

    async close(): Promise<void> {
        // Per-request stream — nothing persistent to close.
    }
}

export class GeminiTtsProvider implements TtsProvider {
    readonly name: string;
    private readonly model: string;

    constructor(
        model: string = DEFAULT_MODEL,
        private readonly apiKey: string = process.env['GEMINI_API_KEY'] ?? '',
    ) {
        if (!this.apiKey) throw new Error('gemini_tts provider needs GEMINI_API_KEY');
        this.model = model;
        // Provider name includes model so bench output distinguishes variants.
        this.name = `gemini_tts:${model}`;
    }

    async connect(opts: ConnectOpts): Promise<TtsConnection> {
        const t0 = Date.now();
        const ai = new GoogleGenAI({ apiKey: this.apiKey });
        return new GeminiTtsConnection(ai, this.model, opts, Date.now() - t0);
    }

    estimateCost(opts: { text: string; outputBytes: number; voice: string; model?: string }): CostEstimate {
        const audioSeconds = opts.outputBytes / 48000;
        const usd = audioSeconds * PRICE_PER_AUDIO_SECOND_OUTPUT_USD;
        return { usd, unit: 'audio_seconds', quantity: audioSeconds };
    }

    listVoices(): string[] { return VOICES; }
}
