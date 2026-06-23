/**
 * xAI WebSocket TTS adapter — wss://api.x.ai/v1/tts.
 *
 * Per the docs:
 *   - Config via query params at connect time (voice, language, codec,
 *     sample_rate, optimize_streaming_latency, speed, ...)
 *   - Client → Server: `text.delta` (text chunk), `text.done` (end of utterance)
 *   - Server → Client: `audio.delta` (base64 audio), `audio.done`, `error`
 *   - Connection persists across multiple utterances
 *
 * This adapter persists ONE WebSocket per `provider.connect()` call and
 * reuses it for every `stream()` invocation. That maps cleanly to the
 * speculative-connect pattern: fire `provider.connect(...)` at the top
 * of the Cloud Function handler so the WS handshake completes in
 * parallel with the LLM producing its first 8 words; by the time the
 * splitter fires, sending `text.delta` is a no-handshake operation.
 *
 * Critically, since the connection multiplexes utterances, the adapter
 * tracks "in-flight" state — only one stream() can be active at a time
 * per connection. Concurrent stream() calls on the same connection
 * would interleave on the wire and confuse the audio.delta routing.
 * Document and enforce.
 *
 * Auth: XAI_API_KEY env var (Bearer header). API key per Authentication
 * section of the REST docs.
 *
 * Re-batches incoming audio.delta chunks to ~6400 bytes for cross-
 * provider parity.
 *
 * KNOWN UNKNOWNS at the time of writing:
 *   - Exact `text.delta` payload field name ("text" vs "delta") not in
 *     the public summary; assumed "text". Validate against live API.
 *   - Whether audio.delta is `audio` (base64 string) or `data`; assumed
 *     "audio".
 *   - Whether config is purely query-string or also requires a startup
 *     JSON frame; assumed pure query-string per docs.
 * If first benchmark trial fails, those are the things to inspect.
 */

import WebSocket from 'ws';

import type {
    ConnectOpts, CostEstimate, StreamOpts,
    TtsConnection, TtsProvider,
} from './_types.js';

// xAI doesn't publish gpt-4o-mini-tts-equivalent per-character pricing
// at time of writing. Placeholder constant — calibrate after first
// billing cycle. Listed at the top so the imprecision is visible.
const PRICE_PER_M_CHARS = 30.0;
const DEFAULT_TARGET_BYTES = 6400;
const DEFAULT_VOICE = 'eve';
const VOICES = ['eve', 'ara', 'leo', 'rex', 'sal'];

interface XaiConnectionConfig {
    apiKey: string;
    voice: string;
    language: string;
    codec: string;
    sampleRate: number;
    optimizeStreamingLatency: 0 | 1;
    speed: number;
    targetBytes: number;
    firstBatchBytes: number;
}

class XaiWsConnection implements TtsConnection {
    readonly is_cold: boolean;
    readonly setup_ms: number;
    private ws: WebSocket;
    private busy = false;
    /** Listener stack for incoming server frames — one entry per in-flight stream(). */
    private listeners: Array<(frame: Record<string, unknown>) => void> = [];
    private closeError: Error | null = null;

    constructor(ws: WebSocket, isCold: boolean, setupMs: number, private readonly cfg: XaiConnectionConfig) {
        this.is_cold = isCold;
        this.setup_ms = setupMs;
        this.ws = ws;
        ws.on('message', (data) => {
            let frame: Record<string, unknown>;
            try { frame = JSON.parse(data.toString()); }
            catch { return; }
            // FIFO listener invocation — should only ever be one in-flight
            // because of the busy guard, but this keeps it safe if usage
            // ever evolves to allow concurrent multiplexed streams.
            const cb = this.listeners[0];
            if (cb) cb(frame);
        });
        ws.on('close', (code, reason) => {
            this.closeError = new Error(`xAI WS closed (code=${code}): ${reason?.toString() ?? ''}`);
            // Wake any in-flight stream() so it can fail cleanly.
            for (const cb of this.listeners) cb({ type: '__closed' });
        });
        ws.on('error', (err) => {
            this.closeError = err;
            for (const cb of this.listeners) cb({ type: '__closed' });
        });
    }

    async *stream(streamOpts: StreamOpts): AsyncIterable<Buffer> {
        if (this.busy) throw new Error('xAI WS adapter: concurrent stream() not supported on the same connection');
        if (this.closeError) throw this.closeError;
        this.busy = true;
        const t0 = Date.now();
        const targetBytes = this.cfg.targetBytes;
        const firstBatchBytes = this.cfg.firstBatchBytes;

        // Queue of audio chunks pulled from incoming frames.
        const queue: { value: Buffer | null; err?: Error }[] = [];
        let resolveNext: ((v: { value: Buffer | null; err?: Error }) => void) | null = null;
        const push = (item: { value: Buffer | null; err?: Error }) => {
            if (resolveNext) { resolveNext(item); resolveNext = null; }
            else queue.push(item);
        };

        let firstByteReported = false;
        const listener = (frame: Record<string, unknown>) => {
            const type = String(frame.type ?? '');
            if (type === 'audio.delta') {
                // Assume base64 audio field is `audio` or `data` — try both.
                const b64 = (frame.audio ?? frame.data ?? '') as string;
                if (!b64) return;
                const chunk = Buffer.from(b64, 'base64');
                if (!firstByteReported) {
                    firstByteReported = true;
                    streamOpts.onFirstByte?.(Date.now() - t0);
                }
                push({ value: chunk });
            } else if (type === 'audio.done') {
                push({ value: null });
            } else if (type === 'error') {
                push({ value: null, err: new Error(`xAI server error: ${frame.message ?? JSON.stringify(frame)}`) });
            } else if (type === '__closed') {
                push({ value: null, err: this.closeError ?? new Error('connection closed mid-stream') });
            }
        };
        this.listeners.push(listener);

        try {
            // Send text + done. xAI accepts incremental deltas but for
            // benchmark parity we send the full utterance as one delta.
            this.ws.send(JSON.stringify({ type: 'text.delta', text: streamOpts.text }));
            this.ws.send(JSON.stringify({ type: 'text.done' }));

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
                    // Buffer.from forces Buffer<ArrayBuffer> typing under
                    // TS 5.4 strictness (vs subarray returning ArrayBufferLike).
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
            this.listeners.shift();
            this.busy = false;
        }
    }

    async close(): Promise<void> {
        return new Promise((res) => {
            if (this.ws.readyState === WebSocket.CLOSED) return res();
            this.ws.once('close', () => res());
            this.ws.close();
        });
    }
}

export class XaiWsTtsProvider implements TtsProvider {
    readonly name = 'xai_ws';
    constructor(
        private readonly apiKey: string = process.env['XAI_API_KEY'] ?? '',
    ) {
        if (!this.apiKey) throw new Error('xAI WS provider needs XAI_API_KEY');
    }

    async connect(opts: ConnectOpts): Promise<TtsConnection> {
        const cfg: XaiConnectionConfig = {
            apiKey: this.apiKey,
            voice: opts.voice || DEFAULT_VOICE,
            language: 'en',
            codec: 'pcm',
            sampleRate: 24000,
            optimizeStreamingLatency: 1,
            speed: 1.0,
            targetBytes: opts.targetBytes ?? DEFAULT_TARGET_BYTES,
            firstBatchBytes: opts.firstBatchBytes ?? (opts.targetBytes ?? DEFAULT_TARGET_BYTES),
        };
        const query = new URLSearchParams({
            voice: cfg.voice,
            language: cfg.language,
            codec: cfg.codec,
            sample_rate: String(cfg.sampleRate),
            optimize_streaming_latency: String(cfg.optimizeStreamingLatency),
            speed: String(cfg.speed),
        });
        const url = `wss://api.x.ai/v1/tts?${query.toString()}`;
        const t0 = Date.now();
        const ws = new WebSocket(url, { headers: { Authorization: `Bearer ${cfg.apiKey}` } });
        await new Promise<void>((res, rej) => {
            const onOpen = () => { ws.off('error', onErr); res(); };
            const onErr = (err: Error) => { ws.off('open', onOpen); rej(err); };
            ws.once('open', onOpen);
            ws.once('error', onErr);
        });
        return new XaiWsConnection(ws, true, Date.now() - t0, cfg);
    }

    estimateCost(opts: { text: string; outputBytes: number; voice: string; model?: string }): CostEstimate {
        const chars = opts.text.length;
        const usd = (chars / 1_000_000) * PRICE_PER_M_CHARS;
        return { usd, unit: 'characters', quantity: chars };
    }

    listVoices(): string[] { return VOICES; }
}
