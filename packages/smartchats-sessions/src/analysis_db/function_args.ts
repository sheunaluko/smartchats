/**
 * Function-call lookup by name + args predicate.
 *
 * "Show me every `save_log` call with `category='dreams'`" — the kind of
 * targeted lookup that's expensive over bundles but trivial against the
 * DB once you know the array-filter pattern.
 *
 * Predicate approach:
 *   - DB-side: `WHERE array::any(events[?type='function_start' AND
 *     data.name=$name], ...) > 0` — restricts to executions that called
 *     this function at least once. Cheap.
 *   - JS-side: per-execution, iterate function_start sub-events; for each
 *     matching the name + every arg key=value predicate, emit a row. Pair
 *     with the function_end by callId for duration/result. Pair with
 *     function_error if present to flag the row.
 *
 * Args predicate semantics:
 *   The cortex function-call shape is `fn({key: value, ...})` — one
 *   positional arg object. So `data.args = [{...}]` (array of length 1).
 *   We predicate against `data.args[0][key] === value`. String comparison
 *   only for v1 (most match cases are categories / metric names / event
 *   kinds). Numeric / boolean parsing left for a follow-on if needed.
 */
import type { Client } from 'smartchats-database';

import { type BaseFilter, buildFilterClause, combineWhere } from './_query_helpers.js';
import { type FormatOpts, renderRows, fmtDuration } from './_format.js';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface ArgPredicate {
    /** Key in the function's args object (or dot-path: `nested.field`). */
    key: string;
    /** Value to equality-match. String comparison. */
    value: string;
}

export interface FunctionArgsArgs extends BaseFilter {
    /** Function name to match. Required. */
    name: string;
    /** Optional set of args predicates. ALL must match for a call to qualify. */
    args?: ArgPredicate[];
}

export interface FunctionArgsCallRow {
    /** Parent execution event id. */
    event_id: string;
    session_id: string;
    user_id: string | null;
    timestamp: string;
    function_name: string;
    call_id: string;
    /** The args object the agent passed (args[0]). */
    args: Record<string, unknown> | null;
    /** Paired function_end duration. 0 if no matching function_end was emitted. */
    duration_ms: number;
    /** Function-end result, JSON-stringified + truncated. */
    result_preview: string;
    errored: boolean;
    /** function_error message if errored. */
    error_message: string;
}

export interface FunctionArgsResult {
    kind: 'function_args_calls';
    rows: FunctionArgsCallRow[];
    name: string;
    predicates: ArgPredicate[];
}

// ──────────────────────────────────────────────────────────────────────────
// Query
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_PREVIEW_CHARS = 240;

export async function queryFunctionCallsByArgs(
    client: Client,
    args: FunctionArgsArgs,
): Promise<FunctionArgsResult> {
    if (!args.name) {
        throw new Error(`queryFunctionCallsByArgs: 'name' is required`);
    }

    const f = buildFilterClause(args);
    // DB-side predicate: only pull executions whose sub-events include at
    // least one function_start with the target name. The args predicates
    // get applied JS-side because nested array-of-object filtering against
    // arbitrary keys is awkward to template safely in SurrealQL.
    const where = combineWhere(
        f.where,
        `event_type = 'execution' AND ` +
        `array::len(payload.context.result.events[?type = 'function_start' AND data.name = $fnName]) > 0`,
    );

    const sql = `
        SELECT
            event_id, session_id, user_id, timestamp,
            payload.context.result.events AS sub_events
        FROM insights_events
        WHERE ${where}
        ORDER BY timestamp DESC
    `;

    const raw = (await client.runQuery({
        query: sql,
        variables: { ...f.vars, fnName: args.name },
    })) as unknown[];
    const rows = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];

    const predicates = args.args ?? [];

    const out: FunctionArgsCallRow[] = [];
    for (const r of rows) {
        const sub = Array.isArray(r.sub_events) ? (r.sub_events as Array<Record<string, unknown>>) : [];

        // Index function_end and function_error by callId for pairing.
        const endsByCallId = new Map<string, Record<string, unknown>>();
        const errorsByCallId = new Map<string, Record<string, unknown>>();
        for (const ev of sub) {
            const t = ev.type;
            const data = (ev.data ?? {}) as Record<string, unknown>;
            const callId = typeof data.callId === 'string' ? data.callId : null;
            if (!callId) continue;
            if (t === 'function_end') endsByCallId.set(callId, data);
            else if (t === 'function_error') errorsByCallId.set(callId, data);
        }

        for (const ev of sub) {
            if (ev.type !== 'function_start') continue;
            const data = (ev.data ?? {}) as Record<string, unknown>;
            if (data.name !== args.name) continue;

            // args is [{...}]; args[0] is the positional arg object.
            const argsArr = Array.isArray(data.args) ? (data.args as unknown[]) : [];
            const argsObj = argsArr[0] && typeof argsArr[0] === 'object'
                ? (argsArr[0] as Record<string, unknown>)
                : null;

            if (!matchesAllPredicates(argsObj, predicates)) continue;

            const callId = typeof data.callId === 'string' ? data.callId : '';
            const end = callId ? endsByCallId.get(callId) : undefined;
            const error = callId ? errorsByCallId.get(callId) : undefined;

            out.push({
                event_id: String(r.event_id ?? ''),
                session_id: String(r.session_id ?? ''),
                user_id: r.user_id == null ? null : String(r.user_id),
                timestamp: String(r.timestamp ?? ''),
                function_name: args.name,
                call_id: callId,
                args: argsObj,
                duration_ms: end ? numOrZero(end.duration) : 0,
                result_preview: end ? previewValue(end.result, DEFAULT_PREVIEW_CHARS) : '',
                errored: !!error,
                error_message: error ? String(error.error ?? '') : '',
            });
        }
    }

    return {
        kind: 'function_args_calls',
        rows: args.limit ? out.slice(0, args.limit) : out,
        name: args.name,
        predicates,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Formatter
// ──────────────────────────────────────────────────────────────────────────

export function formatFunctionArgsCalls(
    result: FunctionArgsResult,
    opts: FormatOpts = {},
): string {
    const format = opts.format ?? 'text';
    const human = format === 'text' || format === 'table' || format === 'markdown';

    const rows: Record<string, unknown>[] = result.rows.map((r) => {
        const cell: Record<string, unknown> = { ...r };
        if (human) {
            cell.duration_ms = fmtDuration(r.duration_ms);
            cell.args = compactJson(r.args, opts.truncate ?? 80);
        }
        return cell;
    });

    const columns = ['timestamp', 'session_id', 'user_id', 'args', 'duration_ms', 'errored', 'result_preview'];
    const body = renderRows(rows, { ...opts, columns });
    if (format === 'json' || format === 'csv') return body;

    const predStr = result.predicates.length === 0
        ? '(no args predicates)'
        : result.predicates.map((p) => `${p.key}=${p.value}`).join(' AND ');
    const header = `name: ${result.name}   predicates: ${predStr}   matches: ${result.rows.length}`;
    return `${header}\n${body}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function matchesAllPredicates(
    args: Record<string, unknown> | null,
    predicates: ArgPredicate[],
): boolean {
    if (predicates.length === 0) return true;
    if (!args) return false;
    for (const p of predicates) {
        const v = getDotPath(args, p.key);
        if (v === undefined) return false;
        if (String(v) !== p.value) return false;
    }
    return true;
}

function getDotPath(obj: Record<string, unknown>, path: string): unknown {
    if (!path.includes('.')) return obj[path];
    let cur: unknown = obj;
    for (const part of path.split('.')) {
        if (cur === null || typeof cur !== 'object') return undefined;
        cur = (cur as Record<string, unknown>)[part];
    }
    return cur;
}

function numOrZero(v: unknown): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function previewValue(v: unknown, max: number): string {
    if (v === null || v === undefined) return '';
    let s: string;
    if (typeof v === 'string') s = v;
    else { try { s = JSON.stringify(v); } catch { s = String(v); } }
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function compactJson(v: unknown, max: number): string {
    if (v === null || v === undefined) return '';
    let s: string;
    try { s = JSON.stringify(v); } catch { s = String(v); }
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
