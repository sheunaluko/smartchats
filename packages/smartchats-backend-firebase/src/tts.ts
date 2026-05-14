import type {
    TTSAPI,
    TTSArgs,
    TTSStreamResult,
    TTSAudioChunk,
    TTSDoneInfo,
    BillingEnvelope,
} from 'smartchats-backend';
import { BackendError } from 'smartchats-backend';
import type { FirebaseBackendOptions } from './backend.js';
import { readNdjson, base64ToPcmBuffer } from 'smartchats-backend';

async function authHeaders(opts: FirebaseBackendOptions): Promise<Record<string, string>> {
    const token = await opts.getIdToken();
    if (!token) throw new BackendError('invalid_request', 'No auth token — user must be signed in for TTS calls');
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };
}

export function createTTSAPI(opts: FirebaseBackendOptions): TTSAPI {
    const url = `${opts.httpStreamBaseUrl}/ttsStreamHttp`;

    return {
        async stream(args: TTSArgs): Promise<TTSStreamResult> {
            const body = {
                text: args.text,
                voice: args.voice,
                ...(args.speed !== undefined && { speed: args.speed }),
                ...(args.instructions && { instructions: args.instructions }),
                ...(args.session_id && { session_id: args.session_id }),
            };

            let response: Response;
            try {
                response = await fetch(url, {
                    method: 'POST',
                    headers: await authHeaders(opts),
                    body: JSON.stringify(body),
                    signal: args.signal,
                });
            } catch (err) {
                if ((err as { name?: string }).name === 'AbortError') {
                    throw new BackendError('aborted', 'TTS stream aborted', false, err);
                }
                throw new BackendError('network_error', `TTS stream network error: ${(err as Error).message}`, true, err);
            }

            if (!response.ok) {
                let msg = `TTS stream failed: ${response.status}`;
                try {
                    const body = await response.json();
                    if (body.error) msg = body.error;
                } catch { /* ignore */ }
                throw new BackendError(
                    response.status === 402 ? 'insufficient_credits' : response.status >= 500 ? 'server_error' : 'provider_error',
                    msg,
                    response.status >= 500,
                );
            }

            const startTs = Date.now();

            type Line =
                | { t: 'audio_start'; s: number; text?: string; ms?: number }
                | { t: 'audio'; s: number; c: number; b64: string }
                | { t: 'audio_end'; s: number; ms?: number }
                | { t: 'done'; data?: { tts?: { total_chunks?: number; latency_ms?: number }; billing?: BillingEnvelope; latency_ms?: number } }
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
                                yield {
                                    pcm: base64ToPcmBuffer(line.b64),
                                    index: line.c,
                                };
                            } else if (line.t === 'done' && !settled) {
                                settled = true;
                                const data = line.data ?? {};
                                doneResolve({
                                    latency_ms: data.latency_ms ?? data.tts?.latency_ms ?? (Date.now() - startTs),
                                    total_chunks: data.tts?.total_chunks ?? chunkCount,
                                    billing: data.billing,
                                });
                            } else if (line.t === 'error' && !settled) {
                                settled = true;
                                doneReject(new BackendError('provider_error', line.error));
                            }
                            // audio_start and audio_end are implicit — TTS stream has exactly one sentence
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
            // Best-effort: hit the endpoint with `warmup:true` so the server short-circuits
            // before any work but keeps the container hot. Errors are swallowed.
            try {
                const response = await fetch(url, {
                    method: 'POST',
                    headers: await authHeaders(opts),
                    body: JSON.stringify({ warmup: true }),
                });
                // drain so the connection returns to the pool cleanly
                await response.text().catch(() => undefined);
            } catch {
                // Intentional swallow — warmup is best-effort
            }
        },
    };
}
