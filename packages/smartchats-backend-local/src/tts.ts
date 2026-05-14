import type { TTSAPI, TTSArgs, TTSStreamResult, TTSAudioChunk, TTSDoneInfo } from 'smartchats-backend';
import { BackendError } from 'smartchats-backend';
import type { LocalBackendOptions } from './backend.js';
import { authHeaders } from './http.js';
import { readNdjson, base64ToPcmBuffer } from 'smartchats-backend';

export function createTTSAPI(opts: LocalBackendOptions): TTSAPI {
    const url = `${opts.baseUrl}/tts/stream`;

    return {
        async stream(args: TTSArgs): Promise<TTSStreamResult> {
            let response: Response;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders(opts) },
                    body: JSON.stringify({
                        text: args.text,
                        voice: args.voice,
                        ...(args.speed !== undefined && { speed: args.speed }),
                        ...(args.instructions && { instructions: args.instructions }),
                        ...(args.session_id && { session_id: args.session_id }),
                    }),
                    signal: args.signal,
                });
            } catch (err) {
                if ((err as { name?: string }).name === 'AbortError') {
                    throw new BackendError('aborted', 'TTS stream aborted', false, err);
                }
                throw new BackendError('network_error', `TTS stream network error: ${(err as Error).message}`, true, err);
            }

            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new BackendError(
                    response.status >= 500 ? 'server_error' : 'provider_error',
                    `TTS stream failed: ${response.status} ${text}`,
                    response.status >= 500,
                );
            }

            const startTs = Date.now();

            type Line =
                | { t: 'audio_start'; s: number; text?: string; ms?: number }
                | { t: 'audio'; s: number; c: number; b64: string }
                | { t: 'audio_end'; s: number; ms?: number }
                | { t: 'done'; data?: { tts?: { total_chunks?: number; latency_ms?: number }; latency_ms?: number } }
                | { t: 'error'; error: string };

            let doneResolve!: (v: TTSDoneInfo) => void;
            let doneReject!: (e: unknown) => void;
            let settled = false;
            const done = new Promise<TTSDoneInfo>((resolve, reject) => {
                doneResolve = resolve;
                doneReject = reject;
            });

            let chunkCount = 0;

            const stream: AsyncIterable<TTSAudioChunk> = {
                async *[Symbol.asyncIterator]() {
                    try {
                        for await (const line of readNdjson<Line>(response)) {
                            if (line.t === 'audio' && line.b64) {
                                chunkCount++;
                                yield { pcm: base64ToPcmBuffer(line.b64), index: line.c };
                            } else if (line.t === 'done' && !settled) {
                                settled = true;
                                const data = line.data ?? {};
                                doneResolve({
                                    latency_ms: data.latency_ms ?? data.tts?.latency_ms ?? (Date.now() - startTs),
                                    total_chunks: data.tts?.total_chunks ?? chunkCount,
                                });
                            } else if (line.t === 'error' && !settled) {
                                settled = true;
                                doneReject(new BackendError('provider_error', line.error));
                            }
                        }
                        if (!settled) {
                            settled = true;
                            doneReject(new BackendError('server_error', 'TTS stream ended before `done` frame'));
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
        },

        async warmup(): Promise<void> {
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', ...authHeaders(opts) },
                    body: JSON.stringify({ warmup: true }),
                });
                await response.text().catch(() => undefined);
            } catch { /* best-effort */ }
        },
    };
}
