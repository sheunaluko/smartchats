import type { ToolsAPI, SearchResult, BillingEnvelope } from 'smartchats-backend';
import type { LocalBackendOptions } from './backend.js';
import { jsonRequest } from './http.js';

export function createToolsAPI(opts: LocalBackendOptions): ToolsAPI {
    return {
        async search({ query, numResults, session_id }) {
            return jsonRequest<{ results: SearchResult[]; billing?: BillingEnvelope }>(
                opts,
                '/tools/search',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        query,
                        numResults,
                        ...(session_id && { session_id }),
                    }),
                },
            );
        },

        async fetchUrl({ url, maxChars, session_id }) {
            return jsonRequest<{ text: string; title?: string; billing?: BillingEnvelope }>(
                opts,
                '/tools/fetchUrl',
                {
                    method: 'POST',
                    body: JSON.stringify({
                        url,
                        ...(maxChars !== undefined && { maxChars }),
                        ...(session_id && { session_id }),
                    }),
                },
            );
        },
    };
}
