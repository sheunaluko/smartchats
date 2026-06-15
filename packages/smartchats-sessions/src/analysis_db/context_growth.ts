/**
 * Prompt-size outlier detection across llm_invocation events.
 *
 * Two views over the same pull:
 *
 *   `absolute` — sort llm_invocations by input_tokens descending. Finds
 *     the largest contexts ever sent to the model. Useful for the "what
 *     was the heaviest prompt we sent?" question.
 *
 *   `jump`     — within each session, compute the delta from the previous
 *     llm_invocation's input_tokens; sort by delta. Finds where context
 *     suddenly ballooned vs the turn before. Useful for "which turn was
 *     it that made our context explode?" — the upstream of the issue
 *     events SCM will eventually emit.
 *
 * This is the surrogate analyzer for issue-event-based context_bloat
 * detection until smartchats-common ships the `issue` event spec.
 */
import type { Client } from 'smartchats-database';

import { type BaseFilter, buildFilterClause, combineWhere } from './_query_helpers.js';
import { type FormatOpts, renderRows } from './_format.js';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface ContextGrowthArgs extends BaseFilter {
    /** 'absolute' (default) or 'jump'. */
    by?: 'absolute' | 'jump';
    /** Floor on the sort key — events below this are excluded. Default 0. */
    minTokens?: number;
}

export interface ContextGrowthRow {
    event_id: string;
    session_id: string;
    user_id: string | null;
    timestamp: string;
    model: string;
    input_tokens: number;
    output_tokens: number;
    /** Delta vs previous llm_invocation in the same session. 0 for first-in-session. */
    jump_from_prev: number;
    /** Previous llm_invocation's input_tokens. 0 for first-in-session. */
    prev_input_tokens: number;
    /** Previous llm_invocation's event_id. Empty for first-in-session. */
    prev_event_id: string;
}

export interface ContextGrowthResult {
    kind: 'context_growth';
    rows: ContextGrowthRow[];
    by: 'absolute' | 'jump';
    /** Total llm_invocations scanned. */
    invocations_scanned: number;
    /** Distinct sessions covered. */
    sessions_scanned: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Query
// ──────────────────────────────────────────────────────────────────────────

export async function queryContextGrowth(
    client: Client,
    args: ContextGrowthArgs,
): Promise<ContextGrowthResult> {
    const by = args.by ?? 'absolute';
    const minTokens = args.minTokens ?? 0;
    const f = buildFilterClause(args);

    // Pull every llm_invocation in the window. We need to walk events per
    // session in timestamp order to compute jumps, so we sort client-side
    // (SurrealDB rejects ORDER BY against this schemaless table — strict
    // mode requires defined fields).
    const sql = `
        SELECT
            event_id, session_id, user_id, timestamp,
            payload.model AS model,
            payload.prompt_tokens AS input_tokens,
            payload.completion_tokens AS output_tokens
        FROM insights_events
        WHERE ${combineWhere(f.where, `event_type = 'llm_invocation'`)}
    `;
    const raw = (await client.runQuery({ query: sql, variables: f.vars })) as unknown[];
    const rows = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];

    rows.sort((a, b) => {
        const sa = String(a.session_id ?? '');
        const sb = String(b.session_id ?? '');
        if (sa !== sb) return sa < sb ? -1 : 1;
        const ta = String(a.timestamp ?? '');
        const tb = String(b.timestamp ?? '');
        return ta < tb ? -1 : ta > tb ? 1 : 0;
    });

    const sessions = new Set<string>();
    let prevSessionId: string | null = null;
    let prevInputTokens = 0;
    let prevEventId = '';

    const enriched: ContextGrowthRow[] = [];
    for (const r of rows) {
        const session_id = String(r.session_id ?? '');
        const input_tokens = numOrZero(r.input_tokens);
        const event_id = String(r.event_id ?? '');

        sessions.add(session_id);

        const isFirstInSession = session_id !== prevSessionId;
        const jump = isFirstInSession ? 0 : input_tokens - prevInputTokens;

        enriched.push({
            event_id,
            session_id,
            user_id: r.user_id == null ? null : String(r.user_id),
            timestamp: String(r.timestamp ?? ''),
            model: String(r.model ?? ''),
            input_tokens,
            output_tokens: numOrZero(r.output_tokens),
            jump_from_prev: jump,
            prev_input_tokens: isFirstInSession ? 0 : prevInputTokens,
            prev_event_id: isFirstInSession ? '' : prevEventId,
        });

        prevSessionId = session_id;
        prevInputTokens = input_tokens;
        prevEventId = event_id;
    }

    // Sort by the requested axis (desc), apply minTokens floor, then limit.
    const sortKey = (r: ContextGrowthRow): number =>
        by === 'jump' ? r.jump_from_prev : r.input_tokens;

    const filtered = enriched.filter((r) => sortKey(r) >= minTokens);
    filtered.sort((a, b) => sortKey(b) - sortKey(a));

    return {
        kind: 'context_growth',
        rows: args.limit ? filtered.slice(0, args.limit) : filtered,
        by,
        invocations_scanned: rows.length,
        sessions_scanned: sessions.size,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Formatter
// ──────────────────────────────────────────────────────────────────────────

export function formatContextGrowth(
    result: ContextGrowthResult,
    opts: FormatOpts = {},
): string {
    const format = opts.format ?? 'text';

    const rows: Record<string, unknown>[] = result.rows.map((r) => ({ ...r }));

    const columns = result.by === 'jump'
        ? ['timestamp', 'session_id', 'model', 'prev_input_tokens', 'input_tokens', 'jump_from_prev', 'event_id']
        : ['timestamp', 'session_id', 'model', 'input_tokens', 'output_tokens', 'jump_from_prev', 'event_id'];

    const body = renderRows(rows, { ...opts, columns });
    if (format === 'json' || format === 'csv') return body;

    const header = `by: ${result.by}   invocations scanned: ${result.invocations_scanned}   sessions: ${result.sessions_scanned}   matches: ${result.rows.length}`;
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
