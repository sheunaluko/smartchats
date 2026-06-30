/**
 * URL fetch + Readability text extraction — single source of truth for
 * "given a URL, hand me the article text." Both the open self-hosted
 * /tools/fetchUrl route and the cloud getTextFromUrl Cloud Function
 * call this.
 *
 * DOM library: linkedom. Chosen because:
 *   - It's bun-compile-safe (no __dirname baking, no worker threads),
 *     which the open self-hosted distribution requires via
 *     bin/test-bun-deploy.
 *   - It works in Cloud Functions Node 24 with zero behavior change
 *     versus JSDOM for the API surface Readability uses (tree walking,
 *     querySelectorAll, attribute access). JSDOM's only relevant
 *     advantage was its constructor's `{ url }` option, which lets
 *     Readability resolve relative URLs in <a>/<img> tags. We work
 *     around that by injecting a <base href> tag manually — same
 *     behavior, one DOM lib.
 *
 * HTTP fetch: browser-like User-Agent + Accept headers + redirect:'follow'
 * + AbortSignal.timeout(15s). Default headers are tuned to maximize
 * extraction success against sites that block "naked" bots.
 *
 * Errors:
 *   - Non-2xx response from URL          → ExtractError with status
 *   - Network failure / timeout          → ExtractError wrapping the cause
 *   - Readability + body fallback both null → returns { title: '', text: '' }
 *     (caller decides if empty text is an error)
 */

import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

export interface ExtractOptions {
    /** Char limit (post-extraction). Omit for no limit.
     *  Cloud's getTextFromUrl historically took max_tokens; project that
     *  through max_tokens / 0.75 ≈ maxChars before calling. */
    maxChars?: number;
    /** Network timeout in ms. Default 15000. */
    timeoutMs?: number;
    /** Override the User-Agent. Default is browser-like (Mozilla/5.0…). */
    userAgent?: string;
    /** Pass-through abort signal — combined with timeoutMs. */
    signal?: AbortSignal;
}

export interface ExtractedText {
    title: string;
    text: string;
    /** Original byte length of the fetched HTML. Diagnostic / telemetry use. */
    htmlBytes: number;
    /** True iff Readability returned a non-null article (vs falling back to body textContent). */
    readabilitySucceeded: boolean;
}

export class ExtractError extends Error {
    constructor(message: string, public readonly status?: number, public readonly cause?: unknown) {
        super(message);
        this.name = 'ExtractError';
    }
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_USER_AGENT =
    'Mozilla/5.0 (compatible; SmartChats/1.0; +https://smartchats.ai)';

export async function extractReadableText(
    url: string,
    opts: ExtractOptions = {},
): Promise<ExtractedText> {
    if (!url || typeof url !== 'string' || url.trim().length === 0) {
        throw new ExtractError('url is required');
    }

    // ── 1. Fetch HTML ──────────────────────────────────────────────
    let html: string;
    let htmlBytes = 0;
    try {
        const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const response = await fetch(url, {
            headers: {
                'User-Agent': opts.userAgent ?? DEFAULT_USER_AGENT,
                Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.5',
            },
            redirect: 'follow',
            signal: opts.signal ?? AbortSignal.timeout(timeout),
        });
        if (!response.ok) {
            throw new ExtractError(
                `HTTP ${response.status}: ${response.statusText}`,
                response.status,
            );
        }
        html = await response.text();
        htmlBytes = html.length;
    } catch (err) {
        if (err instanceof ExtractError) throw err;
        throw new ExtractError(`fetch failed: ${(err as Error).message}`, undefined, err);
    }

    // ── 2. Parse with linkedom + Readability ───────────────────────
    let title = '';
    let text = '';
    let readabilitySucceeded = false;
    try {
        // Inject <base href> so Readability can resolve relative URLs in
        // <a> and <img> tags. JSDOM accepts `{ url }` at construction
        // time; linkedom doesn't have an equivalent option, so we splice
        // the tag in manually.
        //
        // The cast: linkedom's parseHTML is typed as `Window` but its
        // runtime shape has `{ document, window, ... }`. We don't have
        // DOM types in lib here; treat as any.
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
            readabilitySucceeded = true;
        } else {
            // Fallback: extract body text directly. Less clean (nav/footer
            // included) but at least surfaces something for sites
            // Readability can't classify as articles.
            text = document.body?.textContent ?? '';
        }

        if (opts.maxChars && opts.maxChars > 0 && text.length > opts.maxChars) {
            text = text.substring(0, opts.maxChars) + '\n\n[truncated]';
        }
    } catch (err) {
        throw new ExtractError(`parse failed: ${(err as Error).message}`, undefined, err);
    }

    return { title, text, htmlBytes, readabilitySucceeded };
}
