/**
 * Serper web-search helper — single source of truth for "POST a query to
 * google.serper.dev and unwrap the response." Both the open self-hosted
 * /tools/search route and the cloud serperSearch Firebase Function call
 * this. Pure I/O; no host coupling.
 *
 * Pricing: 1 Serper credit = $0.001 USD. The response carries `credits`
 * indicating how many were spent on the call; this helper surfaces that
 * + the derived USD cost so each caller's billing layer doesn't have to
 * recompute it.
 *
 * Wire shape returned: the salient fields the agent surface uses
 * (organic / knowledgeGraph / answerBox) plus credits + costUsd. Any
 * other fields Serper returns get dropped — add fields here as the
 * tool surface grows.
 *
 * Errors:
 *   - Non-2xx response from Serper        → throw SerperError with status
 *   - Network failure / abort             → throw the underlying Error
 * Both are caller-handled (each host wraps them in its own protocol-shaped
 * error frame).
 */

import type { SearchResult } from 'smartchats-backend';

export interface SerperOrganicResult {
    title: string;
    link: string;
    snippet: string;
    [key: string]: unknown;
}

export interface SerperSearchOptions {
    /** API key from env (SERPER_API_KEY / SMARTCHATS_SERPER_API_KEY). */
    apiKey: string;
    query: string;
    /** Default 10. Serper accepts up to ~100. */
    numResults?: number;
    /** Optional abort for cancellable requests. */
    signal?: AbortSignal;
}

export interface SerperSearchResult {
    /** Raw organic results, in Serper's native shape. Use `normalizeOrganic`
     *  to project into the smartchats-backend SearchResult shape if you
     *  need that. */
    organic: SerperOrganicResult[];
    /** Knowledge-graph card, when Serper returns one. */
    knowledgeGraph?: unknown;
    /** Direct-answer box, when Serper returns one. */
    answerBox?: unknown;
    /** Serper-side credits charged for this call. */
    credits: number;
    /** Derived USD cost (= credits × $0.001). Convenience for billing. */
    costUsd: number;
}

export class SerperError extends Error {
    constructor(message: string, public readonly status?: number) {
        super(message);
        this.name = 'SerperError';
    }
}

const SERPER_ENDPOINT = 'https://google.serper.dev/search';
const USD_PER_SERPER_CREDIT = 1 / 1000;

export async function serperSearch(opts: SerperSearchOptions): Promise<SerperSearchResult> {
    if (!opts.apiKey) throw new SerperError('Serper API key not configured');
    if (!opts.query || opts.query.trim().length === 0) {
        throw new SerperError('query is required');
    }

    const response = await fetch(SERPER_ENDPOINT, {
        method: 'POST',
        headers: {
            'X-API-KEY': opts.apiKey,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            q: opts.query,
            num: opts.numResults ?? 10,
        }),
        ...(opts.signal && { signal: opts.signal }),
    });

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new SerperError(
            `Serper API returned ${response.status}: ${body || response.statusText}`,
            response.status,
        );
    }

    const json = await response.json() as {
        organic?: SerperOrganicResult[];
        knowledgeGraph?: unknown;
        answerBox?: unknown;
        credits?: number;
    };

    const credits = json.credits ?? 1;
    return {
        organic: json.organic ?? [],
        ...(json.knowledgeGraph !== undefined && { knowledgeGraph: json.knowledgeGraph }),
        ...(json.answerBox !== undefined && { answerBox: json.answerBox }),
        credits,
        costUsd: credits * USD_PER_SERPER_CREDIT,
    };
}

/**
 * Project Serper's organic-result shape into the smartchats-backend
 * SearchResult shape (the protocol the open client expects from
 * /tools/search). Unknown fields are surfaced under `extra` so nothing
 * is lost in translation.
 */
export function normalizeOrganic(organic: SerperOrganicResult[]): SearchResult[] {
    return organic.map((raw) => {
        const { title, link, snippet, ...extra } = raw;
        return {
            title: title ?? '',
            url: link ?? '',
            snippet: snippet ?? '',
            ...(Object.keys(extra).length > 0 ? { extra } : {}),
        };
    });
}
