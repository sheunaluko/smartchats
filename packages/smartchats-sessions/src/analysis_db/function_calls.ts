/**
 * Function-call histogram — "which tools is the agent actually using, and
 * how much, where, and how reliably?"
 *
 * Aggregates `function_start`, `function_end`, and `function_error` sub-events
 * across every `execution` row in the BaseFilter window. Returns one row
 * per distinct function name, with call totals, distinct-sessions /
 * distinct-users coverage, error counts, and completed-call duration
 * stats (sum / avg / max).
 *
 * SurrealQL projects each per-execution sub-event array down to four
 * payload columns; per-name aggregation happens client-side because
 * SurrealDB's SPLIT clause over deeply-nested array projections was finicky
 * in our probes — the JS-side reduce is cheap and clear.
 *
 * Per-session and per-user views fall out of BaseFilter — pass
 * `sessionId` or `userId` to restrict scope, the histogram still works.
 */
import type { Client } from 'smartchats-database';

import { type BaseFilter, buildFilterClause, combineWhere } from './_query_helpers.js';
import { type FormatOpts, renderRows, fmtDuration } from './_format.js';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface FunctionCallHistogramRow {
    function_name: string;
    /** Total function_start invocations. */
    call_count: number;
    /** Distinct sessions in which this function fired ≥ 1×. */
    distinct_sessions: number;
    /** Distinct users in which this function fired ≥ 1× (excludes null user_id). */
    distinct_users: number;
    /** Calls that ended in function_error. */
    error_count: number;
    /** Calls we observed a function_end for. May be < call_count if the call errored or never completed. */
    completed_count: number;
    /** Sum of all completed-call durations (ms). */
    total_duration_ms: number;
    /** total_duration_ms / completed_count (0 when nothing completed). */
    avg_duration_ms: number;
    /** Longest single completed call (ms). */
    max_duration_ms: number;
}

export interface FunctionCallHistogramResult {
    kind: 'function_call_histogram';
    rows: FunctionCallHistogramRow[];
    /** Total executions scanned (denominator for "how concentrated is the tool mix?"). */
    executions_scanned: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Query
// ──────────────────────────────────────────────────────────────────────────

/**
 * Per-name rollup of function-call activity. Use a tight BaseFilter
 * (since/until/app/userId/sessionId) — wide windows can pull millions of
 * sub-events into the client when production traffic grows.
 *
 * Sorted by call_count descending. `limit` truncates after sort.
 */
export async function queryFunctionCallHistogram(
    client: Client,
    args: BaseFilter,
): Promise<FunctionCallHistogramResult> {
    const f = buildFilterClause(args);
    const where = combineWhere(f.where, `event_type = 'execution'`);

    // We project four parallel arrays from each execution's sub-event list.
    // Each array is per-execution scope (so we can attribute calls to the
    // session_id / user_id of THIS execution). Predicate side keeps the
    // payload skimming cheap — we only pull rows that did at least one
    // function_start.
    const sql = `
        SELECT
            session_id, user_id,
            payload.context.result.events[?type = 'function_start'].data.name AS started_names,
            payload.context.result.events[?type = 'function_end'] AS ended_calls,
            payload.context.result.events[?type = 'function_error'].data.name AS error_names
        FROM insights_events
        WHERE ${combineWhere(where, `array::len(payload.context.result.events[?type = 'function_start']) > 0`)}
    `;

    const raw = (await client.runQuery({ query: sql, variables: f.vars })) as unknown[];
    const rows = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];

    // Per-name accumulator with distinct-set tracking.
    interface Acc {
        function_name: string;
        call_count: number;
        sessions: Set<string>;
        users: Set<string>;
        error_count: number;
        completed_count: number;
        total_duration_ms: number;
        max_duration_ms: number;
    }
    const byName = new Map<string, Acc>();

    const accFor = (name: string): Acc => {
        let a = byName.get(name);
        if (!a) {
            a = {
                function_name: name,
                call_count: 0,
                sessions: new Set<string>(),
                users: new Set<string>(),
                error_count: 0,
                completed_count: 0,
                total_duration_ms: 0,
                max_duration_ms: 0,
            };
            byName.set(name, a);
        }
        return a;
    };

    for (const r of rows) {
        const session_id = String(r.session_id ?? '');
        const user_id = r.user_id == null ? null : String(r.user_id);

        const started = Array.isArray(r.started_names) ? (r.started_names as unknown[]) : [];
        for (const n of started) {
            if (typeof n !== 'string') continue;
            const a = accFor(n);
            a.call_count += 1;
            if (session_id) a.sessions.add(session_id);
            if (user_id) a.users.add(user_id);
        }

        const ended = Array.isArray(r.ended_calls) ? (r.ended_calls as Array<Record<string, unknown>>) : [];
        for (const sub of ended) {
            const data = (sub.data ?? {}) as Record<string, unknown>;
            const name = typeof data.name === 'string' ? data.name : null;
            if (!name) continue;
            const dur = numOrZero(data.duration);
            const a = accFor(name);
            a.completed_count += 1;
            a.total_duration_ms += dur;
            if (dur > a.max_duration_ms) a.max_duration_ms = dur;
        }

        const errored = Array.isArray(r.error_names) ? (r.error_names as unknown[]) : [];
        for (const n of errored) {
            if (typeof n !== 'string') continue;
            accFor(n).error_count += 1;
        }
    }

    const out: FunctionCallHistogramRow[] = [...byName.values()].map((a) => ({
        function_name: a.function_name,
        call_count: a.call_count,
        distinct_sessions: a.sessions.size,
        distinct_users: a.users.size,
        error_count: a.error_count,
        completed_count: a.completed_count,
        total_duration_ms: Math.round(a.total_duration_ms),
        avg_duration_ms: a.completed_count > 0 ? Math.round(a.total_duration_ms / a.completed_count) : 0,
        max_duration_ms: Math.round(a.max_duration_ms),
    }));

    out.sort((a, b) => b.call_count - a.call_count);
    return {
        kind: 'function_call_histogram',
        rows: args.limit ? out.slice(0, args.limit) : out,
        executions_scanned: rows.length,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Formatter
// ──────────────────────────────────────────────────────────────────────────

export function formatFunctionCallHistogram(
    result: FunctionCallHistogramResult,
    opts: FormatOpts = {},
): string {
    const format = opts.format ?? 'text';
    const humanDuration = format === 'text' || format === 'table' || format === 'markdown';

    const rows: Record<string, unknown>[] = result.rows.map((r) => {
        const cell: Record<string, unknown> = { ...r };
        if (humanDuration) {
            cell.avg_duration_ms = fmtDuration(r.avg_duration_ms);
            cell.max_duration_ms = fmtDuration(r.max_duration_ms);
            cell.total_duration_ms = fmtDuration(r.total_duration_ms);
        }
        return cell;
    });

    const columns = [
        'function_name',
        'call_count',
        'distinct_sessions',
        'distinct_users',
        'error_count',
        'completed_count',
        'avg_duration_ms',
        'max_duration_ms',
        'total_duration_ms',
    ];

    const body = renderRows(rows, { ...opts, columns });
    if (format === 'json' || format === 'csv') return body;

    const header = `executions scanned: ${result.executions_scanned}   distinct functions: ${result.rows.length}`;
    return `${header}\n${body}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function numOrZero(v: unknown): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}
