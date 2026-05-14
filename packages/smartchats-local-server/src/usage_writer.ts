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
        // lts (logical timestamp) is stamped server-side via time::now() — the
        // local server has no user-timezone context, so this is real UTC rather
        // than the fake-UTC local wall-clock used by browser-stamped lts (logs,
        // sessions, KG). Sort/filter still works; the wall-clock semantic
        // arrives if/when the LLM client passes lts in the request body.
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
