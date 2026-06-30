/**
 * Server-side TTS adapter interface.
 *
 * Each provider (openai, azure, …) exports an instance of this interface.
 * The `/llm/streamWithTTS` route resolves an adapter by name + invokes
 * `stream()` to get PCM chunks, which it frames into the existing NDJSON
 * wire format (no protocol change — the wire stays PCM16 24kHz mono).
 *
 * Intentionally lighter than the voicebench TtsProvider/TtsConnection split:
 *   - no benchmark timing fields (setup_ms, is_cold)
 *   - no separate connect() phase — production warms via the route handler
 *     calling `warmup()` at startup if needed
 *
 * If a future provider needs richer setup (e.g. WebSocket keepalive), add a
 * `warmup()` and/or `connect()` hook here. For now, all production adapters
 * are stateless from the route's perspective.
 */

export interface ServerTtsAdapter {
    /** Provider id — matches the `tts_provider` field in /llm/streamWithTTS requests. */
    readonly name: string;

    /**
     * Yield PCM16 24kHz mono buffers for the given text.
     * The caller (route handler) batches + frames them into the NDJSON wire.
     */
    stream(opts: TtsStreamOpts): AsyncIterable<Buffer>;

    /** Static voice catalog — currently sufficient. Runtime catalog from the
     *  provider API is a future extension. */
    listVoices(): string[];

    /** Cost estimate in USD for accounting purposes. */
    estimateCost(opts: TtsCostOpts): TtsCostEstimate;
}

export interface TtsStreamOpts {
    text: string;
    voice: string;
    speed?: number;
    /** Optional style/instructions — only OpenAI's gpt-4o-mini-tts honors this. */
    instructions?: string;
    /** Optional adapter-side timing hook. Adapters with a transport that
     *  exposes batch-level events (e.g. OpenAI's HTTP stream first byte
     *  + per-batch yield) forward those here as generic TtsTimingEvents
     *  for streamLlmTtsToNdjson to re-emit as tts_first_byte / tts_batch_yield
     *  server_timing frames. Adapters without such a surface (e.g. Azure's
     *  Speech SDK, which only exposes synthesisCompleted) leave this absent —
     *  the orchestrator just won't emit those phases for those providers. */
    onTiming?: (event: import('../streaming/types.js').TtsTimingEvent) => void;
}

export interface TtsCostOpts {
    text: string;
    /** Output PCM bytes — used by token-priced providers (e.g. OpenAI). */
    outputBytes: number;
    voice: string;
}

export interface TtsCostEstimate {
    usd: number;
    /** What we billed against — for telemetry. */
    unit: 'tokens' | 'characters' | 'bytes';
    quantity: number;
}
