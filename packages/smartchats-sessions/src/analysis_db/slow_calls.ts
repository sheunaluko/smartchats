/**
 * Slow function calls — surfaces calls whose `function_end.data.duration`
 * exceeded a threshold. Typical signal: `accumulate_text` blocking for
 * minutes (user paused mid-recording), or the 1-hour iframe sandbox cap
 * tripping on abandoned interactions.
 *
 * Both the projection and the WHERE-side predicate use SurrealQL's array
 * filter on `payload.context.result.events[?...]`, so we don't pull
 * every execution row just to discard most. Only executions that contain
 * at least one slow call come back.
 *
 * Each slow call becomes its own row (flattened from the per-execution
 * sub-event array client-side) — sorting and grouping at the call grain
 * is what users actually want.
 */
import type { Client } from 'smartchats-database';

import { type BaseFilter, buildFilterClause, combineWhere } from './_query_helpers.js';
import { type FormatOpts, renderRows, fmtDuration } from './_format.js';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface SlowCallsArgs extends BaseFilter {
    /**
     * Minimum function duration (ms) to surface. Default 30_000.
     * `accumulate_text` regularly runs >30s legitimately (extended dictations);
     * 60_000 + name filter is often more useful for abandonment detection.
     */
    minDurationMs?: number;
    /**
     * Restrict to specific function names. Comma-separated string or array.
     * Omit to include all functions.
     */
    nameFilter?: string | string[];
}

export interface SlowCallRow {
    /** Parent execution event id. */
    event_id: string;
    session_id: string;
    user_id: string | null;
    /** Execution timestamp (when the agent emitted the code). */
    timestamp: string;
    function_name: string;
    duration_ms: number;
    /** Sub-event call id, useful for joining with function_start args. */
    call_id: string;
    /** Truncated result preview if the result is a string. JSON-stringified for objects. */
    result_preview: string;
}

export interface SlowCallsResult {
    kind: 'slow_calls';
    rows: SlowCallRow[];
    threshold_ms: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Query
// ──────────────────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLD_MS = 30_000;
const DEFAULT_PREVIEW_CHARS = 240;

/**
 * Return every function call whose `function_end.data.duration` crossed
 * `minDurationMs`, sorted newest first. Each slow call is its own row.
 */
export async function querySlowFunctionCalls(
    client: Client,
    args: SlowCallsArgs,
): Promise<SlowCallsResult> {
    const thresholdMs = args.minDurationMs ?? DEFAULT_THRESHOLD_MS;
    const f = buildFilterClause(args);
    const where = combineWhere(
        f.where,
        `event_type = 'execution' AND ` +
        `array::len(payload.context.result.events[?type = 'function_end' AND data.duration > ${thresholdMs}]) > 0`,
    );

    const sql = `
        SELECT
            event_id, session_id, user_id, timestamp,
            payload.context.result.events[?type = 'function_end' AND data.duration > ${thresholdMs}] AS slow_ends
        FROM insights_events
        WHERE ${where}
        ORDER BY timestamp DESC
    `;

    const raw = (await client.runQuery({ query: sql, variables: f.vars })) as unknown[];
    const rows = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];

    const nameSet = parseNameFilter(args.nameFilter);

    const out: SlowCallRow[] = [];
    for (const r of rows) {
        const slowEnds = Array.isArray(r.slow_ends) ? (r.slow_ends as Array<Record<string, unknown>>) : [];
        for (const sub of slowEnds) {
            const data = (sub.data ?? {}) as Record<string, unknown>;
            const name = String(data.name ?? '(unknown)');
            if (nameSet && !nameSet.has(name)) continue;
            out.push({
                event_id: String(r.event_id ?? ''),
                session_id: String(r.session_id ?? ''),
                user_id: r.user_id == null ? null : String(r.user_id),
                timestamp: String(r.timestamp ?? ''),
                function_name: name,
                duration_ms: numOrZero(data.duration),
                call_id: String(data.callId ?? ''),
                result_preview: previewResult(data.result, DEFAULT_PREVIEW_CHARS),
            });
        }
    }

    out.sort((a, b) => b.duration_ms - a.duration_ms);
    return {
        kind: 'slow_calls',
        rows: args.limit ? out.slice(0, args.limit) : out,
        threshold_ms: thresholdMs,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Formatter
// ──────────────────────────────────────────────────────────────────────────

export function formatSlowCalls(result: SlowCallsResult, opts: FormatOpts = {}): string {
    const format = opts.format ?? 'text';
    const humanDuration = format === 'text' || format === 'table' || format === 'markdown';

    const rows: Record<string, unknown>[] = result.rows.map((r) => {
        const cell: Record<string, unknown> = { ...r };
        if (humanDuration && typeof cell.duration_ms === 'number') {
            cell.duration_ms = fmtDuration(cell.duration_ms);
        }
        return cell;
    });

    const columns = ['function_name', 'duration_ms', 'session_id', 'user_id', 'timestamp', 'call_id', 'result_preview'];
    const body = renderRows(rows, { ...opts, columns });

    // Prepend a header for table/text/markdown so the threshold is visible.
    if (format === 'json' || format === 'csv') return body;
    const header = `threshold: > ${fmtDuration(result.threshold_ms)}   matches: ${result.rows.length}`;
    return `${header}\n${body}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function parseNameFilter(nf: string | string[] | undefined): Set<string> | null {
    if (!nf) return null;
    const arr = Array.isArray(nf) ? nf : nf.split(',');
    const cleaned = arr.map((s) => s.trim()).filter(Boolean);
    return cleaned.length === 0 ? null : new Set(cleaned);
}

function numOrZero(v: unknown): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function previewResult(v: unknown, max: number): string {
    if (v === null || v === undefined) return '';
    let s: string;
    if (typeof v === 'string') s = v;
    else { try { s = JSON.stringify(v); } catch { s = String(v); } }
    s = s.replace(/\s+/g, ' ').trim();
    return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
