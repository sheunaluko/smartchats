/**
 * Per-user activity rollup — "who is using this and how?"
 *
 * Pivots the per-user signal that all the other analyzers expose
 * separately: sessions, executions, LLM call count + cost, distinct
 * functions used, total errors, first/last seen.
 *
 * Three lightweight queries reduced by user_id:
 *   1. queryCostByCallTuple — gives per-(session, model) tokens + USD.
 *      Reduced client-side to per-user totals.
 *   2. Execution-row projection — function-call counts + names, function
 *      error counts per execution.
 *   3. Top-level error count — events whose event_type contains 'error'.
 *
 * Sorted by cost_usd descending (cost is the meaningful gradient — calls
 * and execution counts correlate but cost differentiates real activity).
 */
import type { Client } from 'smartchats-database';

import { type BaseFilter, buildFilterClause, combineWhere } from './_query_helpers.js';
import { type FormatOpts, renderRows, fmtUsd } from './_format.js';
import { queryCostByCallTuple } from './cost.js';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface UserActivityRow {
    user_id: string;
    sessions: number;
    executions: number;
    llm_calls: number;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    cache_creation_input_tokens: number;
    cost_usd: number;
    function_calls_total: number;
    distinct_function_names: number;
    /** function_error sub-events. */
    function_errors: number;
    /** Top-level error events (event_type LIKE '*error*'). */
    top_level_errors: number;
    first_seen: string;
    last_seen: string;
}

export interface UsersActivityResult {
    kind: 'users_activity';
    rows: UserActivityRow[];
    /** Total distinct users in window. */
    total_users: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Query
// ──────────────────────────────────────────────────────────────────────────

export async function queryUsersActivity(
    client: Client,
    args: BaseFilter,
): Promise<UsersActivityResult> {
    // We want all tuples for the user roll-up, ignore caller's limit until
    // after aggregation.
    const costTuples = await queryCostByCallTuple(client, { ...args, limit: undefined });

    const f = buildFilterClause(args);

    // ── Executions ─────────────────────────────────────────────────────
    const sqlExec = `
        SELECT
            session_id, user_id, timestamp,
            payload.context.result.events[?type = 'function_start'].data.name AS started_names,
            array::len(payload.context.result.events[?type = 'function_error']) AS error_count
        FROM insights_events
        WHERE ${combineWhere(f.where, `event_type = 'execution'`)}
    `;
    const rawExec = (await client.runQuery({ query: sqlExec, variables: f.vars })) as unknown[];
    const execRows = Array.isArray(rawExec[0]) ? (rawExec[0] as Array<Record<string, unknown>>) : [];

    // ── Top-level errors ───────────────────────────────────────────────
    const sqlErr = `
        SELECT user_id, session_id, timestamp
        FROM insights_events
        WHERE ${combineWhere(f.where, `string::contains(event_type, 'error')`)}
    `;
    const rawErr = (await client.runQuery({ query: sqlErr, variables: f.vars })) as unknown[];
    const errRows = Array.isArray(rawErr[0]) ? (rawErr[0] as Array<Record<string, unknown>>) : [];

    // ── Aggregate ──────────────────────────────────────────────────────
    interface Acc {
        user_id: string;
        sessions: Set<string>;
        executions: number;
        llm_calls: number;
        input_tokens: number;
        output_tokens: number;
        cached_input_tokens: number;
        cache_creation_input_tokens: number;
        cost_usd: number;
        function_calls_total: number;
        function_names: Set<string>;
        function_errors: number;
        top_level_errors: number;
        first_seen: string;
        last_seen: string;
    }

    const byUser = new Map<string, Acc>();
    const accFor = (userId: string): Acc => {
        let a = byUser.get(userId);
        if (!a) {
            a = {
                user_id: userId,
                sessions: new Set<string>(),
                executions: 0,
                llm_calls: 0,
                input_tokens: 0,
                output_tokens: 0,
                cached_input_tokens: 0,
                cache_creation_input_tokens: 0,
                cost_usd: 0,
                function_calls_total: 0,
                function_names: new Set<string>(),
                function_errors: 0,
                top_level_errors: 0,
                first_seen: '',
                last_seen: '',
            };
            byUser.set(userId, a);
        }
        return a;
    };

    // Cost tuples
    for (const t of costTuples) {
        const uid = t.user_id ?? '<no-user>';
        const a = accFor(uid);
        if (t.session_id) a.sessions.add(t.session_id);
        a.llm_calls += t.llm_calls;
        a.input_tokens += t.input_tokens;
        a.output_tokens += t.output_tokens;
        a.cached_input_tokens += t.cached_input_tokens;
        a.cache_creation_input_tokens += t.cache_creation_input_tokens;
        a.cost_usd += t.cost_usd;
    }

    // Executions
    for (const r of execRows) {
        const uid = r.user_id == null ? '<no-user>' : String(r.user_id);
        const session_id = String(r.session_id ?? '');
        const ts = String(r.timestamp ?? '');
        const a = accFor(uid);
        a.executions += 1;
        if (session_id) a.sessions.add(session_id);
        if (ts) updateSeen(a, ts);

        const startedNames = Array.isArray(r.started_names) ? (r.started_names as unknown[]) : [];
        for (const n of startedNames) {
            if (typeof n !== 'string') continue;
            a.function_calls_total += 1;
            a.function_names.add(n);
        }
        const errCount = numOrZero(r.error_count);
        a.function_errors += errCount;
    }

    // Top-level errors
    for (const r of errRows) {
        const uid = r.user_id == null ? '<no-user>' : String(r.user_id);
        const ts = String(r.timestamp ?? '');
        const a = accFor(uid);
        a.top_level_errors += 1;
        if (ts) updateSeen(a, ts);
    }

    const rows: UserActivityRow[] = [...byUser.values()]
        .map((a) => ({
            user_id: a.user_id,
            sessions: a.sessions.size,
            executions: a.executions,
            llm_calls: a.llm_calls,
            input_tokens: a.input_tokens,
            output_tokens: a.output_tokens,
            cached_input_tokens: a.cached_input_tokens,
            cache_creation_input_tokens: a.cache_creation_input_tokens,
            cost_usd: Number(a.cost_usd.toFixed(4)),
            function_calls_total: a.function_calls_total,
            distinct_function_names: a.function_names.size,
            function_errors: a.function_errors,
            top_level_errors: a.top_level_errors,
            first_seen: a.first_seen,
            last_seen: a.last_seen,
        }))
        .sort((a, b) => b.cost_usd - a.cost_usd);

    return {
        kind: 'users_activity',
        rows: args.limit ? rows.slice(0, args.limit) : rows,
        total_users: byUser.size,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Formatter
// ──────────────────────────────────────────────────────────────────────────

export function formatUsersActivity(
    result: UsersActivityResult,
    opts: FormatOpts = {},
): string {
    const format = opts.format ?? 'text';
    const human = format === 'text' || format === 'table' || format === 'markdown';

    const rows: Record<string, unknown>[] = result.rows.map((r) => {
        const cell: Record<string, unknown> = { ...r };
        if (human) cell.cost_usd = fmtUsd(r.cost_usd);
        return cell;
    });

    const columns = [
        'user_id', 'sessions', 'executions',
        'llm_calls', 'input_tokens', 'output_tokens', 'cost_usd',
        'function_calls_total', 'distinct_function_names',
        'function_errors', 'top_level_errors',
        'first_seen', 'last_seen',
    ];
    const body = renderRows(rows, { ...opts, columns });
    if (format === 'json' || format === 'csv') return body;

    const header = `total users: ${result.total_users}`;
    return `${header}\n${body}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function updateSeen(a: { first_seen: string; last_seen: string }, ts: string): void {
    if (!a.first_seen || ts < a.first_seen) a.first_seen = ts;
    if (!a.last_seen || ts > a.last_seen) a.last_seen = ts;
}

function numOrZero(v: unknown): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}
