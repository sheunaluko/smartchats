/**
 * Shared helper: append a row to `usage_records` after every billable call
 * (LLM, TTS, embeddings, tools). In self-hosted mode credits_charged stays 0 —
 * this table exists purely for observability (`/usage/records` + `/usage/summary`).
 *
 * Failures are logged but never rethrown: losing a usage row must not fail
 * the underlying request.
 */

import { queries } from 'smartchats-database';
import { getDb } from './surreal.js';
import { log } from './logger.js';

const writerLog = log.withTag('usage');

export interface UsageRecordWrite {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens?: number;
    cachedInputTokens?: number;
    costUsd: number;
    sessionId?: string | null;
    requestType: string;
}

export async function writeUsageRecord(rec: UsageRecordWrite): Promise<void> {
    try {
        const db = getDb();
        // ts/local_date/local_tz are all stamped server-side: ts via
        // time::now() (real UTC), local_date via time::format(time::now(),
        // '%Y-%m-%d') (UTC date), local_tz = 'UTC'. The local server has no
        // user-timezone context, so usage records are bucketed by UTC days
        // by design — distinct from the browser-stamped event-time on
        // logs/sessions/metrics/KG which carries the user's actual tz.
        const spec = queries.insertUsageRecord({
            model: rec.model,
            provider: rec.provider,
            inputTokens: rec.inputTokens,
            outputTokens: rec.outputTokens ?? 0,
            cachedInputTokens: rec.cachedInputTokens ?? 0,
            costUsd: rec.costUsd,
            sessionId: rec.sessionId ?? null,
            requestType: rec.requestType,
        });
        await db.runRaw(spec.query, spec.variables);
    } catch (err) {
        writerLog.error(`write failed (${rec.requestType}/${rec.model}): ${(err as Error).message}`);
    }
}
