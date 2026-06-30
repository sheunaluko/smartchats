/**
 * POST /embeddings/embed
 *
 * Proxies to OpenAI's text-embedding-3-small using whichever key the
 * resolver finds (env var or DB). Records usage for observability;
 * no billing envelope returned (self-hosted mode).
 *
 * Delegates the actual OpenAI call to llm-service's openaiEmbedding
 * helper — same module the cloud openaiEmbedding Cloud Function uses.
 */

import type { Router, Request, Response } from 'express';
import express from 'express';
import { openaiEmbedding, EMBEDDING_MODEL, OpenAIEmbeddingError } from 'llm-service';
import type { ServerConfig } from '../config.js';
import { resolveProviderKey } from './keys.js';
import { writeUsageRecord } from '../usage_writer.js';
import { log } from '../logger.js';

const routeLog = log.withTag('embeddings');

export function embeddingsRoutes(config: ServerConfig): Router {
    const r = express.Router();

    r.post('/embed', async (req: Request, res: Response) => {
        const { text, dimensions, session_id } = (req.body ?? {}) as {
            text?: string;
            dimensions?: number;
            session_id?: string;
        };

        if (!text || typeof text !== 'string') {
            return res.status(400).json({ error: 'text (string) is required' });
        }

        const resolved = await resolveProviderKey(config, 'openai');
        if (!resolved) {
            return res.status(400).json({
                error: 'no OpenAI key configured — set SMARTCHATS_OPENAI_API_KEY or OPENAI_API_KEY, or POST /keys',
            });
        }

        let result;
        try {
            result = await openaiEmbedding({
                apiKey: resolved.key,
                text,
                ...(dimensions !== undefined && { dimensions }),
            });
        } catch (err) {
            routeLog.error(`OpenAI embed failed: ${(err as Error).message}`);
            const status = err instanceof OpenAIEmbeddingError ? 502 : 500;
            return res.status(status).json({ error: `provider error: ${(err as Error).message}` });
        }

        await writeUsageRecord({
            model: EMBEDDING_MODEL,
            provider: 'openai',
            inputTokens: result.inputTokens,
            costUsd: result.costUsd,
            sessionId: session_id ?? null,
            requestType: 'embedding',
        });

        res.json({
            embedding: result.embedding,
            model: result.model,
            dimensions: result.dimensions,
        });
    });

    return r;
}
