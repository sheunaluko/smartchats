/**
 * POST /embeddings/embed
 *
 * Proxies to OpenAI's text-embedding-3-small using whichever key the
 * resolver finds (env var or DB). Records usage for observability;
 * no billing envelope returned (self-hosted mode).
 */

import type { Router, Request, Response } from 'express';
import express from 'express';
import OpenAI from 'openai';
import type { ServerConfig } from '../config.js';
import { resolveProviderKey } from './keys.js';
import { writeUsageRecord } from '../usage_writer.js';
import { log } from '../logger.js';

const routeLog = log.withTag('embeddings');

const DEFAULT_MODEL = 'text-embedding-3-small';
const USD_PER_1M_TOKENS = 0.02; // OpenAI text-embedding-3-small

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

        let embedding: number[];
        let totalTokens = 0;
        let actualDimensions = 0;
        try {
            const client = new OpenAI({ apiKey: resolved.key });
            const response = await client.embeddings.create({
                input: text,
                model: DEFAULT_MODEL,
                ...(dimensions && { dimensions }),
            });
            embedding = response.data[0].embedding;
            totalTokens = response.usage?.total_tokens ?? 0;
            actualDimensions = embedding.length;
        } catch (err) {
            routeLog.error(`OpenAI embed failed: ${(err as Error).message}`);
            return res.status(502).json({ error: `provider error: ${(err as Error).message}` });
        }

        const costUsd = (totalTokens * USD_PER_1M_TOKENS) / 1_000_000;

        // Fire-and-forget usage record
        await writeUsageRecord({
            model: DEFAULT_MODEL,
            provider: 'openai',
            inputTokens: totalTokens,
            costUsd,
            sessionId: session_id ?? null,
            requestType: 'embedding',
        });

        res.json({
            embedding,
            model: DEFAULT_MODEL,
            dimensions: actualDimensions,
        });
    });

    return r;
}
