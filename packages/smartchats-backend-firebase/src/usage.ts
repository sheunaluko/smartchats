import type {
    UsageAPI,
    UsageRecord,
    UsageSummary,
    PeriodSummary,
    UsageSummaryModelStats,
    UsagePurchase,
} from 'smartchats-backend';
import { BackendError } from 'smartchats-backend';
import { httpsCallable } from 'firebase/functions';
import type { FirebaseBackendOptions } from './backend.js';

function wrapCallableError(fn: string, err: unknown): never {
    const message = (err as { message?: string })?.message || 'unknown error';
    throw new BackendError('server_error', `${fn} failed: ${message}`, true, err);
}

export function createUsageAPI(opts: FirebaseBackendOptions): UsageAPI {
    const getUsage_fn = httpsCallable<
        { limit?: number; startAfter?: string; periodOnly?: boolean },
        { success: boolean; records?: UsageRecord[]; hasMore?: boolean; periodSummary?: PeriodSummary }
    >(opts.functions, 'getUsage');

    const getUsageSummary_fn = httpsCallable<
        { since: number },
        { success: boolean; totalCredits: number; requestCount: number; models: UsageSummaryModelStats[]; purchases: UsagePurchase[] }
    >(opts.functions, 'getUsageSummaryFn');

    return {
        async getRecords(args = {}) {
            try {
                const result = await getUsage_fn(args);
                return {
                    records: result.data.records ?? [],
                    hasMore: !!result.data.hasMore,
                    periodSummary: result.data.periodSummary,
                };
            } catch (err) {
                wrapCallableError('usage.getRecords', err);
            }
        },

        async getSummary({ since }: { since: string }): Promise<UsageSummary> {
            const sinceEpoch = Date.parse(since);
            if (Number.isNaN(sinceEpoch)) {
                throw new BackendError('invalid_request', `usage.getSummary: 'since' must be an ISO timestamp, got ${since}`);
            }
            try {
                const result = await getUsageSummary_fn({ since: sinceEpoch });
                return {
                    totalCredits: result.data.totalCredits,
                    requestCount: result.data.requestCount,
                    models: result.data.models ?? [],
                    purchases: result.data.purchases ?? [],
                };
            } catch (err) {
                wrapCallableError('usage.getSummary', err);
            }
        },
    };
}
