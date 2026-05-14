import type { InsightsAPI, InsightEvent } from 'smartchats-backend';
import type { LocalBackendOptions } from './backend.js';
import { jsonRequest } from './http.js';

export function createInsightsAPI(opts: LocalBackendOptions): InsightsAPI {
    return {
        async emit(events: InsightEvent[]): Promise<{ stored: number; errors?: string[] }> {
            if (events.length === 0) return { stored: 0 };
            return jsonRequest<{ stored: number; errors?: string[] }>(
                opts,
                '/insights/batch',
                { method: 'POST', body: JSON.stringify({ events }) },
            );
        },
    };
}
