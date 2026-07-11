/**
 * Error histogram — what's failing, where, and how often.
 *
 * Two error surfaces in one report:
 *
 *   1. `function_error` sub-events inside execution rows. Surfaces failing
 *      tool calls (e.g. the failed `save_log` dream from the function_args
 *      smoke test, the `web_search` 33% failure rate from function_calls).
 *
 *   2. Top-level error events — event_type matching `*error*` (LLM call
 *      failures, voice pipeline errors, app-level errors).
 *
 * Per-signature rollup, where signature is:
 *   - function_error: `function_error:<name>:<short_message>`
 *   - top-level    : `<event_type>:<short_message>`
 *
 * Short messages are first-line + 80 chars max — keeps the histogram from
 * exploding when each instance of "fetch failed: ..." has a different URL.
 */
import type { Client } from 'smartchats-database';
import {
    ERROR_STATUS_CHANGE_EVENT_TYPE,
    type ErrorStatusChangePayload,
    type TriageStatus,
} from 'smartchats-common';

import { signatureHash } from '../analysis/triage_errors.js';
import { type BaseFilter, buildFilterClause, combineWhere } from './_query_helpers.js';
import { type FormatOpts, renderRows } from './_format.js';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface ErrorSignatureRow {
    signature: string;
    /** 16-hex sha256 of `signature`. Stable id for triage marking. */
    signature_hash: string;
    /** Where this error came from. */
    source: 'function_error' | 'top_level_error';
    /** Function name if function_error; event_type otherwise. */
    name: string;
    /** Truncated representative message. */
    message: string;
    /** Total occurrences in the window. */
    count: number;
    distinct_sessions: number;
    distinct_users: number;
    first_seen: string;
    last_seen: string;
    /** Sample session_id pointing at a representative occurrence. */
    sample_session_id: string;
    sample_event_id: string;
    /**
     * Latest triage status for this signature (from `error_status_change`
     * events). Absent when unmarked. `regression=true` when the mark is
     * 'fixed' but `last_seen > fixed_at`.
     */
    handled?: ErrorStatusMark;
}

/** Row-attached triage status for an error signature. Derived from latest event. */
export interface ErrorStatusMark {
    status: TriageStatus;
    fixed_at?: string;
    fixed_in_commit?: string;
    notes?: string;
    marked_at: string;
    marked_by?: string;
    regression: boolean;
}

export interface ErrorsResult {
    kind: 'errors_db';
    rows: ErrorSignatureRow[];
    /** Sum of `count` across all signatures. */
    total_errors: number;
    /** Executions scanned for function_error extraction. */
    executions_scanned: number;
    /** Top-level error rows scanned. */
    top_level_scanned: number;
}

export interface ErrorsArgs extends BaseFilter {
    /** Restrict to one source. Default: both. */
    source?: 'function_error' | 'top_level_error';
    /** Max chars retained for message-signature normalization. Default 80. */
    messageChars?: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Query
// ──────────────────────────────────────────────────────────────────────────

export async function queryErrors(client: Client, args: ErrorsArgs): Promise<ErrorsResult> {
    const messageChars = args.messageChars ?? 80;
    const f = buildFilterClause(args);

    let executions: Array<Record<string, unknown>> = [];
    let topLevel: Array<Record<string, unknown>> = [];

    // ── Pass 1: function_error sub-events inside executions ─────────────
    if (args.source !== 'top_level_error') {
        const whereExec = combineWhere(
            f.where,
            `event_type = 'execution' AND ` +
            `array::len(payload.context.result.events[?type = 'function_error']) > 0`,
        );
        const sql = `
            SELECT
                event_id, session_id, user_id, timestamp,
                payload.context.result.events[?type = 'function_error'] AS errors
            FROM insights_events
            WHERE ${whereExec}
        `;
        const raw = (await client.runQuery({ query: sql, variables: f.vars })) as unknown[];
        executions = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];
    }

    // ── Pass 2: top-level error event types ─────────────────────────────
    // Exclude `error_status_change` explicitly — it's a triage-metadata
    // event that happens to contain the word "error" in its name, but it
    // documents a decision *about* an error, not an error occurrence.
    if (args.source !== 'function_error') {
        const whereErr = combineWhere(
            f.where,
            `string::contains(event_type, 'error') AND event_type != '${ERROR_STATUS_CHANGE_EVENT_TYPE}'`,
        );
        const sql = `
            SELECT event_id, session_id, user_id, timestamp, event_type, payload
            FROM insights_events
            WHERE ${whereErr}
        `;
        const raw = (await client.runQuery({ query: sql, variables: f.vars })) as unknown[];
        topLevel = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];
    }

    // ── Aggregate by signature ──────────────────────────────────────────
    interface Acc {
        signature: string;
        source: 'function_error' | 'top_level_error';
        name: string;
        message: string;
        count: number;
        sessions: Set<string>;
        users: Set<string>;
        first_seen: string;
        last_seen: string;
        sample_session_id: string;
        sample_event_id: string;
    }
    const bySig = new Map<string, Acc>();
    const accFor = (sig: string, init: Omit<Acc, 'count' | 'sessions' | 'users'>): Acc => {
        let a = bySig.get(sig);
        if (!a) {
            a = {
                ...init,
                count: 0,
                sessions: new Set<string>(),
                users: new Set<string>(),
            };
            bySig.set(sig, a);
        }
        return a;
    };

    for (const row of executions) {
        const session_id = String(row.session_id ?? '');
        const user_id = row.user_id == null ? null : String(row.user_id);
        const event_id = String(row.event_id ?? '');
        const ts = String(row.timestamp ?? '');
        const errs = Array.isArray(row.errors) ? (row.errors as Array<Record<string, unknown>>) : [];
        for (const ev of errs) {
            const data = (ev.data ?? {}) as Record<string, unknown>;
            const name = typeof data.name === 'string' ? data.name : '<unknown>';
            const msg = shortenMessage(data.error ?? data.message, messageChars);
            const signature = `function_error:${name}:${msg}`;
            const a = accFor(signature, {
                signature,
                source: 'function_error',
                name,
                message: msg,
                first_seen: ts,
                last_seen: ts,
                sample_session_id: session_id,
                sample_event_id: event_id,
            });
            bumpAcc(a, ts, session_id, user_id, event_id);
        }
    }

    for (const row of topLevel) {
        const session_id = String(row.session_id ?? '');
        const user_id = row.user_id == null ? null : String(row.user_id);
        const event_id = String(row.event_id ?? '');
        const event_type = String(row.event_type ?? '<unknown>');
        const ts = String(row.timestamp ?? '');
        const payload = (row.payload ?? {}) as Record<string, unknown>;
        const msg = shortenMessage(
            payload.error ?? payload.message ?? payload.reason ?? '',
            messageChars,
        );
        const signature = `${event_type}:${msg}`;
        const a = accFor(signature, {
            signature,
            source: 'top_level_error',
            name: event_type,
            message: msg,
            first_seen: ts,
            last_seen: ts,
            sample_session_id: session_id,
            sample_event_id: event_id,
        });
        bumpAcc(a, ts, session_id, user_id, event_id);
    }

    // Build rows + attach signature_hash; then fetch marks for those hashes.
    const preRows = [...bySig.values()].map((a) => ({
        signature: a.signature,
        signature_hash: signatureHash(a.signature),
        source: a.source,
        name: a.name,
        message: a.message,
        count: a.count,
        distinct_sessions: a.sessions.size,
        distinct_users: a.users.size,
        first_seen: a.first_seen,
        last_seen: a.last_seen,
        sample_session_id: a.sample_session_id,
        sample_event_id: a.sample_event_id,
    }));
    const marks = await queryLatestErrorStatusMarks(
        client,
        preRows.map((r) => r.signature_hash),
    );
    const rows: ErrorSignatureRow[] = preRows
        .map<ErrorSignatureRow>((r) => {
            const handled = attachErrorMark(marks.get(r.signature_hash), r.last_seen);
            return handled ? { ...r, handled } : r;
        })
        .sort((a, b) => {
            // Fixed-and-quiet signatures sink to the bottom.
            const aQuiet = a.handled?.status === 'fixed' && !a.handled.regression;
            const bQuiet = b.handled?.status === 'fixed' && !b.handled.regression;
            if (aQuiet && !bQuiet) return 1;
            if (!aQuiet && bQuiet) return -1;
            return b.count - a.count;
        });

    const total = rows.reduce((s, r) => s + r.count, 0);
    return {
        kind: 'errors_db',
        rows: args.limit ? rows.slice(0, args.limit) : rows,
        total_errors: total,
        executions_scanned: executions.length,
        top_level_scanned: topLevel.length,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Status-mark helpers
// ──────────────────────────────────────────────────────────────────────────

/**
 * Pull the LATEST `error_status_change` event per signature_hash. Not
 * time-windowed on marks themselves — a fix from months ago should still
 * mask a recent recurrence. Regression is signaled per-row via
 * last_seen > fixed_at.
 */
export async function queryLatestErrorStatusMarks(
    client: Client,
    signatureHashes: string[],
): Promise<Map<string, ErrorStatusMark>> {
    const out = new Map<string, ErrorStatusMark>();
    if (signatureHashes.length === 0) return out;

    const sql = `
        SELECT event_id, timestamp, payload
        FROM insights_events
        WHERE event_type = $eventType AND payload.signature_hash IN $hashes
        ORDER BY timestamp DESC
    `;
    const raw = (await client.runQuery({
        query: sql,
        variables: { eventType: ERROR_STATUS_CHANGE_EVENT_TYPE, hashes: signatureHashes },
    })) as unknown[];
    const rows = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];

    for (const r of rows) {
        const payload = (r.payload ?? {}) as ErrorStatusChangePayload;
        const hash = payload.signature_hash;
        if (!hash || out.has(hash)) continue;
        out.set(hash, {
            status: payload.status,
            fixed_at: payload.fixed_at,
            fixed_in_commit: payload.fixed_in_commit,
            notes: payload.notes,
            marked_at: String(r.timestamp ?? ''),
            marked_by: payload.marked_by,
            regression: false,
        });
    }
    return out;
}

function attachErrorMark(
    mark: ErrorStatusMark | undefined,
    lastSeen: string,
): ErrorStatusMark | undefined {
    if (!mark) return undefined;
    if (mark.status !== 'fixed' || !mark.fixed_at) return { ...mark, regression: false };
    const regression = Boolean(lastSeen) && lastSeen > mark.fixed_at;
    return { ...mark, regression };
}

// ──────────────────────────────────────────────────────────────────────────
// Formatter
// ──────────────────────────────────────────────────────────────────────────

export function formatErrors(result: ErrorsResult, opts: FormatOpts = {}): string {
    const format = opts.format ?? 'text';

    const rows: Record<string, unknown>[] = result.rows.map((r) => ({
        source: r.source,
        name: r.name,
        message: r.message,
        count: r.count,
        distinct_sessions: r.distinct_sessions,
        distinct_users: r.distinct_users,
        first_seen: r.first_seen,
        last_seen: r.last_seen,
        sample_session_id: r.sample_session_id,
        signature_hash: r.signature_hash,
        handled: r.handled ? formatHandledBadge(r.handled) : '',
    }));

    const columns = [
        'source', 'name', 'message',
        'count', 'distinct_sessions', 'distinct_users',
        'first_seen', 'last_seen', 'sample_session_id',
        'signature_hash', 'handled',
    ];
    const body = renderRows(rows, { ...opts, columns });
    if (format === 'json' || format === 'csv') return body;

    const header = `total errors: ${result.total_errors}   distinct signatures: ${result.rows.length}   (execs scanned: ${result.executions_scanned}, top-level: ${result.top_level_scanned})`;
    return `${header}\n${body}`;
}

/** Short one-cell rendering: "fixed@abc123" / "wontfix" / "REGRESSION!fixed@abc123". */
function formatHandledBadge(m: ErrorStatusMark): string {
    const commit = m.fixed_in_commit ? `@${m.fixed_in_commit.slice(0, 7)}` : '';
    const base = `${m.status}${commit}`;
    return m.regression ? `REGRESSION!${base}` : base;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function shortenMessage(v: unknown, max: number): string {
    if (v === null || v === undefined) return '';
    let s: string;
    if (typeof v === 'string') s = v;
    else { try { s = JSON.stringify(v); } catch { s = String(v); } }
    s = s.split('\n')[0]!.replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

function bumpAcc(
    a: { count: number; sessions: Set<string>; users: Set<string>; first_seen: string; last_seen: string },
    ts: string,
    session_id: string,
    user_id: string | null,
    _event_id: string,
): void {
    a.count += 1;
    if (session_id) a.sessions.add(session_id);
    if (user_id) a.users.add(user_id);
    if (ts && (!a.first_seen || ts < a.first_seen)) a.first_seen = ts;
    if (ts && (!a.last_seen || ts > a.last_seen)) a.last_seen = ts;
}
