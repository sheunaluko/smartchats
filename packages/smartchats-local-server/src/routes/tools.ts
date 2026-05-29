/**
 * POST /tools/search    — Serper web search (gated on SERPER_API_KEY)
 * POST /tools/fetchUrl  — HTTP fetch + Readability text extraction
 *
 * Both record usage; neither charges credits (self-hosted). Search
 * requires a Serper key from env; fetchUrl needs no provider.
 */

import type { Router, Request, Response } from 'express';
import express from 'express';
import type { SearchResult } from 'smartchats-backend';
import type { ServerConfig } from '../config.js';
import { writeUsageRecord } from '../usage_writer.js';
import { log } from '../logger.js';

// jsdom + @mozilla/readability are dynamic-imported inside the /fetchUrl
// handler. Reasons:
//   1. They're only needed for the /fetchUrl path — search doesn't touch DOM.
//   2. jsdom spawns a Node Worker for synchronous XHR and looks up
//      `xhr-sync-worker.js` via an absolute path bun --compile bakes in at
//      build time. Eager-importing at the top of the file makes that lookup
//      happen at server startup, crashing the bun-compiled binary on any
//      machine other than the one it was compiled on. Lazy-loading defers
//      it until the route is actually called.

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

        let serperResponse: { organic?: any[]; credits?: number } = {};
        try {
            const response = await fetch('https://google.serper.dev/search', {
                method: 'POST',
                headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
                body: JSON.stringify({ q: query, num: numResults ?? 10 }),
            });
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                return res.status(502).json({ error: `serper: ${response.status} ${text}` });
            }
            serperResponse = await response.json();
        } catch (err) {
            routeLog.error(`serper fetch failed: ${(err as Error).message}`);
            return res.status(502).json({ error: `serper fetch failed: ${(err as Error).message}` });
        }

        const results: SearchResult[] = (serperResponse.organic ?? []).map((raw: any) => {
            const { title, link, snippet, ...extra } = raw;
            return {
                title: title ?? '',
                url: link ?? '',
                snippet: snippet ?? '',
                ...(Object.keys(extra).length > 0 ? { extra } : {}),
            };
        });

        // Serper reports credits used per call in the response body.
        // 1 Serper credit = $0.001 USD.
        const serperCredits = serperResponse.credits ?? 1;
        const costUsd = serperCredits / 1000;
        await writeUsageRecord({
            model: 'serper',
            provider: 'serper',
            inputTokens: 0,
            costUsd,
            sessionId: session_id ?? null,
            requestType: 'tools.search',
        });

        res.json({ results });
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

        let html: string;
        try {
            const response = await fetch(url, {
                headers: { 'User-Agent': 'smartchats-local-server/0.1' },
                signal: AbortSignal.timeout(15_000),
            });
            if (!response.ok) {
                return res.status(502).json({ error: `HTTP ${response.status}: ${response.statusText}` });
            }
            html = await response.text();
        } catch (err) {
            return res.status(502).json({ error: `fetch failed: ${(err as Error).message}` });
        }

        let title = '';
        let text = '';
        try {
            // Lazy import — see file header comment for why this can't be a top-level import.
            const { JSDOM } = await import('jsdom');
            const { Readability } = await import('@mozilla/readability');
            const dom = new JSDOM(html, { url });
            const reader = new Readability(dom.window.document);
            const article = reader.parse();
            if (article) {
                title = article.title ?? '';
                text = article.textContent ?? '';
            } else {
                text = dom.window.document.body?.textContent ?? '';
            }
            if (typeof maxChars === 'number' && maxChars > 0 && text.length > maxChars) {
                text = text.substring(0, maxChars) + '\n\n[truncated]';
            }
        } catch (err) {
            return res.status(500).json({ error: `parse failed: ${(err as Error).message}` });
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

        res.json({ text, title });
    });

    return r;
}
