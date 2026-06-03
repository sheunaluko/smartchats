/**
 * Usage-tracking query builders for `usage_records` — local self-hosted
 * observability (no credits charged). Driven by `smartchats-local-server`'s
 * `/usage/*` routes and the fire-and-forget writer.
 */

import type { QuerySpec } from '../types.js';

// ── Local: usage_records ──────────────────────────────────────────────

/**
 * Paginated list of `usage_records` rows in reverse chronological order.
 * `startAfter` is the real-UTC `ts` of the last row from the prior page;
 * rows with `ts < $startAfter` are returned next. When omitted, returns
 * the first page.
 */
export function listUsageRecords(args: { limit: number; startAfter?: string | null }): QuerySpec {
    const where = args.startAfter ? 'WHERE ts < $startAfter' : '';
    const variables: Record<string, unknown> = { limit: args.limit };
    if (args.startAfter) variables.startAfter = args.startAfter;
    return {
        query: `SELECT * FROM usage_records ${where} ORDER BY ts DESC LIMIT $limit`,
        variables,
    };
}

/**
 * Fetch `usage_records` rows whose `ts` is at or after `since` (real
 * UTC ISO datetime). Used to compute period-bounded summaries
 * (`/usage/summary?since=...` and the implicit 30-day rollup on the
 * `/usage/records` response).
 */
export function getUsageRecordsSince(since: string): QuerySpec {
    return {
        query: `SELECT * FROM usage_records WHERE ts >= <datetime> $since`,
        variables: { since },
    };
}

/**
 * CREATE a single `usage_records` row. Stamped server-side with
 * `time::now()` for `lts` (the local server has no user-timezone context;
 * see usage_writer.ts for the rationale on why this is real UTC rather
 * than fake-UTC local wall-clock).
 *
 * `credits_charged = 0` and `charged_from = 'local'` are constants in
 * self-hosted mode — the table is observability-only.
 */
export interface InsertUsageRecordArgs {
    model: string;
    provider: string;
    inputTokens: number;
    outputTokens: number;
    cachedInputTokens: number;
    costUsd: number;
    sessionId: string | null;
    requestType: string;
}
export function insertUsageRecord(args: InsertUsageRecordArgs): QuerySpec {
    // session_id is `option<string>` in the SCHEMAFULL definition. SurrealDB's
    // `option<T>` accepts NONE (field absent) but rejects an explicit NULL
    // value bound from JSON null. So when sessionId is null, we omit the
    // field from SET entirely — the field stays NONE on the row.
    // Without this guard, the previous fixed SET produced an ERR for every
    // call without a sessionId (writeUsageRecord's silent try/catch hid it).
    // Server-side stamp for all event-time fields. lts and ts are both
    // real-UTC time::now() (lts on usage_records was always real UTC, not
    // fake-UTC like the user-data tables). local_date is the UTC date
    // since the local server has no user-tz context. local_tz = 'UTC'
    // documents that bucketing for this table is UTC days.
    const setClauses: string[] = [
        'model = $model',
        'provider = $provider',
        'input_tokens = $in',
        'output_tokens = $out',
        'cached_input_tokens = $cached',
        'cost_usd = $cost',
        'credits_charged = 0',
        "charged_from = 'local'",
        'request_type = $type',
        'lts = time::now()',
        'ts = time::now()',
        "local_date = time::format(time::now(), '%Y-%m-%d')",
        "local_tz = 'UTC'",
    ];
    const variables: Record<string, unknown> = {
        model: args.model,
        provider: args.provider,
        in: args.inputTokens,
        out: args.outputTokens,
        cached: args.cachedInputTokens,
        cost: args.costUsd,
        type: args.requestType,
    };
    if (args.sessionId !== null && args.sessionId !== undefined) {
        setClauses.push('session_id = $sid');
        variables.sid = args.sessionId;
    }
    return {
        query: `CREATE usage_records SET ${setClauses.join(', ')}`,
        variables,
    };
}

