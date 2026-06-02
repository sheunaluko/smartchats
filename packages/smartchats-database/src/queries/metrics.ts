/**
 * Metrics query builders.
 *
 * Metrics rows are quantitative tracking entries (e.g. exercise reps,
 * water intake) with a metric_name, numeric value, unit, and category.
 * Queries that filter by date use `lts` (local wall-clock) so day
 * buckets align with the user's perceived timing. The legacy `timestamp`
 * field is retained for reference but `lts` is the canonical sort key.
 */

import type { QuerySpec, AuditFields, EventTimeFields } from '../types.js';

export interface MetricRow extends AuditFields {
    id: string;
    metric_name: string;
    value: number;
    unit?: string;
    category?: string;
    /** Real-UTC timestamp (legacy; use lts for user-time semantics). */
    timestamp?: string;
    source_text?: string;
    note?: string;
}

export interface GetMetricsArgs {
    metric_name?: string;
    category?: string;
    /** ISO date YYYY-MM-DD; matches lts >= date 00:00 (local). */
    from_date?: string;
    /** ISO date YYYY-MM-DD; matches lts <= date 23:59:59 (local). */
    to_date?: string;
    limit?: number;
}

/**
 * Tracked metrics with optional date-range and metric-name filters.
 * Sort is by `lts` so users see entries in their wall-clock order.
 */
export function getMetrics(args: GetMetricsArgs = {}): QuerySpec {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    const conditions: string[] = [];
    const variables: Record<string, unknown> = {};

    if (args.metric_name) {
        conditions.push('metric_name = $metric_name');
        variables.metric_name = args.metric_name;
    }
    if (args.category) {
        conditions.push('category = $category');
        variables.category = args.category;
    }
    if (args.from_date) {
        conditions.push(`lts >= d'${args.from_date}T00:00:00Z'`);
    }
    if (args.to_date) {
        conditions.push(`lts <= d'${args.to_date}T23:59:59Z'`);
    }

    const where = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';
    return {
        query: `SELECT id, metric_name, value, unit, category, timestamp, lts, source_text, note FROM metrics ${where} ORDER BY lts DESC LIMIT ${limit}`,
        variables,
    };
}

/**
 * Per-metric summary: name, unit, category, metric_type, entry count,
 * min/max value. `metric_type` is included in both the projection and
 * GROUP BY so the in-app prefetch path can distinguish boolean habits
 * from numeric metrics; the MCP consumer ignores it. A given metric_name
 * is 1:1 with metric_type in practice, so adding it to GROUP BY does not
 * split rows that previously merged.
 *
 * Single canonical builder — replaces the previous `getMetricsSummary`
 * (which omitted metric_type) and `getMetricsSummaryWithType` (which
 * included it). The survivor is the wider projection so neither consumer
 * loses data.
 */
export function getMetricsSummary(): QuerySpec {
    return {
        query: `SELECT metric_name, unit, category, metric_type, count() AS entry_count, math::max(value) AS max_value, math::min(value) AS min_value FROM metrics GROUP BY metric_name, unit, category, metric_type`,
        variables: {},
    };
}

/**
 * Recent metric entries, full row. Pairs with `getMetricsSummary` to give
 * an LLM consumer both the structure and fresh examples in one round trip.
 * Also used by the in-app metrics-context prefetch.
 *
 * Sort is `lts DESC` (logical timestamp, app-stamped, survives bundle
 * export/import — matches the dual-timestamp invariant).
 *
 * `limit`: omit to fetch all rows; pass a number to cap. The MCP tool and
 * the in-app prefetch currently omit it (full visualization needs every
 * data point); LLM-facing callers should set it to keep context bounded.
 */
export function getRecentMetrics(opts: { limit?: number } = {}): QuerySpec {
    const limitClause = opts.limit !== undefined ? ` LIMIT ${Math.max(1, Math.floor(opts.limit))}` : '';
    return {
        query: `SELECT * FROM metrics ORDER BY lts DESC${limitClause}`,
        variables: {},
    };
}

/**
 * Fetch all `metric_definition` rows from `user_data` — metrics the
 * user has prepared but hasn't yet recorded data for. Merged into the
 * tracked-metrics summary in the in-app prefetch.
 */
export function getPreparedMetricDefinitions(): QuerySpec {
    return {
        query: `SELECT * FROM user_data WHERE type = 'metric_definition'`,
        variables: {},
    };
}

// ── Insert metric ──────────────────────────────────────────────────────────

export interface InsertMetricArgs extends EventTimeFields {
    metric_name: string;
    value: number;
    unit: string;
    metric_type: string;
    source: string;
    source_text: string;
    source_log_id: string | null;
    category: string;
    time_shift_quantity: number | null;
    time_shift_unit: string | null;
    note: string | null;
}

/**
 * INSERT a new metric row. The legacy `timestamp` column is populated
 * from the bundle's `$ts` (real-UTC instant — same semantics, kept under
 * the historical column name for backward compat with readers). `lts` is
 * dual-written during the 1.5.0 → 1.6.0 window.
 */
export function insertMetric(args: InsertMetricArgs): QuerySpec {
    return {
        query: `INSERT INTO metrics {
                        metric_name: $metric_name,
                        value: $value,
                        unit: $unit,
                        metric_type: $metric_type,
                        timestamp: <datetime> $ts,
                        lts: <datetime> $lts,
                        local_date: $local_date,
                        local_tz: $local_tz,
                        source: $source,
                        source_text: $source_text,
                        source_log_id: $source_log_id,
                        category: $category,
                        time_shift_quantity: $time_shift_quantity,
                        time_shift_unit: $time_shift_unit,
                        note: $note,
                        created_at: time::now()
                    }`,
        variables: { ...args },
    };
}

// ── Habit summary helper ──────────────────────────────────────────────────

/**
 * Fetch the `lts` of every "done" entry (value >= 1) for a metric within
 * a date range. The caller pre-builds the lts filter via `buildMetricsLtsFilter`
 * (the date-literal form requires the filter to be inlined as raw SurrealQL).
 */
export function getHabitDoneTimestamps(args: { metric_name: string; ltsFilter: string }): QuerySpec {
    return {
        query: `SELECT lts FROM metrics WHERE metric_name = $metric_name AND value >= 1 AND ${args.ltsFilter} ORDER BY lts ASC`,
        variables: { metric_name: args.metric_name },
    };
}

// ── Prepared metric lifecycle ─────────────────────────────────────────────

/**
 * Look up whether a metric_name already has at least one data entry.
 * Used by `prepare_metric` to short-circuit "already tracked" responses.
 */
export function findMetricByName(metric_name: string): QuerySpec {
    return {
        query: `SELECT metric_name FROM metrics WHERE metric_name = $name LIMIT 1`,
        variables: { name: metric_name },
    };
}

/**
 * Look up a `metric_definition` row by metric_name — detects whether
 * the metric has already been prepared.
 */
export function findPreparedMetric(metric_name: string): QuerySpec {
    return {
        query: `SELECT * FROM user_data WHERE type = 'metric_definition' AND data.metric_name = $name LIMIT 1`,
        variables: { name: metric_name },
    };
}

/**
 * INSERT a new `metric_definition` row — registers a metric the user
 * wants to track but hasn't recorded data for yet.
 */
export interface InsertPreparedMetricArgs {
    metric_name: string;
    unit: string;
    metric_type: string;
    category: string;
}
export function insertPreparedMetric(args: InsertPreparedMetricArgs): QuerySpec {
    return {
        query: `INSERT INTO user_data {
                            type: 'metric_definition',
                            data: {
                                metric_name: $metric_name,
                                unit: $unit,
                                metric_type: $metric_type,
                                category: $category
                            },
                            created_at: time::now()
                        }`,
        variables: { ...args },
    };
}

// ── Dynamic chart query (display_metrics / retrieve_metrics) ───────────────

/**
 * Spec for `buildMetricsQuery` — collected from the agent's
 * `display_metrics` / `retrieve_metrics` invocations.
 */
export interface MetricsQuerySpec {
    metric_name: string;
    /** Multiple metrics for grouped display. */
    metric_names?: string[];
    /** 'combined' (default) or 'stacked'. */
    group_mode?: 'combined' | 'stacked';
    // Date filtering (priority: date > from_date/to_date > recency > date_range)
    /** Single local day: "today", "yesterday", "2026-03-23" */
    date?: string;
    /** Local date range start: "2026-03-23" */
    from_date?: string;
    /** Local date range end: "2026-03-30" (defaults to today) */
    to_date?: string;
    /** Duration: "30s", "5m", "3h", "2d", "1w", "1y" */
    recency?: string;
    /** Duration (default "4w"): "30d", "4w", "1y" */
    date_range?: string;
    aggregation?: string;
    presentation?: string;
    title?: string;
    time_mode?: 'sparse' | 'dense';
}

/** Duration units to milliseconds */
const DURATION_MS: Record<string, number> = {
    s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, y: 31536000000
};

/**
 * Helpers the caller injects so the date-resolution stays tz-aware
 * without this module taking a dependency on the in-app system module.
 */
export interface MetricsLtsFilterCtx {
    /** Returns "YYYY-MM-DD" for "today" in the user's tz. */
    getCurrentLocalDate: (tz: string) => string;
    /** Stringifies a Date in the user's tz as a fake-UTC ISO with `Z`. */
    toLocalTimestamp: (d: Date, tz: string) => string;
}

/**
 * Build an lts-based date filter for metrics queries.
 * All modes filter on lts (local fake-UTC) for correct local day/time boundaries.
 *
 * Priority: date > from_date/to_date > recency > date_range
 *
 * Returned as a raw SurrealQL fragment because date literals are inlined
 * as `d'...'` (matches historical in-app behavior — switching to
 * parameter-bound `<datetime> $...` would change semantics).
 */
export function buildMetricsLtsFilter(
    params: {
        date?: string;
        from_date?: string;
        to_date?: string;
        recency?: string;
        date_range?: string;
    },
    tz: string,
    ctx: MetricsLtsFilterCtx,
): string {
    // 1. Single date ("today", "yesterday", or "2026-03-23")
    if (params.date) {
        let d = params.date;
        if (d === 'today') d = ctx.getCurrentLocalDate(tz);
        else if (d === 'yesterday') {
            const y = new Date(Date.now() - 86400000);
            d = y.toLocaleDateString('sv-SE', { timeZone: tz });
        }
        return `lts >= d'${d}T00:00:00Z' AND lts <= d'${d}T23:59:59Z'`;
    }

    // 2. Date range (absolute local dates)
    if (params.from_date) {
        const to = params.to_date || ctx.getCurrentLocalDate(tz);
        return `lts >= d'${params.from_date}T00:00:00Z' AND lts <= d'${to}T23:59:59Z'`;
    }

    // 3. Recency or date_range — both parse duration to lts cutoff
    const dur = params.recency || params.date_range || '4w';
    const match = dur.match(/^(\d+)(s|m|h|d|w|y)$/);
    if (!match) throw new Error(`Invalid duration format: "${dur}". Use e.g. "30s", "5m", "3h", "2d", "4w", "1y".`);
    const ms = parseInt(match[1]) * DURATION_MS[match[2]];
    const cutoff = ctx.toLocalTimestamp(new Date(Date.now() - ms), tz);
    return `lts >= d'${cutoff}'`;
}

/** Map aggregation mode string to SurrealQL math function */
function getSurrealAggFn(mode: string): string {
    switch (mode) {
        case 'sum': return 'math::sum(value)';
        case 'max': return 'math::max(value)';
        case 'min': return 'math::min(value)';
        case 'avg': return 'math::mean(value)';
        case 'latest': return 'math::max(value)'; // approximate; true latest needs subquery
        default: return 'math::mean(value)';
    }
}

/**
 * Build the SurrealQL for a metrics chart query: handles raw / daily / weekly
 * aggregation, single-vs-multi metric, and combined-vs-stacked grouping.
 *
 * Caller supplies the tz and the same `MetricsLtsFilterCtx` used by
 * `buildMetricsLtsFilter` (so all date math stays consistent).
 */
export function buildMetricsQuery(
    spec: MetricsQuerySpec,
    tz: string,
    ctx: MetricsLtsFilterCtx,
): QuerySpec {
    const variables: Record<string, unknown> = {};

    // Metric filter: support single or multiple metric names
    const names = spec.metric_names || [spec.metric_name];
    let metricFilter: string;
    if (names.length === 1) {
        variables.metric_name = names[0];
        metricFilter = 'metric_name = $metric_name';
    } else {
        metricFilter = `metric_name IN [${names.map(n => `'${n}'`).join(', ')}]`;
    }

    // Time filter — all modes use lts (local fake-UTC) for correct local boundaries
    const timeFilter = buildMetricsLtsFilter({
        date: spec.date,
        from_date: spec.from_date,
        to_date: spec.to_date,
        recency: spec.recency,
        date_range: spec.date_range,
    }, tz, ctx);

    const agg = spec.aggregation || 'raw';
    const groupMode = spec.group_mode || 'combined';

    if (agg === 'raw') {
        const query = `SELECT * FROM metrics WHERE ${metricFilter} AND ${timeFilter} ORDER BY lts ASC`;
        return { query, variables };
    }

    // Parse aggregation: "daily_sum" → period="day", mode="sum"
    const isWeekly = agg.startsWith('weekly_');
    const mode = agg.replace(/^(daily|weekly)_/, '');
    const aggFn = getSurrealAggFn(mode);

    // Stacked: keep metric_name in GROUP BY for separate series per metric
    const selectExtra = groupMode === 'stacked' ? ', metric_name' : '';

    let query: string;
    if (isWeekly) {
        // SurrealDB time::group() doesn't support 'week' — use time::week() + time::year()
        const groupBy = groupMode === 'stacked'
            ? 'GROUP BY yr, wk, metric_name, unit'
            : 'GROUP BY yr, wk, unit';
        query = `SELECT time::year(lts) AS yr, time::week(lts) AS wk${selectExtra}, ${aggFn} AS value, unit FROM metrics WHERE ${metricFilter} AND ${timeFilter} ${groupBy} ORDER BY yr ASC, wk ASC`;
    } else {
        const groupBy = groupMode === 'stacked'
            ? 'GROUP BY bucket, metric_name, unit'
            : 'GROUP BY bucket, unit';
        query = `SELECT time::group(lts, 'day') AS bucket${selectExtra}, ${aggFn} AS value, unit FROM metrics WHERE ${metricFilter} AND ${timeFilter} ${groupBy} ORDER BY bucket ASC`;
    }

    return { query, variables };
}
