import type { ToolsAPI, SearchResult, BillingEnvelope } from 'smartchats-backend';
import { BackendError } from 'smartchats-backend';
import { httpsCallable } from 'firebase/functions';
import type { FirebaseBackendOptions } from './backend.js';

function wrapCallableError(fn: string, err: unknown): never {
    const message = (err as { message?: string })?.message || 'unknown error';
    throw new BackendError('server_error', `${fn} failed: ${message}`, true, err);
}

export function createToolsAPI(opts: FirebaseBackendOptions): ToolsAPI {
    const serperSearch_fn = httpsCallable<
        { query: string; numResults?: number },
        { success: boolean; results: unknown[]; billing?: BillingEnvelope }
    >(opts.functions, 'serperSearch');

    const getTextFromUrl_fn = httpsCallable<
        { url: string; max_tokens?: number },
        { success: boolean; text: string; title?: string; billing?: BillingEnvelope }
    >(opts.functions, 'getTextFromUrl');

    return {
        async search({ query, numResults }) {
            try {
                const result = await serperSearch_fn({ query, numResults });
                // Serper returns assorted fields per result; keep the known ones + stash
                // the rest under `extra` so downstream can read position/date/thumbnail/etc.
                const results: SearchResult[] = (result.data.results ?? []).map((raw: any) => {
                    const { title, url, snippet, link, ...extra } = raw;
                    return {
                        title: title ?? '',
                        url: url ?? link ?? '',
                        snippet: snippet ?? '',
                        ...(Object.keys(extra).length ? { extra } : {}),
                    };
                });
                return { results, billing: result.data.billing };
            } catch (err) {
                wrapCallableError('tools.search', err);
            }
        },

        /**
         * Cloud parameter is named `max_tokens` but it's actually a char budget:
         * server computes `maxChars = max_tokens / 0.75` and truncates text.
         * Translate back at the boundary so the interface stays honest.
         */
        async fetchUrl({ url, maxChars }) {
            const max_tokens = maxChars !== undefined ? Math.round(maxChars * 0.75) : undefined;
            try {
                const result = await getTextFromUrl_fn({ url, max_tokens });
                return {
                    text: result.data.text,
                    title: result.data.title,
                    billing: result.data.billing,
                };
            } catch (err) {
                wrapCallableError('tools.fetchUrl', err);
            }
        },
    };
}
