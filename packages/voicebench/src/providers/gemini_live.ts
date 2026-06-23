/**
 * Gemini Live API adapter — text in, audio out, ignoring multimodal capabilities.
 *
 * Pattern (per Google's get-started-sdk docs):
 *   import { GoogleGenAI, Modality } from '@google/genai';
 *   const session = await ai.live.connect({
 *     model: 'gemini-3.1-flash-live-preview',
 *     callbacks: { onopen, onmessage, onerror, onclose },
 *     config: { responseModalities: [Modality.AUDIO] },
 *   });
 *   session.sendRealtimeInput({ text: '...' });
 *   // onmessage fires with serverContent.modelTurn.parts[].inlineData.data (base64)
 *   // turn complete is signaled via serverContent.turnComplete = true
 *
 * Audio output: raw 16-bit PCM, 24kHz, little-endian — drop-in match
 * for our format. No conversion needed beyond base64 decode + re-batch.
 *
 * The Live API is fundamentally conversational (designed for full audio
 * in + audio out + multimodal). We use it as one-way TTS only by sending
 * text input and ignoring everything except audio output. That's
 * supported but suboptimal — Gemini Live is "a tank to swat flies" for
 * this use case. If the benchmark shows it wins on latency, great; if
 * it doesn't, drop it.
 *
 * Like xai_ws, this adapter persists ONE session per `provider.connect()`
 * and multiplexes stream() calls over it. The Live API does support
 * multiple turns per session — each `sendRealtimeInput` starts a new
 * turn — so the speculative-connect pattern works the same way.
 *
 * Auth: GEMINI_API_KEY env var. The existing cloud Function code
 * (gemini.ts in llm-service) already uses this var for LLM calls;
 * reusable for the Live API too.
 */

import { GoogleGenAI, Modality } from '@google/genai';

import type {
    ConnectOpts, CostEstimate, StreamOpts,
    TtsConnection, TtsProvider,
} from './_types.js';

const DEFAULT_MODEL = 'gemini-3.1-flash-live-preview';
const DEFAULT_TARGET_BYTES = 6400;

// Approximate pricing for Live API audio output (per second of audio).
// Google's pricing for Live is per-second of input AND output audio,
// not per-character. Placeholder constants — calibrate after first
// billing cycle.
const PRICE_PER_AUDIO_SECOND_OUTPUT_USD = 0.000125;  // ≈ $7.50 / hour audio output

// 30 voices per the TTS docs; the Live API exposes most of them.
const VOICES = [
    'Kore',         // firm (good neutral default)
    'Puck',         // upbeat
    'Charon',       // informative
    'Aoede',        // breezy
    'Leda',         // youthful
    'Zephyr',       // bright
    'Sulafat',      // warm
    'Achird',       // friendly
];

interface PendingTurn {
    onAudioChunk: (chunk: Buffer) => void;
    onTurnComplete: () => void;
    onError: (err: Error) => void;
}

class GeminiLiveConnection implements TtsConnection {
    readonly is_cold: boolean;
    readonly setup_ms: number;
    private busy = false;
    private current: PendingTurn | null = null;
    private closed = false;
    private closeError: Error | null = null;

    constructor(
        private readonly session: any,        // @google/genai LiveSession; SDK types are loose
        isCold: boolean,
        setupMs: number,
    ) {
        this.is_cold = isCold;
        this.setup_ms = setupMs;
    }

    /** Route an incoming Live message into the current turn's listeners. */
    handleMessage(message: any): void {
        const content = message?.serverContent;
        if (!content) return;
        const parts = content?.modelTurn?.parts ?? [];
        for (const part of parts) {
            if (part?.inlineData?.data) {
                const chunk = Buffer.from(part.inlineData.data, 'base64');
                this.current?.onAudioChunk(chunk);
            }
        }
        // Server signals end-of-turn so we know audio is complete.
        if (content?.turnComplete === true) {
            this.current?.onTurnComplete();
        }
    }

    handleError(err: Error): void {
        this.closeError = err;
        this.current?.onError(err);
    }

    handleClose(reason?: string): void {
        this.closed = true;
        if (!this.closeError) this.closeError = new Error(`Gemini Live closed: ${reason ?? '(no reason)'}`);
        this.current?.onError(this.closeError);
    }

    async *stream(streamOpts: StreamOpts): AsyncIterable<Buffer> {
        if (this.busy) throw new Error('gemini_live adapter: concurrent stream() not supported on same connection');
        if (this.closed) throw this.closeError ?? new Error('connection already closed');
        this.busy = true;
        const t0 = Date.now();
        const targetBytes = DEFAULT_TARGET_BYTES;
        const firstBatchBytes = targetBytes;

        const queue: { value: Buffer | null; err?: Error }[] = [];
        let resolveNext: ((v: { value: Buffer | null; err?: Error }) => void) | null = null;
        const push = (item: { value: Buffer | null; err?: Error }) => {
            if (resolveNext) { resolveNext(item); resolveNext = null; }
            else queue.push(item);
        };

        let firstByteReported = false;
        this.current = {
            onAudioChunk: (chunk) => {
                if (!firstByteReported) {
                    firstByteReported = true;
                    streamOpts.onFirstByte?.(Date.now() - t0);
                }
                push({ value: chunk });
            },
            onTurnComplete: () => push({ value: null }),
            onError: (err) => push({ value: null, err }),
        };

        try {
            this.session.sendRealtimeInput({ text: streamOpts.text });

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
                    // Buffer.from forces Buffer<ArrayBuffer> (vs subarray which returns
                    // Buffer<ArrayBufferLike>) so the yielded type matches the
                    // adapter contract under TS 5.4's stricter typing.
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
            this.current = null;
            this.busy = false;
        }
    }

    async close(): Promise<void> {
        if (this.closed) return;
        this.closed = true;
        try { this.session.close(); } catch { /* swallow */ }
    }
}

export class GeminiLiveTtsProvider implements TtsProvider {
    readonly name = 'gemini_live';
    constructor(
        private readonly apiKey: string = process.env['GEMINI_API_KEY'] ?? '',
        private readonly model: string = DEFAULT_MODEL,
    ) {
        if (!this.apiKey) throw new Error('gemini_live provider needs GEMINI_API_KEY');
    }

    async connect(opts: ConnectOpts): Promise<TtsConnection> {
        const ai = new GoogleGenAI({ apiKey: this.apiKey });
        const t0 = Date.now();

        // Two-phase init: construct the connection wrapper FIRST (so the
        // session's onmessage callback can route into it), then await the
        // actual session connect. The wrapper is the routing target for
        // every Live frame, and the wrapper exposes the audio iterator
        // to the caller.
        let conn: GeminiLiveConnection;
        const session = await ai.live.connect({
            model: this.model,
            config: {
                responseModalities: [Modality.AUDIO],
                // Voice selection via speech_config — same field name as
                // the non-Live TTS endpoint.
                speechConfig: {
                    voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice } },
                },
            } as any,
            callbacks: {
                onopen: () => { /* no-op; resolution is awaited below */ },
                onmessage: (message: any) => { conn?.handleMessage(message); },
                onerror: (e: any) => {
                    // ErrorEvent (SDK type) has a .message; coerce to Error for our handler.
                    const err = e instanceof Error ? e : new Error(e?.message ?? String(e));
                    conn?.handleError(err);
                },
                onclose: (e: any) => { conn?.handleClose(e?.reason); },
            },
        });

        const setupMs = Date.now() - t0;
        conn = new GeminiLiveConnection(session, true, setupMs);
        return conn;
    }

    estimateCost(opts: { text: string; outputBytes: number; voice: string; model?: string }): CostEstimate {
        // PCM16 24kHz mono = 48,000 bytes/sec → divide for seconds.
        const audioSeconds = opts.outputBytes / 48000;
        const usd = audioSeconds * PRICE_PER_AUDIO_SECOND_OUTPUT_USD;
        return { usd, unit: 'audio_seconds', quantity: audioSeconds };
    }

    listVoices(): string[] { return VOICES; }
}
