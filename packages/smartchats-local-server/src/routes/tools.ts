/**
 * POST /tools/search    — Serper web search (gated on SERPER_API_KEY)
 * POST /tools/fetchUrl  — HTTP fetch + Readability text extraction
 *
 * Both record usage; neither charges credits (self-hosted). Search
 * requires a Serper key from env; fetchUrl needs no provider.
 */

import type { Router, Request, Response } from 'express';
import express from 'express';
import {
    serperSearch, normalizeOrganic, SerperError,
    extractReadableText, ExtractError,
} from 'smartchats-tools';
import type { ServerConfig } from '../config.js';
import { writeUsageRecord } from '../usage_writer.js';
import { log } from '../logger.js';

const routeLog = log.withTag('tools');

export function toolsRoutes(config: ServerConfig): Router {
    const r = express.Router();

    // ── /tools/search ──────────────────────────────────────────────
    r.post('/search', async (req: Request, res: Response) => {
        const { query, numResults, session_id } = (req.body ?? {}) as {
            query?: string;
            numResults?: number;
            session_id?: string;
        };
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ error: 'query (string) is required' });
        }

        const serperKey = config.providerEnvKeys.serper;
        if (!serperKey) {
            return res.status(400).json({
                error: 'search disabled: SMARTCHATS_SERPER_API_KEY or SERPER_API_KEY not set',
            });
        }

        let result;
        try {
            result = await serperSearch({
                apiKey: serperKey,
                query,
                ...(numResults !== undefined && { numResults }),
            });
        } catch (err) {
            routeLog.error(`serper fetch failed: ${(err as Error).message}`);
            const status = err instanceof SerperError && err.status ? 502 : 502;
            return res.status(status).json({ error: `serper fetch failed: ${(err as Error).message}` });
        }

        await writeUsageRecord({
            model: 'serper',
            provider: 'serper',
            inputTokens: 0,
            costUsd: result.costUsd,
            sessionId: session_id ?? null,
            requestType: 'tools.search',
        });

        res.json({ results: normalizeOrganic(result.organic) });
    });

    // ── /tools/fetchUrl ────────────────────────────────────────────
    r.post('/fetchUrl', async (req: Request, res: Response) => {
        const { url, maxChars, session_id } = (req.body ?? {}) as {
            url?: string;
            maxChars?: number;
            session_id?: string;
        };
        if (!url || typeof url !== 'string') {
            return res.status(400).json({ error: 'url (string) is required' });
        }

        let result;
        try {
            result = await extractReadableText(url, {
                ...(typeof maxChars === 'number' && maxChars > 0 && { maxChars }),
            });
        } catch (err) {
            const e = err as Error;
            routeLog.error(`fetchUrl failed: ${e.message}`);
            const status = err instanceof ExtractError && err.status ? 502 : 500;
            return res.status(status).json({ error: e.message });
        }

        // No upstream paid API — cost is genuinely zero.
        await writeUsageRecord({
            model: 'fetchUrl',
            provider: 'fetchUrl',
            inputTokens: 0,
            costUsd: 0,
            sessionId: session_id ?? null,
            requestType: 'tools.fetchUrl',
        });

        res.json({ text: result.text, title: result.title });
    });

    return r;
}
