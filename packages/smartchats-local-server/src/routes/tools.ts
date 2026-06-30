/**
 * POST /tools/search    — Serper web search (gated on SERPER_API_KEY)
 * POST /tools/fetchUrl  — HTTP fetch + Readability text extraction
 *
 * Both record usage; neither charges credits (self-hosted). Search
 * requires a Serper key from env; fetchUrl needs no provider.
 */

import type { Router, Request, Response } from 'express';
import express from 'express';
import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { serperSearch, normalizeOrganic, SerperError } from 'smartchats-tools';
import type { ServerConfig } from '../config.js';
import { writeUsageRecord } from '../usage_writer.js';
import { log } from '../logger.js';

// linkedom is bun-compile-safe — no __dirname path baking, no worker thread
// spawning, pure JS DOM. Readability only uses the subset of DOM APIs
// linkedom implements (tree-walking, querySelectorAll, attribute access);
// it never executes inline <script> tags, never uses getComputedStyle, never
// fires XMLHttpRequest. See: docs/contributing → "bun-compile compatibility".

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
            // Inject a <base href> so Readability can resolve relative URLs
            // in <a> and <img> tags. jsdom accepted `{ url }` at construction
            // time; linkedom doesn't have an equivalent option, so we splice
            // the tag in manually.
            //
            // The casts: linkedom's parseHTML is typed as `Window` but its
            // runtime shape has `{ document, window, ... }`. The local-server
            // tsconfig has lib: ["ES2022"] (no "DOM"), so `Document` isn't
            // a defined global type — anything DOM-shaped is typed as `any`
            // at this layer. Readability accepts any DOM-compatible object;
            // its runtime tree-walking works fine against linkedom's Document.
            const win = parseHTML(html) as unknown as { document: any };
            const document = win.document;
            const base = document.createElement('base');
            base.setAttribute('href', url);
            document.head?.insertBefore(base, document.head.firstChild);
            const reader = new Readability(document);
            const article = reader.parse();
            if (article) {
                title = article.title ?? '';
                text = article.textContent ?? '';
            } else {
                text = document.body?.textContent ?? '';
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
