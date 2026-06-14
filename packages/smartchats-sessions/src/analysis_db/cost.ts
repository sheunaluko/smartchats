/**
 * Cost analysis — per-session, per-model, per-user token + USD rollups.
 *
 * Queries the live `insights_events` table for `llm_invocation` rows,
 * sums each token class (input / output / cached / cache_creation) at the
 * DB layer, then prices each (session, model) tuple client-side via
 * cortex's calculateCost. Cost is summable across tuples (the formula is
 * linear in each token class), so per-session and per-user totals come
 * out correctly even though pricing is per-model.
 *
 * Field provenance (from production probe):
 *   payload.model                                  → string
 *   payload.prompt_tokens                          → input tokens
 *   payload.completion_tokens                      → output tokens
 *   payload.context.cached_input_tokens            → cached portion
 *   payload.context.cache_creation_input_tokens    → cache_creation portion
 *   payload.latency_ms                             → wall clock
 */
import { calculateCost } from 'cortex';
import type { Client } from 'smartchats-database';

import { type BaseFilter, buildFilterClause, combineWhere } from './_query_helpers.js';
import { type FormatOpts, renderRows, fmtUsd } from './_format.js';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

/**
 * One (session, model) tuple. The atomic unit before any aggregation —
 * higher-level rollups sum these.
 */
export interface CostByCallTupleRow {
    session_id: string;
    user_id: string | null;
    model: string;
    llm_calls: number;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    cache_creation_input_tokens: number;
    cost_usd: number;
    max_latency_ms: number;
}

export interface CostBySessionRow {
    session_id: string;
    user_id: string | null;
    llm_calls: number;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    cache_creation_input_tokens: number;
    cost_usd: number;
    /** Distinct models the session used. Most sessions = 1. */
    models: string[];
    max_latency_ms: number;
}

export interface CostByModelRow {
    model: string;
    llm_calls: number;
    sessions: number;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    cache_creation_input_tokens: number;
    cost_usd: number;
    max_latency_ms: number;
}

export interface CostByUserRow {
    user_id: string;
    llm_calls: number;
    sessions: number;
    input_tokens: number;
    output_tokens: number;
    cached_input_tokens: number;
    cache_creation_input_tokens: number;
    cost_usd: number;
    models: string[];
}

/** Discriminated union for the formatter. */
export type CostResult =
    | { kind: 'by_session'; rows: CostBySessionRow[] }
    | { kind: 'by_model'; rows: CostByModelRow[] }
    | { kind: 'by_user'; rows: CostByUserRow[] }
    | { kind: 'by_call_tuple'; rows: CostByCallTupleRow[] };

// ──────────────────────────────────────────────────────────────────────────
// Core: per-(session, model) tuple query — every higher-level rollup
// reduces from this.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Per-(session, model) tuple rows. The granular shape — useful directly
 * for debugging "which model did this session use and what did it cost",
 * and the source data for queryCostBySession / queryCostByModel /
 * queryCostByUser.
 */
export async function queryCostByCallTuple(
    client: Client,
    filter: BaseFilter,
): Promise<CostByCallTupleRow[]> {
    const f = buildFilterClause(filter);
    const where = combineWhere(f.where, `event_type = 'llm_invocation'`);
    const limitClause = f.limit ? ` LIMIT ${f.limit}` : '';

    const sql = `
        SELECT
            session_id,
            user_id,
            payload.model AS model,
            count() AS llm_calls,
            math::sum(payload.prompt_tokens ?? 0) AS input_tokens,
            math::sum(payload.completion_tokens ?? 0) AS output_tokens,
            math::sum(payload.context.cached_input_tokens ?? 0) AS cached_input_tokens,
            math::sum(payload.context.cache_creation_input_tokens ?? 0) AS cache_creation_input_tokens,
            math::max(payload.latency_ms ?? 0) AS max_latency_ms
        FROM insights_events
        WHERE ${where}
        GROUP BY session_id, user_id, model
    `;

    const raw = (await client.runQuery({ query: sql, variables: f.vars })) as unknown[];
    const rows = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];

    const out: CostByCallTupleRow[] = [];
    for (const r of rows) {
        const model = String(r.model ?? '(unknown)');
        const input_tokens = num(r.input_tokens);
        const output_tokens = num(r.output_tokens);
        const cached = num(r.cached_input_tokens);
        const creation = num(r.cache_creation_input_tokens);
        const cost_usd = calculateCost(model, {
            input_tokens,
            output_tokens,
            cached_input_tokens: cached,
            cache_creation_input_tokens: creation,
        });
        out.push({
            session_id: String(r.session_id ?? ''),
            user_id: r.user_id == null ? null : String(r.user_id),
            model,
            llm_calls: num(r.llm_calls),
            input_tokens,
            output_tokens,
            cached_input_tokens: cached,
            cache_creation_input_tokens: creation,
            cost_usd: round5(cost_usd),
            max_latency_ms: num(r.max_latency_ms),
        });
    }

    if (filter.limit) return out.slice(0, filter.limit);
    return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Rollups — reduce per-tuple rows to the requested aggregation
// ──────────────────────────────────────────────────────────────────────────

/** Per-session cost rollup, sorted by cost descending. */
export async function queryCostBySession(
    client: Client,
    filter: BaseFilter,
): Promise<CostBySessionRow[]> {
    // Don't push limit down to the tuple query — the tuple LIMIT would
    // truncate before aggregation. Apply limit after the rollup.
    const tuples = await queryCostByCallTuple(client, { ...filter, limit: undefined });

    const bySession = new Map<string, CostBySessionRow>();
    for (const t of tuples) {
        let row = bySession.get(t.session_id);
        if (!row) {
            row = {
                session_id: t.session_id,
                user_id: t.user_id,
                llm_calls: 0,
                input_tokens: 0,
                output_tokens: 0,
                cached_input_tokens: 0,
                cache_creation_input_tokens: 0,
                cost_usd: 0,
                models: [],
                max_latency_ms: 0,
            };
            bySession.set(t.session_id, row);
        }
        row.llm_calls += t.llm_calls;
        row.input_tokens += t.input_tokens;
        row.output_tokens += t.output_tokens;
        row.cached_input_tokens += t.cached_input_tokens;
        row.cache_creation_input_tokens += t.cache_creation_input_tokens;
        row.cost_usd += t.cost_usd;
        if (!row.models.includes(t.model)) row.models.push(t.model);
        if (t.max_latency_ms > row.max_latency_ms) row.max_latency_ms = t.max_latency_ms;
    }

    const out = [...bySession.values()].map((r) => ({ ...r, cost_usd: round5(r.cost_usd) }));
    out.sort((a, b) => b.cost_usd - a.cost_usd);
    return filter.limit ? out.slice(0, filter.limit) : out;
}

/** Per-model cost rollup, sorted by cost descending. */
export async function queryCostByModel(
    client: Client,
    filter: BaseFilter,
): Promise<CostByModelRow[]> {
    const tuples = await queryCostByCallTuple(client, { ...filter, limit: undefined });

    const byModel = new Map<string, CostByModelRow & { _sessions: Set<string> }>();
    for (const t of tuples) {
        let row = byModel.get(t.model);
        if (!row) {
            row = {
                model: t.model,
                llm_calls: 0,
                sessions: 0,
                input_tokens: 0,
                output_tokens: 0,
                cached_input_tokens: 0,
                cache_creation_input_tokens: 0,
                cost_usd: 0,
                max_latency_ms: 0,
                _sessions: new Set<string>(),
            };
            byModel.set(t.model, row);
        }
        row.llm_calls += t.llm_calls;
        row.input_tokens += t.input_tokens;
        row.output_tokens += t.output_tokens;
        row.cached_input_tokens += t.cached_input_tokens;
        row.cache_creation_input_tokens += t.cache_creation_input_tokens;
        row.cost_usd += t.cost_usd;
        row._sessions.add(t.session_id);
        if (t.max_latency_ms > row.max_latency_ms) row.max_latency_ms = t.max_latency_ms;
    }

    const out: CostByModelRow[] = [...byModel.values()].map(({ _sessions, ...r }) => ({
        ...r,
        sessions: _sessions.size,
        cost_usd: round5(r.cost_usd),
    }));
    out.sort((a, b) => b.cost_usd - a.cost_usd);
    return filter.limit ? out.slice(0, filter.limit) : out;
}

/** Per-user cost rollup, sorted by cost descending. */
export async function queryCostByUser(
    client: Client,
    filter: BaseFilter,
): Promise<CostByUserRow[]> {
    const tuples = await queryCostByCallTuple(client, { ...filter, limit: undefined });

    const byUser = new Map<string, CostByUserRow & { _sessions: Set<string> }>();
    for (const t of tuples) {
        if (t.user_id == null) continue;  // skip anonymous calls
        let row = byUser.get(t.user_id);
        if (!row) {
            row = {
                user_id: t.user_id,
                llm_calls: 0,
                sessions: 0,
                input_tokens: 0,
                output_tokens: 0,
                cached_input_tokens: 0,
                cache_creation_input_tokens: 0,
                cost_usd: 0,
                models: [],
                _sessions: new Set<string>(),
            };
            byUser.set(t.user_id, row);
        }
        row.llm_calls += t.llm_calls;
        row.input_tokens += t.input_tokens;
        row.output_tokens += t.output_tokens;
        row.cached_input_tokens += t.cached_input_tokens;
        row.cache_creation_input_tokens += t.cache_creation_input_tokens;
        row.cost_usd += t.cost_usd;
        if (!row.models.includes(t.model)) row.models.push(t.model);
        row._sessions.add(t.session_id);
    }

    const out: CostByUserRow[] = [...byUser.values()].map(({ _sessions, ...r }) => ({
        ...r,
        sessions: _sessions.size,
        cost_usd: round5(r.cost_usd),
    }));
    out.sort((a, b) => b.cost_usd - a.cost_usd);
    return filter.limit ? out.slice(0, filter.limit) : out;
}

// ──────────────────────────────────────────────────────────────────────────
// Formatter
// ──────────────────────────────────────────────────────────────────────────

export function formatCost(result: CostResult, opts: FormatOpts = {}): string {
    // For text / table / markdown — pre-format cost_usd as a $ string for
    // human readability. For json / csv — leave numeric for machine consumption.
    const format = opts.format ?? 'text';
    const needsHumanCost = format === 'text' || format === 'table' || format === 'markdown';

    const rows: Record<string, unknown>[] = result.rows.map((r) => {
        const cell: Record<string, unknown> = { ...r };
        if (needsHumanCost && typeof cell.cost_usd === 'number') {
            cell.cost_usd = fmtUsd(cell.cost_usd);
        }
        if (Array.isArray(cell.models) && needsHumanCost) {
            cell.models = (cell.models as string[]).join(', ');
        }
        return cell;
    });

    // Stable column order per rollup kind.
    const columns =
        result.kind === 'by_session' ? ['session_id', 'user_id', 'cost_usd', 'llm_calls', 'input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_creation_input_tokens', 'models', 'max_latency_ms']
      : result.kind === 'by_model'   ? ['model', 'cost_usd', 'sessions', 'llm_calls', 'input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_creation_input_tokens', 'max_latency_ms']
      : result.kind === 'by_user'    ? ['user_id', 'cost_usd', 'sessions', 'llm_calls', 'input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_creation_input_tokens', 'models']
      :                                ['session_id', 'user_id', 'model', 'cost_usd', 'llm_calls', 'input_tokens', 'output_tokens', 'cached_input_tokens', 'cache_creation_input_tokens', 'max_latency_ms'];

    return renderRows(rows, { ...opts, columns });
}

// ──────────────────────────────────────────────────────────────────────────
// Local helpers
// ──────────────────────────────────────────────────────────────────────────

function num(v: unknown): number {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (typeof v === 'string') {
        const n = Number(v);
        return Number.isFinite(n) ? n : 0;
    }
    return 0;
}

function round5(n: number): number {
    return Math.round(n * 100_000) / 100_000;
}
