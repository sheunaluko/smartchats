/**
 * POST /tts/stream — NDJSON streaming TTS against OpenAI gpt-4o-mini-tts.
 *
 * Wire protocol:
 *   {"t":"audio_start","s":0,"text":"...","ms":N}
 *   {"t":"audio","s":0,"c":N,"b64":"<base64 pcm16le>"}
 *   {"t":"audio_end","s":0,"ms":N}
 *   {"t":"done","data":{"tts":{"total_chunks":N,"latency_ms":N}}}
 *   {"t":"error","error":"..."}
 *
 * PCM output is batched into ~6400-byte chunks to reduce frame overhead
 * while keeping ~133ms of audio per chunk @ 24kHz mono.
 */

import type { Router, Request, Response } from 'express';
import express from 'express';
import OpenAI from 'openai';
import { estimateGpt4oMiniTtsCost, GPT4O_MINI_TTS_PRICING } from 'cortex';
import {
    openaiTtsStream,
    beginNdjsonStream,
    writeNdjsonLine as writeLine,
    countGpt4oMiniTtsInputTokens,
} from 'llm-service';
import type { ServerConfig } from '../config.js';
import { resolveProviderKey } from './keys.js';
import { writeUsageRecord } from '../usage_writer.js';
import { log } from '../logger.js';

const routeLog = log.withTag('tts');

const MODEL = GPT4O_MINI_TTS_PRICING.model;
const MAX_TEXT_LENGTH = 4096;

export function ttsRoutes(config: ServerConfig): Router {
    const r = express.Router();

    r.post('/stream', async (req: Request, res: Response) => {
        const { text, voice, speed, instructions, session_id, warmup } = (req.body ?? {}) as {
            text?: string;
            voice?: string;
            speed?: number;
            instructions?: string;
            session_id?: string;
            warmup?: boolean;
        };

        // Warmup short-circuit — keeps Express worker hot without doing work.
        if (warmup) {
            return res.json({ success: true, warmup: true });
        }

        if (!text || typeof text !== 'string') {
            return res.status(400).json({ error: 'text (string) is required' });
        }
        if (text.length > MAX_TEXT_LENGTH) {
            return res.status(400).json({ error: `text exceeds ${MAX_TEXT_LENGTH} chars` });
        }
        if (!voice || typeof voice !== 'string') {
            return res.status(400).json({ error: 'voice (string) is required' });
        }

        const resolved = await resolveProviderKey(config, 'openai');
        if (!resolved) {
            return res.status(400).json({
                error: 'no OpenAI key configured — set SMARTCHATS_OPENAI_API_KEY / OPENAI_API_KEY or POST /keys',
            });
        }

        beginNdjsonStream(res);

        const startMs = Date.now();
        let chunkIdx = 0;
        let totalPcmBytes = 0;

        try {
            const openai = new OpenAI({ apiKey: resolved.key });
            writeLine(res, { t: 'audio_start', s: 0, text: text.slice(0, 80), ms: Date.now() - startMs });

            for await (const pcm of openaiTtsStream(openai, {
                text,
                voice,
                model: MODEL,
                speed: speed ?? 1.0,
                instructions,
            })) {
                totalPcmBytes += pcm.length;
                writeLine(res, { t: 'audio', s: 0, c: chunkIdx++, b64: pcm.toString('base64') });
            }

            writeLine(res, { t: 'audio_end', s: 0, ms: Date.now() - startMs });
        } catch (err) {
            routeLog.error(`OpenAI TTS error: ${(err as Error).message}`);
            writeLine(res, { t: 'error', error: (err as Error).message });
            res.end();
            return;
        }

        const latencyMs = Date.now() - startMs;
        const inputTokens = countGpt4oMiniTtsInputTokens(text);
        const estimate = estimateGpt4oMiniTtsCost({ inputTokens, outputPcmBytes: totalPcmBytes });

        await writeUsageRecord({
            model: MODEL,
            provider: 'openai',
            inputTokens: estimate.inputTokens,
            outputTokens: estimate.outputTokens,
            costUsd: estimate.costUsd,
            sessionId: session_id ?? null,
            requestType: 'tts',
        });

        writeLine(res, {
            t: 'done',
            data: {
                tts: { total_chunks: chunkIdx, latency_ms: latencyMs },
                latency_ms: latencyMs,
            },
        });
        res.end();
    });

    return r;
}
