import type { UsageAPI, UsageRecord, UsageSummary, PeriodSummary } from 'smartchats-backend';
import type { LocalBackendOptions } from './backend.js';
import { jsonRequest } from './http.js';

export function createUsageAPI(opts: LocalBackendOptions): UsageAPI {
    return {
        async getRecords(args = {}) {
            const params = new URLSearchParams();
            if (args.limit !== undefined) params.set('limit', String(args.limit));
            if (args.startAfter) params.set('startAfter', args.startAfter);
            if (args.periodOnly) params.set('periodOnly', '1');
            const qs = params.toString();
            return jsonRequest<{ records: UsageRecord[]; hasMore: boolean; periodSummary?: PeriodSummary }>(
                opts,
                `/usage/records${qs ? `?${qs}` : ''}`,
                { method: 'GET' },
            );
        },

        async getSummary({ since }) {
            return jsonRequest<UsageSummary>(
                opts,
                `/usage/summary?since=${encodeURIComponent(since)}`,
                { method: 'GET' },
            );
        },
    };
}
