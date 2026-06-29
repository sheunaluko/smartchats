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
import * as llm_service from 'llm-service';
import {
    ResponseSplitter,
    beginNdjsonStream,
    writeNdjsonLine as writeLine,
} from 'llm-service';
import { calculateCost, JsonStreamParser } from 'cortex';
import type { LLMProvider } from 'smartchats-backend';
import type { ServerConfig } from '../config.js';
import { resolveProviderKey } from './keys.js';
import { writeUsageRecord } from '../usage_writer.js';
import { log } from '../logger.js';
import {
    resolveAdapter as resolveTtsAdapter,
    DEFAULT_TTS_PROVIDER,
} from '../tts_providers/index.js';

const routeLog = log.withTag('llm');

// ─── Wire-format constants ───────────────────────────────────────

/** Fallback voice — only used when the request omits `tts_voice`. The
 *  adapter validates; mismatched provider+voice will error there. */
const DEFAULT_VOICE = 'en-US-AvaMultilingualNeural';
const FIRST_CHUNK_WORD_THRESHOLD = 8;
const FIRST_CHUNK_TIME_THRESHOLD_MS = 0;

// ─── Helpers ─────────────────────────────────────────────────────

/** llm-service uses 'gemini'; smartchats-backend + our config use 'google'. */
function toKeyProvider(p: llm_service.Provider): LLMProvider {
    if (p === 'gemini') return 'google';
    return p;
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
        // Default bumped 4096 → 16384, cap 8192 → 32768 to give gpt-5-series
        // reasoning models headroom for both reasoning_tokens AND structured
        // output. At the API default `effort: "medium"`, nano consumed all 4096
        // on reasoning alone and emitted response.incomplete with
        // reason=max_output_tokens. See benchpress STATUS.txt § Tunable
        // reasoning_effort axis.
        const max_tokens = Math.min(body.max_tokens ?? 16384, 32768);

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
        // Default bumped 4096 → 16384, cap 8192 → 32768 to give gpt-5-series
        // reasoning models headroom for both reasoning_tokens AND structured
        // output. At the API default `effort: "medium"`, nano consumed all 4096
        // on reasoning alone and emitted response.incomplete with
        // reason=max_output_tokens. See benchpress STATUS.txt § Tunable
        // reasoning_effort axis.
        const max_tokens = Math.min(body.max_tokens ?? 16384, 32768);

        if (warmup) return res.json({ success: true, warmup: true });

        if (!model || !Array.isArray(input) || input.length === 0) {
            return res.status(400).json({ error: 'model and input are required' });
        }

        const enableTTS = body.tts !== false;
        const voice = enableTTS ? (body.voice || body.tts_voice || DEFAULT_VOICE) : null;
        const ttsSpeed = body.tts_speed ?? body.speed ?? 1;
        const ttsInstructions = body.tts_instructions ?? body.instructions;
        const ttsProviderName: string = body.tts_provider || DEFAULT_TTS_PROVIDER;

        let provider: llm_service.Provider;
        try {
            provider = llm_service.getProviderForModel(model);
        } catch {
            return res.status(400).json({ error: `unknown model: ${model}` });
        }

        // LLM key required regardless of TTS choice.
        const llmApiKey = await requireProviderKey(config, provider, res);
        if (!llmApiKey) return;

        // Resolve TTS adapter once per request. Adapter owns its own key
        // (resolved from config at construction time inside the registry).
        const ttsAdapter = enableTTS ? resolveTtsAdapter(config, ttsProviderName) : null;
        if (enableTTS && !ttsAdapter) {
            return res.status(400).json({
                error: `no TTS adapter available for "${ttsProviderName}" (and fallback to "${DEFAULT_TTS_PROVIDER}" also failed) — check config + provider keys`,
            });
        }

        routeLog.info(
            `streamWithTTS: model=${model}, provider=${provider}, tts_provider=${ttsAdapter?.name ?? 'disabled'}, voice=${voice || 'disabled'}, messages=${input.length}`,
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
        let totalTtsCharacters = 0;
        let totalTtsPcmBytes = 0;
        const ttsPromises: Promise<void>[] = [];

        function fireTts(text: string, chunkIdx: number): void {
            if (!ttsAdapter || !voice) return;
            totalTtsCharacters += text.length;
            const promise = (async () => {
                try {
                    writeLine(res, { t: 'audio_start', s: chunkIdx, text: text.slice(0, 80), ms: Date.now() - startMs });
                    let c = 0;
                    for await (const pcm of ttsAdapter.stream({ text, voice, speed: ttsSpeed, instructions: ttsInstructions })) {
                        totalTtsPcmBytes += pcm.length;
                        writeLine(res, { t: 'audio', s: chunkIdx, c: c++, b64: pcm.toString('base64') });
                    }
                    writeLine(res, { t: 'audio_end', s: chunkIdx, ms: Date.now() - startMs });
                } catch (err) {
                    routeLog.error(`TTS error chunk ${chunkIdx} (${ttsAdapter.name}): ${(err as Error).message}`);
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
        // Cost via the adapter. Each provider knows its own pricing model
        // (OpenAI = tokens, Azure = characters, etc.) and surfaces it in
        // TtsCostEstimate.unit so usage records remain meaningful.
        const ttsEstimate = ttsAdapter && totalTtsCharacters > 0
            ? ttsAdapter.estimateCost({
                text: 'x'.repeat(totalTtsCharacters), // adapter only needs the char count
                outputBytes: totalTtsPcmBytes,
                voice: voice ?? '',
            })
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
        if (ttsAdapter && ttsEstimate) {
            await writeUsageRecord({
                // Use provider-specific model id label so usage analytics
                // can group by TTS provider without ambiguity.
                model: `${ttsAdapter.name}:${voice ?? 'default'}`,
                provider: ttsAdapter.name as LLMProvider,
                inputTokens: ttsEstimate.unit === 'tokens' ? ttsEstimate.quantity : 0,
                outputTokens: Math.floor(totalTtsPcmBytes / 2), // PCM16 = 2 bytes/sample
                costUsd: ttsEstimate.usd,
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
            `streamWithTTS done: tokens=${aggregated.usage.input_tokens}/${aggregated.usage.output_tokens}, tts=${ttsAdapter?.name ?? 'none'}, tts_chunks=${ttsChunkCount}, tts_bytes=${totalTtsPcmBytes}, cost=$${(llmCostUsd + (ttsEstimate?.usd ?? 0)).toFixed(6)}`,
        );
    });

    return r;
}
