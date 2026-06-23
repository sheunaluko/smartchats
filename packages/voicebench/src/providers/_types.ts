/**
 * TtsProvider / TtsConnection — the swappable contract.
 *
 * `connect()` is split from `stream()` so callers can speculatively warm
 * a connection in parallel with LLM token generation (the "while LLM is
 * generating the first 8 words, the TTS WebSocket is finishing its
 * handshake" pattern). For HTTP providers connect() is a no-op and
 * resolves immediately.
 *
 * Audio output is always PCM16, 24kHz, mono — same as openai_tts.ts —
 * batched to ~6400 bytes (≈133ms of audio) per yielded Buffer so cross-
 * provider measurements are comparable. Each provider's adapter is
 * responsible for re-batching if its native chunk size differs.
 */

export interface ConnectOpts {
    voice: string;
    /** Provider-specific TTS model id (e.g. 'gpt-4o-mini-tts'). */
    model?: string;
    /** Pre-yield batch size — providers re-batch to this. Default 6400. */
    targetBytes?: number;
    /**
     * Smaller threshold for the FIRST batch. Default = targetBytes (no
     * separate first-batch optimization). Some providers honor it; some
     * (like OpenAI) cannot meaningfully act on it — the batcher will yield
     * earlier but the underlying provider's first-byte timing is unchanged.
     */
    firstBatchBytes?: number;
}

export interface StreamOpts {
    text: string;
    speed?: number;
    /** Voice style directive — provider-specific syntax (gpt-4o-mini-tts `instructions`, xAI tags, Gemini natural-language directives). */
    instructions?: string;
    /** Fires once when first byte arrives from the provider. */
    onFirstByte?: (msFromStreamCall: number) => void;
    /** Fires per batch yielded downstream. */
    onBatchYield?: (e: BatchYieldEvent) => void;
}

export interface BatchYieldEvent {
    batchIndex: number;
    bytes: number;
    /** ms since the stream() call that produced this batch. */
    msFromStreamCall: number;
    /** Cumulative bytes received from the provider so far (NOT cumulative output bytes). */
    providerBytesCumulative: number;
}

export interface TtsConnection {
    /**
     * Stream PCM for the given text. Reuses the connection — call multiple
     * times if the provider supports it (WS-based ones); HTTP-based
     * adapters can re-open per call transparently.
     */
    stream(opts: StreamOpts): AsyncIterable<Buffer>;
    close(): Promise<void>;

    /** True if connect() opened a new network connection (vs reused a pool / no-op). */
    readonly is_cold: boolean;
    /** ms from provider.connect() resolution time. ~0 for HTTP / pooled. */
    readonly setup_ms: number;
}

export interface CostEstimate {
    usd: number;
    /** Provider's preferred billing unit. */
    unit: 'characters' | 'tokens' | 'audio_seconds' | 'bytes';
    /** Quantity in that unit. */
    quantity: number;
}

export interface TtsProvider {
    /** Stable identifier — used as the provider column in reports. */
    name: string;

    /**
     * Establish any persistent resources (WS handshake, auth, etc).
     * Free for HTTP providers — resolves immediately. The benchmark
     * measures connect() duration via the resulting connection's
     * `setup_ms` field.
     */
    connect(opts: ConnectOpts): Promise<TtsConnection>;

    /** Cost model. Should match the provider's billing as closely as we can. */
    estimateCost(opts: { text: string; outputBytes: number; voice: string; model?: string }): CostEstimate;

    /** Voices available for benchmarking. First entry is the default. */
    listVoices(): string[];
}
