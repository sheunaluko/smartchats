import type { InsightsAPI, InsightEvent } from 'smartchats-backend';
import { BackendError } from 'smartchats-backend';
import { httpsCallable } from 'firebase/functions';
import type { FirebaseBackendOptions } from './backend.js';

/**
 * Cloud `insightsBatch` envelope (matches the Function in
 * smartchats-cloud/functions/src/index.ts).
 */
interface InsightsBatchResponse {
    success: boolean;
    events_received: number;
    events_stored: number;
    errors?: string[];
    error?: string;
}

export function createInsightsAPI(opts: FirebaseBackendOptions): InsightsAPI {
    const insightsBatch_fn = httpsCallable<
        { events: InsightEvent[] },
        InsightsBatchResponse
    >(opts.functions, 'insightsBatch');

    return {
        async emit(events: InsightEvent[]): Promise<{ stored: number; errors?: string[] }> {
            if (events.length === 0) return { stored: 0 };

            try {
                const result = await insightsBatch_fn({ events });
                const data = result.data;
                if (!data.success && data.error) {
                    throw new BackendError('server_error', `insights.emit: ${data.error}`, true);
                }
                return { stored: data.events_stored, errors: data.errors };
            } catch (err) {
                if (err instanceof BackendError) throw err;
                throw new BackendError('server_error', `insights.emit failed: ${(err as Error).message}`, true, err);
            }
        },
    };
}
