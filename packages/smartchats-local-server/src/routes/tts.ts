/**
 * POST /tts/stream — NDJSON streaming TTS.
 *
 * Provider-aware as of 2026-06-27: request body may set `tts_provider`
 * (defaults to DEFAULT_TTS_PROVIDER). Adapter is resolved from the
 * registry in tts_providers/index.ts; same wire format regardless of
 * provider.
 *
 * Wire protocol:
 *   {"t":"audio_start","s":0,"text":"...","ms":N}
 *   {"t":"audio","s":0,"c":N,"b64":"<base64 pcm16le>"}
 *   {"t":"audio_end","s":0,"ms":N}
 *   {"t":"done","data":{"tts":{"total_chunks":N,"latency_ms":N,"provider":"azure"}}}
 *   {"t":"error","error":"..."}
 *
 * PCM output is PCM16 24kHz mono — same shape across all providers.
 */

import type { Router, Request, Response } from 'express';
import express from 'express';
import {
    beginNdjsonStream,
    writeNdjsonLine as writeLine,
} from 'llm-service';
import type { LLMProvider } from 'smartchats-backend';
import type { ServerConfig } from '../config.js';
import { ttsConfigFromServerConfig } from '../config.js';
import { writeUsageRecord } from '../usage_writer.js';
import { log } from '../logger.js';
import {
    resolveAdapter as resolveTtsAdapter,
    DEFAULT_TTS_PROVIDER,
} from 'llm-service';

const routeLog = log.withTag('tts');

const MAX_TEXT_LENGTH = 4096;

export function ttsRoutes(config: ServerConfig): Router {
    const r = express.Router();

    r.post('/stream', async (req: Request, res: Response) => {
        const { text, voice, speed, instructions, session_id, warmup, tts_provider } = (req.body ?? {}) as {
            text?: string;
            voice?: string;
            speed?: number;
            instructions?: string;
            session_id?: string;
            warmup?: boolean;
            tts_provider?: string;
        };

        if (warmup) return res.json({ success: true, warmup: true });

        if (!text || typeof text !== 'string') {
            return res.status(400).json({ error: 'text (string) is required' });
        }
        if (text.length > MAX_TEXT_LENGTH) {
            return res.status(400).json({ error: `text exceeds ${MAX_TEXT_LENGTH} chars` });
        }
        if (!voice || typeof voice !== 'string') {
            return res.status(400).json({ error: 'voice (string) is required' });
        }

        const adapter = resolveTtsAdapter(ttsConfigFromServerConfig(config), tts_provider);
        if (!adapter) {
            return res.status(400).json({
                error: `no TTS adapter available for "${tts_provider ?? DEFAULT_TTS_PROVIDER}" — check config + provider keys`,
            });
        }

        beginNdjsonStream(res);

        const startMs = Date.now();
        let chunkIdx = 0;
        let totalPcmBytes = 0;

        try {
            writeLine(res, { t: 'audio_start', s: 0, text: text.slice(0, 80), ms: Date.now() - startMs });

            for await (const pcm of adapter.stream({
                text,
                voice,
                speed: speed ?? 1.0,
                ...(instructions ? { instructions } : {}),
            })) {
                totalPcmBytes += pcm.length;
                writeLine(res, { t: 'audio', s: 0, c: chunkIdx++, b64: pcm.toString('base64') });
            }

            writeLine(res, { t: 'audio_end', s: 0, ms: Date.now() - startMs });
        } catch (err) {
            routeLog.error(`${adapter.name} TTS error: ${(err as Error).message}`);
            writeLine(res, { t: 'error', error: (err as Error).message });
            res.end();
            return;
        }

        const latencyMs = Date.now() - startMs;
        const estimate = adapter.estimateCost({ text, outputBytes: totalPcmBytes, voice });

        await writeUsageRecord({
            model: `${adapter.name}:${voice}`,
            provider: adapter.name as LLMProvider,
            inputTokens: estimate.unit === 'tokens' ? estimate.quantity : 0,
            outputTokens: Math.floor(totalPcmBytes / 2),
            costUsd: estimate.usd,
            sessionId: session_id ?? null,
            requestType: 'tts',
        });

        writeLine(res, {
            t: 'done',
            data: {
                tts: { total_chunks: chunkIdx, latency_ms: latencyMs, provider: adapter.name },
                latency_ms: latencyMs,
            },
        });
        res.end();
    });

    return r;
}
