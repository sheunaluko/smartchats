/**
 * LLM call factory — produces a cortex-compatible stream function on top of
 * SmartChatsBackend. Routes chat-only sends through `backend.llm.stream()`
 * and voice sends through `backend.llm.streamWithTTS()`, fixing the
 * pre-refactor behavior where chat mode hit the combined endpoint and
 * dropped the audio chunks on the floor.
 *
 * The returned function matches cortex's existing `{ stream, data }` contract
 * so it can be injected via `setStreamingLlmCallFn(...)` unchanged.
 */

'use client';

import type { LLMMessage } from 'smartchats-backend';
import { getBackend } from './backend';

// ─── Types matching the existing cortex call-fn signature ─────────

export interface CortexLlmCallArgs {
    model: string;
    input: LLMMessage[];
    max_tokens?: number;
    temperature?: number;
    stop?: string[];
    text_format?: {
        type: 'json_schema';
        name: string;
        strict: boolean;
        schema: Record<string, unknown>;
    };
    session_id?: string;
    signal?: AbortSignal;
}

export interface CortexLlmCallResult {
    stream: AsyncIterable<string>;    // text deltas only (cortex's existing contract)
    data: Promise<unknown>;           // final envelope w/ usage + billing
}

// ─── TTS queue late-binding ───────────────────────────────────────
//
// The caller is constructed before tivi's ttsQueue exists (tivi inits
// asynchronously — ONNX load, audio context, VAD). We use a module-level
// ref that app3 sets on tivi mount. The factory reads this per-call, so
// voice mode "turns on" automatically once tivi is ready.

interface TtsQueue {
    playExternalStream(chunks: AsyncIterable<Float32Array>, meta?: { text?: string }): void;
}

let _currentTtsQueue: TtsQueue | null = null;

/** Register tivi's ttsQueue (or null to unregister). Called by app3 when tivi mounts. */
export function setTtsQueueRef(queue: TtsQueue | null): void {
    _currentTtsQueue = queue;
}

// ─── Experiment params (/sail) ────────────────────────────────────
//
// When set (typically by /sail's ExperimentControls), each LLM+TTS call
// passes these through as request-body fields. Server-side opts into
// experiment behavior + emits server_timing events when experiment_id
// is present.

export interface ExperimentParams {
    /** Unique identifier for this experiment run — also session-tagged */
    experiment_id?: string;
    /** Server-side: TTS batch size in bytes (default 6400 = 133ms) */
    tts_target_bytes?: number;
    /** Server-side: first-batch size for fast chunk 0 (default = tts_target_bytes) */
    tts_first_batch_bytes?: number;
    /** Server-side: words required before first TTS fires (default 8) */
    first_chunk_word_threshold?: number;
    /** Server-side: TTS model override (default gpt-4o-mini-tts) */
    tts_model_id?: string;
    /** Server-side: TTS voice override (default alloy) */
    tts_voice?: string;
}

let _currentExperimentParams: ExperimentParams | null = null;

/** Set the active experiment params (or null to clear). Applies to all
 *  subsequent LLM+TTS calls until changed. /sail's ExperimentControls
 *  panel writes here; production app3 never touches it. */
export function setExperimentParams(params: ExperimentParams | null): void {
    _currentExperimentParams = params;
}

export function getExperimentParams(): ExperimentParams | null {
    return _currentExperimentParams;
}

// ─── Server-timing event callback ────────────────────────────────
//
// Same module-level-setter pattern as setTtsQueueRef. /sail wires
// useOrchestrator's onTtsServerTiming through here so server-emitted
// timing events become insights events.

type TtsServerTimingCallback = (event: any) => void;
let _ttsServerTimingCallback: TtsServerTimingCallback | null = null;

export function setTtsServerTimingCallback(cb: TtsServerTimingCallback | null): void {
    _ttsServerTimingCallback = cb;
}

// ─── Audio telemetry (iOS Safari crash diagnostics) ───────────────

let _cumulativeDecodedBytes = 0;
let _cumulativeDecodedChunks = 0;
let _activeIterableCount = 0;

export function getCombinedStreamAudioStats() {
    return {
        cumulativeDecodedBytes: _cumulativeDecodedBytes,
        cumulativeDecodedBytesMB: Math.round(_cumulativeDecodedBytes / 1024 / 1024 * 100) / 100,
        cumulativeDecodedChunks: _cumulativeDecodedChunks,
        activeIterableCount: _activeIterableCount,
    };
}

export interface BackendLlmCallerOptions {
    /** Getter for TTS voice (called per request — reflects dynamic settings). */
    getVoice?: () => string | undefined;
    /** Only route audio when this returns true AND the ttsQueue ref is set. */
    shouldPlayAudio?: () => boolean;
}

// ─── Helpers ──────────────────────────────────────────────────────

/** Push-based iterable bridging event-loop pushes to async iteration. */
class PushAsyncIterable<T> {
    private queue: T[] = [];
    private resolve: (() => void) | null = null;
    private done = false;

    push(value: T) {
        this.queue.push(value);
        if (this.resolve) {
            this.resolve();
            this.resolve = null;
        }
    }

    close() {
        this.done = true;
        if (this.resolve) {
            this.resolve();
            this.resolve = null;
        }
    }

    [Symbol.asyncIterator](): AsyncIterator<T> {
        return {
            next: async () => {
                while (this.queue.length === 0 && !this.done) {
                    await new Promise<void>((r) => { this.resolve = r; });
                }
                if (this.queue.length > 0) return { value: this.queue.shift()!, done: false };
                return { value: undefined as never, done: true };
            },
        };
    }
}

/** PCM16 LE (ArrayBuffer) → Float32Array for Web Audio. */
function pcmToFloat32(pcm: ArrayBuffer): Float32Array {
    const numSamples = pcm.byteLength / 2;
    const view = new DataView(pcm);
    const out = new Float32Array(numSamples);
    for (let i = 0; i < numSamples; i++) {
        out[i] = view.getInt16(i * 2, true) / 32768;
    }
    return out;
}

/** Translate cortex's text_format envelope back to the interface's schema pair. */
function extractSchema(args: CortexLlmCallArgs): { schema?: object; schema_name?: string } {
    if (args.text_format?.type === 'json_schema') {
        return { schema: args.text_format.schema, schema_name: args.text_format.name };
    }
    return {};
}

/**
 * Non-streaming LLM call — drains `backend.llm.stream(...)` and returns the
 * aggregated `data` envelope ({ output_text, usage, model, provider, ... }).
 *
 * Required for child agent processes spawned via ProcessManager: they run
 * SynchronousRunnerV2 which needs Cortex.llmCallFn for structured + plain
 * completions. The parent uses the streaming runner for its own turns;
 * llmCallFn (this) is only exercised by children + structured-completion
 * paths inside cortex.ts.
 */
export async function nonStreamingBackendLlmCall(args: {
    model: string;
    input: any[];
    schema?: any;
    schema_name?: string;
    max_tokens?: number;
    temperature?: number;
    session_id?: string;
    signal?: AbortSignal;
}): Promise<any> {
    const schemaArgs = args.schema && args.schema_name
        ? { schema: args.schema, schema_name: args.schema_name }
        : {};
    const { stream, done } = await getBackend().llm.stream({
        model: args.model,
        input: args.input,
        max_tokens: args.max_tokens,
        temperature: args.temperature,
        session_id: args.session_id,
        signal: args.signal,
        ...schemaArgs,
    });
    // Drain the stream — `done` is only settled inside the stream's async
    // generator (see createLLMStreamResult in smartchats-backend). Awaiting
    // `done` without iterating would hang forever.
    for await (const _chunk of stream) { /* discard */ }
    return await done;
}

// ─── Factory ──────────────────────────────────────────────────────

export function createBackendLlmCaller(opts: BackendLlmCallerOptions = {}) {
    return async function call(args: CortexLlmCallArgs): Promise<CortexLlmCallResult> {
        // Runners warm the pipeline by calling this with {warmup: true, model: '', input: []}.
        // Route it to the adapter's dedicated warmup() instead of issuing a malformed stream request.
        if ((args as any).warmup) {
            await getBackend().llm.warmup?.();
            return { stream: (async function*() {})(), data: Promise.resolve(undefined) };
        }

        const queue = _currentTtsQueue;
        const wantAudio = !!queue && (!opts.shouldPlayAudio || opts.shouldPlayAudio());

        const baseArgs = {
            model: args.model,
            input: args.input,
            max_tokens: args.max_tokens,
            temperature: args.temperature,
            session_id: args.session_id,
            signal: args.signal,
            ...extractSchema(args),
        };

        if (!wantAudio) {
            // Chat mode: text-only stream. No audio requested, no bandwidth wasted.
            const { stream, done } = await getBackend().llm.stream(baseArgs);
            return {
                stream,
                data: done.then((result) => {
                    if (result.billing && typeof window !== 'undefined') {
                        window.dispatchEvent(new CustomEvent('smartchats:billing_update', { detail: result.billing }));
                    }
                    return result;
                }),
            };
        }

        // Voice mode: combined stream. Text deltas → caller; audio events → ttsQueue.
        const exp = _currentExperimentParams;
        const voice = exp?.tts_voice ?? opts.getVoice?.() ?? 'nova';
        const ttsExtras: Record<string, any> = { voice };
        if (exp) {
            // Per-call experiment params — server reads from request body and
            // overrides its hardcoded constants when present. experiment_id
            // triggers server-timing emission.
            if (exp.experiment_id) ttsExtras.experiment_id = exp.experiment_id;
            if (exp.tts_target_bytes !== undefined) ttsExtras.tts_target_bytes = exp.tts_target_bytes;
            if (exp.tts_first_batch_bytes !== undefined) ttsExtras.tts_first_batch_bytes = exp.tts_first_batch_bytes;
            if (exp.first_chunk_word_threshold !== undefined) ttsExtras.first_chunk_word_threshold = exp.first_chunk_word_threshold;
            if (exp.tts_model_id) ttsExtras.tts_model_id = exp.tts_model_id;
        }
        const { stream: eventStream, done } = await getBackend().llm.streamWithTTS({ ...baseArgs, ...ttsExtras } as any);

        const activeSentences = new Map<number, PushAsyncIterable<Float32Array>>();
        const ttsQueue = queue!; // non-null guaranteed by wantAudio check above
        const textIterable = new PushAsyncIterable<string>();

        // Consume the typed event stream internally, splitting into text + audio lanes.
        (async () => {
            try {
                for await (const event of eventStream) {
                    switch (event.kind) {
                        case 'text':
                            textIterable.push(event.delta);
                            break;
                        case 'text_end':
                            textIterable.close();
                            break;
                        case 'audio_start': {
                            const sentenceIter = new PushAsyncIterable<Float32Array>();
                            activeSentences.set(event.sentence, sentenceIter);
                            _activeIterableCount++;
                            ttsQueue.playExternalStream(sentenceIter, { text: event.text });
                            break;
                        }
                        case 'audio': {
                            const sentenceIter = activeSentences.get(event.sentence);
                            if (sentenceIter) {
                                const float32 = pcmToFloat32(event.pcm);
                                _cumulativeDecodedBytes += float32.byteLength;
                                _cumulativeDecodedChunks++;
                                sentenceIter.push(float32);
                            }
                            break;
                        }
                        case 'audio_end': {
                            const sentenceIter = activeSentences.get(event.sentence);
                            if (sentenceIter) {
                                sentenceIter.close();
                                activeSentences.delete(event.sentence);
                                _activeIterableCount = Math.max(0, _activeIterableCount - 1);
                            }
                            break;
                        }
                        case 'server_timing': {
                            // Fire-and-forget: route to the active callback (set by /sail
                            // via useOrchestrator). Callback is responsible for emitting
                            // the insights event. No-op in production where the callback
                            // is unset.
                            try { _ttsServerTimingCallback?.(event); } catch { /* swallow */ }
                            break;
                        }
                    }
                }
            } catch (err) {
                _activeIterableCount = Math.max(0, _activeIterableCount - activeSentences.size);
                for (const s of activeSentences.values()) s.close();
                activeSentences.clear();
                textIterable.close();
                throw err;
            }
        })();

        return {
            stream: textIterable,
            data: done.then((info) => {
                if (info.billing && typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('smartchats:billing_update', { detail: info.billing }));
                }
                return info.llm;
            }),
        };
    };
}
