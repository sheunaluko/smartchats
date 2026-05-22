/**
 * LLM streaming endpoints.
 *
 * POST /llm/stream           — text-only NDJSON stream.
 * POST /llm/streamWithTTS    — combined LLM+TTS with a 2-chunk early-split (first
 *                              audio starts after a word-threshold sentence
 *                              boundary; remainder streams after LLM finishes).
 *
 * Both endpoints emit the same NDJSON wire format the SmartChatsBackend
 * client adapters expect. If you change the framing here, update every
 * adapter at the same time — they share the protocol, not the handler.
 *
 * Self-hosted specifics:
 *  - No billing envelope in the `done` frame (BYO-only; the client treats
 *    `billing` as optional).
 *  - TTS cost uses estimateGpt4oMiniTtsCost (per-token, 2% safety margin)
 *    because gpt-4o-mini-tts is billed by tokens, not characters.
 *  - Usage is written to SurrealDB via writeUsageRecord (two rows for
 *    streamWithTTS — one LLM, one TTS).
 */

import type { Router, Request, Response } from 'express';
import express from 'express';
import OpenAI from 'openai';
import * as llm_service from 'llm-service';
import {
    ResponseSplitter,
    openaiTtsStream,
    beginNdjsonStream,
    writeNdjsonLine as writeLine,
    countGpt4oMiniTtsInputTokens,
} from 'llm-service';
import {
    calculateCost,
    estimateGpt4oMiniTtsCost,
    GPT4O_MINI_TTS_PRICING,
    JsonStreamParser,
} from 'cortex';
import type { LLMProvider } from 'smartchats-backend';
import type { ServerConfig } from '../config.js';
import { resolveProviderKey } from './keys.js';
import { writeUsageRecord } from '../usage_writer.js';
import { log } from '../logger.js';

const routeLog = log.withTag('llm');

// ─── Wire-format constants ───────────────────────────────────────

const DEFAULT_VOICE = 'alloy';
const DEFAULT_TTS_MODEL = GPT4O_MINI_TTS_PRICING.model;
const FIRST_CHUNK_WORD_THRESHOLD = 8;
const FIRST_CHUNK_TIME_THRESHOLD_MS = 0;

// ─── Helpers ─────────────────────────────────────────────────────

/** llm-service uses 'gemini'; smartchats-backend + our config use 'google'. */
function toKeyProvider(p: llm_service.Provider): LLMProvider {
    return p === 'gemini' ? 'google' : p;
}

/**
 * Resolve the API key for `provider`, or write a 400 error response and return null.
 * Centralizes the "no key configured" message so /stream + /streamWithTTS stay
 * in sync. Caller must check for null and return immediately.
 */
async function requireProviderKey(
    config: ServerConfig,
    provider: llm_service.Provider,
    res: Response,
): Promise<string | null> {
    const resolved = await resolveProviderKey(config, toKeyProvider(provider));
    if (resolved) return resolved.key;
    const envVar = `SMARTCHATS_${toKeyProvider(provider).toUpperCase()}_API_KEY`;
    res.status(400).json({
        error: `no ${provider} API key configured — set ${envVar} or POST /keys`,
    });
    return null;
}

// ─── Routes ──────────────────────────────────────────────────────

export function llmRoutes(config: ServerConfig): Router {
    const r = express.Router();

    // POST /llm/stream — text-only NDJSON stream
    r.post('/stream', async (req: Request, res: Response) => {
        const body = req.body ?? {};
        const { model, input, temperature, stop, text_format, session_id, warmup } = body;
        const max_tokens = Math.min(body.max_tokens ?? 4096, 8192);

        if (warmup) return res.json({ success: true, warmup: true });

        if (!model || !Array.isArray(input) || input.length === 0) {
            return res.status(400).json({ error: 'model and input are required' });
        }

        let provider: llm_service.Provider;
        try {
            provider = llm_service.getProviderForModel(model);
        } catch {
            return res.status(400).json({ error: `unknown model: ${model}` });
        }

        const apiKey = await requireProviderKey(config, provider, res);
        if (!apiKey) return;

        routeLog.info(`stream: model=${model}, provider=${provider}, messages=${input.length}, max_tokens=${max_tokens}`);

        let streamResponse;
        try {
            streamResponse = llm_service.handleLLMStreamRequest({
                model,
                input,
                max_tokens,
                temperature,
                apiKey,
                ...(stop && { stop }),
                ...(text_format && { text_format }),
            });
        } catch (err) {
            return res.status(500).json({ error: `LLM stream error: ${(err as Error).message}` });
        }

        beginNdjsonStream(res);

        try {
            for await (const chunk of streamResponse.stream) {
                if (chunk) writeLine(res, { t: 'delta', d: chunk });
            }
        } catch (err) {
            routeLog.error(`stream error: ${(err as Error).message}`);
            writeLine(res, { t: 'error', error: (err as Error).message });
            return res.end();
        }

        let aggregated;
        try {
            aggregated = await streamResponse.aggregated;
        } catch (err) {
            writeLine(res, { t: 'error', error: `Aggregation error: ${(err as Error).message}` });
            return res.end();
        }

        const costUsd = calculateCost(model, aggregated.usage, provider);

        await writeUsageRecord({
            model,
            provider,
            inputTokens: aggregated.usage.input_tokens,
            outputTokens: aggregated.usage.output_tokens,
            cachedInputTokens: aggregated.usage.cached_input_tokens ?? 0,
            costUsd,
            sessionId: session_id ?? null,
            requestType: text_format ? 'structured' : 'unstructured',
        });

        writeLine(res, {
            t: 'done',
            data: {
                success: true,
                output_text: aggregated.output_text,
                usage: aggregated.usage,
                model: aggregated.model,
                provider: aggregated.provider,
                finish_reason: aggregated.finish_reason,
                latency_ms: aggregated.latency_ms,
            },
        });
        res.end();

        routeLog.info(`stream done: tokens=${aggregated.usage.input_tokens}/${aggregated.usage.output_tokens}, cost=$${costUsd.toFixed(6)}`);
    });

    // POST /llm/streamWithTTS — combined LLM + TTS streaming
    r.post('/streamWithTTS', async (req: Request, res: Response) => {
        const body = req.body ?? {};
        const { model, input, temperature, stop, text_format, session_id, warmup } = body;
        const max_tokens = Math.min(body.max_tokens ?? 4096, 8192);

        if (warmup) return res.json({ success: true, warmup: true });

        if (!model || !Array.isArray(input) || input.length === 0) {
            return res.status(400).json({ error: 'model and input are required' });
        }

        const enableTTS = body.tts !== false;
        const voice = enableTTS ? (body.voice || DEFAULT_VOICE) : null;
        const ttsModel = body.tts_model_id || DEFAULT_TTS_MODEL;
        const ttsSpeed = body.tts_speed ?? body.speed ?? 1;
        const ttsInstructions = body.tts_instructions ?? body.instructions;

        let provider: llm_service.Provider;
        try {
            provider = llm_service.getProviderForModel(model);
        } catch {
            return res.status(400).json({ error: `unknown model: ${model}` });
        }

        // Resolve both keys upfront — LLM (whichever provider) + OpenAI for TTS.
        const llmApiKey = await requireProviderKey(config, provider, res);
        if (!llmApiKey) return;
        const ttsApiKey = enableTTS ? await requireProviderKey(config, 'openai', res) : null;
        if (enableTTS && !ttsApiKey) return;

        routeLog.info(
            `streamWithTTS: model=${model}, provider=${provider}, voice=${voice || 'disabled'}, messages=${input.length}`,
        );

        let streamResponse;
        try {
            streamResponse = llm_service.handleLLMStreamRequest({
                model,
                input,
                max_tokens,
                temperature,
                apiKey: llmApiKey,
                ...(stop && { stop }),
                ...(text_format && { text_format }),
            });
        } catch (err) {
            return res.status(500).json({ error: `LLM stream error: ${(err as Error).message}` });
        }

        beginNdjsonStream(res);

        const startMs = Date.now();
        let ttsChunkCount = 0;
        let totalTtsInputTokens = 0;
        let totalTtsPcmBytes = 0;
        const ttsPromises: Promise<void>[] = [];
        const openai = ttsApiKey ? new OpenAI({ apiKey: ttsApiKey }) : null;

        function fireTts(text: string, chunkIdx: number): void {
            if (!openai || !voice) return;
            totalTtsInputTokens += countGpt4oMiniTtsInputTokens(text);
            const promise = (async () => {
                try {
                    writeLine(res, { t: 'audio_start', s: chunkIdx, text: text.slice(0, 80), ms: Date.now() - startMs });
                    let c = 0;
                    for await (const pcm of openaiTtsStream(openai, { text, voice, model: ttsModel, speed: ttsSpeed, instructions: ttsInstructions })) {
                        totalTtsPcmBytes += pcm.length;
                        writeLine(res, { t: 'audio', s: chunkIdx, c: c++, b64: pcm.toString('base64') });
                    }
                    writeLine(res, { t: 'audio_end', s: chunkIdx, ms: Date.now() - startMs });
                } catch (err) {
                    routeLog.error(`TTS error chunk ${chunkIdx}: ${(err as Error).message}`);
                    writeLine(res, { t: 'audio_error', s: chunkIdx, error: (err as Error).message });
                }
            })();
            ttsPromises.push(promise);
        }

        const splitter = new ResponseSplitter({
            wordThreshold: FIRST_CHUNK_WORD_THRESHOLD,
            timeThresholdMs: FIRST_CHUNK_TIME_THRESHOLD_MS,
            startTime: startMs,
            onFirstChunk: (text) => fireTts(text, ttsChunkCount++),
        });

        const parser = new JsonStreamParser({
            onResponseChunk: (text) => splitter.feed(text),
            onTextStreamDone: () => {
                const remainder = splitter.flushRemainder();
                if (remainder) fireTts(remainder, ttsChunkCount++);
            },
        });

        try {
            for await (const chunk of streamResponse.stream) {
                if (chunk) {
                    writeLine(res, { t: 'text', d: chunk });
                    parser.feed(chunk);
                }
            }
        } catch (err) {
            routeLog.error(`streamWithTTS LLM error: ${(err as Error).message}`);
            writeLine(res, { t: 'error', error: (err as Error).message });
        }

        // Flush parser + edge case: short response where splitter's threshold never tripped.
        parser.finalize();
        if (voice && !splitter.hasFiredFirst) {
            const remainder = splitter.flushRemainder();
            if (remainder) fireTts(remainder, ttsChunkCount++);
        }

        let aggregated;
        try {
            aggregated = await streamResponse.aggregated;
        } catch (err) {
            writeLine(res, { t: 'error', error: `Aggregation error: ${(err as Error).message}` });
            return res.end();
        }

        // llm_done fires before TTS completes — lets the client finalize the runner turn early.
        writeLine(res, {
            t: 'llm_done',
            data: {
                success: true,
                output_text: aggregated.output_text,
                usage: aggregated.usage,
                model: aggregated.model,
                provider: aggregated.provider,
                finish_reason: aggregated.finish_reason,
                latency_ms: Date.now() - startMs,
            },
        });

        await Promise.allSettled(ttsPromises);

        const llmCostUsd = calculateCost(model, aggregated.usage, provider);
        const ttsEstimate = totalTtsInputTokens > 0
            ? estimateGpt4oMiniTtsCost({ inputTokens: totalTtsInputTokens, outputPcmBytes: totalTtsPcmBytes })
            : null;

        await writeUsageRecord({
            model,
            provider,
            inputTokens: aggregated.usage.input_tokens,
            outputTokens: aggregated.usage.output_tokens,
            cachedInputTokens: aggregated.usage.cached_input_tokens ?? 0,
            costUsd: llmCostUsd,
            sessionId: session_id ?? null,
            requestType: 'combined_tts_llm',
        });
        if (ttsEstimate) {
            await writeUsageRecord({
                model: ttsModel,
                provider: 'openai',
                inputTokens: ttsEstimate.inputTokens,
                outputTokens: ttsEstimate.outputTokens,
                costUsd: ttsEstimate.costUsd,
                sessionId: session_id ?? null,
                requestType: 'combined_tts_audio',
            });
        }

        writeLine(res, {
            t: 'done',
            data: {
                success: true,
                output_text: aggregated.output_text,
                usage: aggregated.usage,
                model: aggregated.model,
                provider: aggregated.provider,
                finish_reason: aggregated.finish_reason,
                latency_ms: Date.now() - startMs,
                tts: {
                    total_chunks: ttsChunkCount,
                    latency_ms: Date.now() - startMs,
                },
            },
        });
        res.end();

        routeLog.info(
            `streamWithTTS done: tokens=${aggregated.usage.input_tokens}/${aggregated.usage.output_tokens}, tts_chunks=${ttsChunkCount}, tts_bytes=${totalTtsPcmBytes}, cost=$${(llmCostUsd + (ttsEstimate?.costUsd ?? 0)).toFixed(6)}`,
        );
    });

    return r;
}
