/**
 * NDJSON-stream → typed-result adapters.
 *
 * Every HTTP-based LLM adapter (Firebase, Local, and any future one) consumes
 * the same NDJSON wire format and translates it into the `LLMStreamResult` /
 * `LLMTTSStreamResult` shapes defined in `types.ts`. These factories do that
 * translation exactly once.
 *
 * Each factory takes a live fetch `Response` (already validated as 2xx) and
 * returns `{ stream, done }`. The stream yields user-facing events; the done
 * promise settles with the aggregated result or rejects with a BackendError.
 *
 * What's NOT here: auth headers, URL construction, fetch itself. Those are
 * platform-specific and stay in each adapter.
 */

import {
    BackendError,
    type LLMCallArgs,
    type LLMCallResult,
    type LLMStreamResult,
    type LLMTTSDoneInfo,
    type LLMTTSEvent,
    type LLMTTSExtras,
    type LLMTTSStreamResult,
    type LLMUsage,
    type BillingEnvelope,
} from '../types.js';
import { readNdjson, base64ToPcmBuffer } from './ndjson.js';

type LLMStreamLine =
    | { t: 'delta'; d: string }
    | {
          t: 'done';
          data: {
              output_text: string;
              usage: LLMUsage;
              model: string;
              provider: string;
              finish_reason: string;
              latency_ms: number;
              billing?: BillingEnvelope;
          };
      }
    | { t: 'error'; error: string };

/**
 * Wrap a text-only LLM NDJSON stream response as an `LLMStreamResult`.
 * Wire: `{t:'delta',d}` → yielded string; `{t:'done',data}` → resolves the
 * done promise; `{t:'error',error}` or end-of-stream-without-done → rejects.
 */
export function createLLMStreamResult(response: Response): LLMStreamResult {
    let doneResolve!: (v: LLMCallResult) => void;
    let doneReject!: (e: unknown) => void;
    let settled = false;
    const done = new Promise<LLMCallResult>((resolve, reject) => {
        doneResolve = resolve;
        doneReject = reject;
    });

    const stream: AsyncIterable<string> = {
        async *[Symbol.asyncIterator]() {
            try {
                for await (const line of readNdjson<LLMStreamLine>(response)) {
                    if (line.t === 'delta' && line.d) {
                        yield line.d;
                    } else if (line.t === 'done' && !settled) {
                        settled = true;
                        doneResolve({ ...line.data });
                    } else if (line.t === 'error' && !settled) {
                        settled = true;
                        doneReject(new BackendError('provider_error', line.error));
                    }
                }
                if (!settled) {
                    settled = true;
                    doneReject(new BackendError('server_error', 'stream ended before `done` frame'));
                }
            } catch (err) {
                if (!settled) {
                    settled = true;
                    doneReject(err);
                }
                throw err;
            }
        },
    };

    return { stream, done };
}

type LLMTTSLine =
    | { t: 'text'; d: string }
    | { t: 'audio_start'; s: number; text?: string }
    | { t: 'audio'; s: number; c: number; b64: string }
    | { t: 'audio_end'; s: number }
    | {
          // Server-side timing event (only emitted when experiment_id is set).
          t: 'server_timing';
          phase: 'tts_request_start' | 'tts_first_byte' | 'tts_batch_yield' | 'tts_request_complete';
          s: number;
          ts: number;
          batch?: number;
          bytes?: number;
          openai_bytes_total?: number;
          total_batches?: number;
          ms_since_first_byte?: number;
      }
    | { t: 'llm_done'; data?: LLMCallResult }
    | {
          t: 'done';
          data: {
              llm?: LLMCallResult;
              output_text?: string;
              usage?: LLMUsage;
              model?: string;
              provider?: string;
              finish_reason?: string;
              tts?: { total_chunks?: number; total_characters?: number; latency_ms?: number };
              latency_ms?: number;
              billing?: BillingEnvelope;
          };
      }
    | { t: 'error'; error: string };

/**
 * Wrap a combined LLM+TTS NDJSON stream response as an `LLMTTSStreamResult`.
 *
 * Event mapping:
 *   text         → { kind:'text', delta }
 *   audio_start  → { kind:'audio_start', sentence, text }
 *   audio        → { kind:'audio', pcm, sentence, chunk }
 *   audio_end    → { kind:'audio_end', sentence }
 *   llm_done     → { kind:'text_end' } + capture llm_result for fallback
 *   done         → resolves the done promise (prefers data.llm, falls back to
 *                  captured llm_result, then to data fields)
 *   error        → rejects with BackendError
 *
 * `originalArgs` is used only to supply defaults when the server omits fields
 * in the `done` frame (e.g. `data.model`, `data.provider`). This mirrors the
 * lenient behavior the client has always had so older servers stay compatible.
 */
export function createLLMTTSStreamResult(
    response: Response,
    originalArgs: LLMCallArgs & LLMTTSExtras,
): LLMTTSStreamResult {
    const startTs = Date.now();
    let doneResolve!: (v: LLMTTSDoneInfo) => void;
    let doneReject!: (e: unknown) => void;
    let settled = false;
    const done = new Promise<LLMTTSDoneInfo>((resolve, reject) => {
        doneResolve = resolve;
        doneReject = reject;
    });

    let llmResult: LLMCallResult | undefined;
    let audioChunkCount = 0;

    const stream: AsyncIterable<LLMTTSEvent> = {
        async *[Symbol.asyncIterator]() {
            try {
                for await (const line of readNdjson<LLMTTSLine>(response)) {
                    switch (line.t) {
                        case 'text':
                            if (line.d) yield { kind: 'text', delta: line.d };
                            break;
                        case 'audio_start':
                            yield { kind: 'audio_start', sentence: line.s, text: line.text };
                            break;
                        case 'audio':
                            audioChunkCount++;
                            yield {
                                kind: 'audio',
                                pcm: base64ToPcmBuffer(line.b64),
                                sentence: line.s,
                                chunk: line.c,
                            };
                            break;
                        case 'audio_end':
                            yield { kind: 'audio_end', sentence: line.s };
                            break;
                        case 'server_timing':
                            yield {
                                kind: 'server_timing',
                                phase: line.phase,
                                sentence: line.s,
                                ts: line.ts,
                                ...(line.batch !== undefined && { batch: line.batch }),
                                ...(line.bytes !== undefined && { bytes: line.bytes }),
                                ...(line.openai_bytes_total !== undefined && { openai_bytes_total: line.openai_bytes_total }),
                                ...(line.total_batches !== undefined && { total_batches: line.total_batches }),
                                ...(line.ms_since_first_byte !== undefined && { ms_since_first_byte: line.ms_since_first_byte }),
                            };
                            break;
                        case 'llm_done':
                            if (line.data) llmResult = line.data;
                            yield { kind: 'text_end' };
                            break;
                        case 'done': {
                            if (settled) break;
                            settled = true;
                            const data = line.data ?? {};
                            const llm: LLMCallResult =
                                data.llm ??
                                llmResult ?? {
                                    output_text: data.output_text ?? '',
                                    usage: data.usage ?? { input_tokens: 0, output_tokens: 0 },
                                    model: data.model ?? originalArgs.model,
                                    provider: data.provider ?? 'unknown',
                                    finish_reason: data.finish_reason ?? 'stop',
                                    latency_ms: data.latency_ms ?? Date.now() - startTs,
                                    billing: data.billing,
                                };
                            doneResolve({
                                llm,
                                tts: {
                                    total_chunks: data.tts?.total_chunks ?? audioChunkCount,
                                    latency_ms: data.tts?.latency_ms ?? 0,
                                },
                                latency_ms: data.latency_ms ?? Date.now() - startTs,
                                billing: data.billing,
                            });
                            break;
                        }
                        case 'error':
                            if (!settled) {
                                settled = true;
                                doneReject(new BackendError('provider_error', line.error));
                            }
                            break;
                    }
                }
                if (!settled) {
                    settled = true;
                    doneReject(new BackendError('server_error', 'stream ended before `done` frame'));
                }
            } catch (err) {
                if (!settled) {
                    settled = true;
                    doneReject(err);
                }
                throw err;
            }
        },
    };

    return { stream, done };
}
