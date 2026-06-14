/**
 * Metrics module: save_metric, get_metrics_context, display_metrics, save_reviewed_metrics
 * Tracks quantifiable user activities (exercise initially).
 * The agent acts as the extractor — recognizing metrics in conversation and saving structured data.
 */

import { getUserTimezone, eventTimeAt, getCurrentLocalDate } from "./system"
import { getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';
import type { MetricsQuerySpec, MetricsTimeFilterCtx } from 'smartchats-database';
import { getStartupLoaders } from '../lib/background_loaders';

/** Shared ctx for the time-filter / metrics-query builders. */
const TIME_FILTER_CTX: MetricsTimeFilterCtx = { getCurrentLocalDate }

/**
 * Fetch metrics context (summary + latest-per-name) — reusable by prefetch
 * and module fn.
 *
 * Shape change 2026-06-13 (see packages/benchpress/STATUS.txt): `recent_entries`
 * (an unbounded `SELECT *` of every metric row, costing ~127K tokens on a
 * 1456-row DB) was replaced by `latest_per_metric` (one row per distinct
 * metric_name, with that metric's current value). Same signal, 100× smaller.
 *
 * Consumers updated in the same commit:
 *   - apps/smartchats/app/lib/background_loaders/index.ts (fallback shape)
 *   - apps/smartchats/app/apps/metrics_explorer/index.ts (widget binding)
 *
 * The MCP `get_metrics_summary` tool got the matching shape change in
 * a follow-up — it now returns { summary, latest_per_metric } too.
 */
export async function fetchMetricsContext(): Promise<{ tracked_metrics: any[]; latest_per_metric: any[] }> {
    const [summaryRes, latestRes, preparedRes] = await Promise.all([
        getBackend().data.query(queries.getMetricsSummary()) as any,
        getBackend().data.query(queries.getLatestMetricPerName()) as any,
        getBackend().data.query(queries.getPreparedMetricDefinitions()).catch(() => []) as any,
    ])
    const tracked = summaryRes.rows
    const prepared = preparedRes.rows
    // Merge prepared metrics that don't yet have actual entries
    const trackedNames = new Set(tracked.map((t: any) => t.metric_name))
    for (const p of prepared) {
        if (!trackedNames.has(p.data?.metric_name)) {
            tracked.push({
                metric_name: p.data.metric_name,
                unit: p.data.unit,
                category: p.data.category,
                metric_type: p.data.metric_type,
                entry_count: 0,
                prepared: true,
            })
        }
    }
    return { tracked_metrics: tracked, latest_per_metric: latestRes.rows }
}

/** Duration units to milliseconds */
const DURATION_MS: Record<string, number> = {
    s: 1000, m: 60000, h: 3600000, d: 86400000, w: 604800000, y: 31536000000
}


const METRICS_SYSTEM_MSG = `
## Metrics Tracking

You can track quantifiable activities the user mentions. When the user says something like "I ran 3 miles" or "did 20 pushups", recognize the metric and save it using save_metric.

### Guidelines
- Call get_metrics_context() at session start to learn existing metrics, units, and recent entries
- Normalize metric_name to snake_case (e.g. "running_distance", "pushups", "workout_duration")
- Match existing unit conventions — check get_metrics_context() output before saving
- For extraction from logs: use the extraction review workflow (show_metric_extraction_review → save_reviewed_metrics). Timestamps are resolved automatically from the source log entry's date.
- When extracting from logs, use the log entry's category as the metric category (e.g. a metric from an "exercise" log → category "exercise", from a "nutrition" log → category "nutrition")
- Do NOT ask for confirmation on obvious metrics — just save and confirm briefly
- For ambiguous values or units, ask the user to clarify

### Timing — when did the event happen?

Every metric represents an event that happened at a specific moment in user-local time. The agent is responsible for capturing that moment. There are three cases:

**1. Real-time** — the user is reporting something that just happened. No timing fields needed; the system stamps the event-time triple (\`ts\` / \`local_date\` / \`local_tz\`) from "now."
   Examples: "I just ran 3 miles", "did 20 pushups", "ate lunch", "drank water"

**2. Relative offset** — the user uses a relative phrase. Set \`time_shift_quantity\` (signed integer, negative = past) and \`time_shift_unit\` (one of: \`"hour"\`, \`"day"\`, \`"week"\`).
   Examples:
   - "I did 20 pushups yesterday" → \`time_shift_quantity: -1, time_shift_unit: "day"\`
   - "2 hours ago I had coffee" → \`time_shift_quantity: -2, time_shift_unit: "hour"\`
   - "last week I swam 3 times" → for an aggregated mention you may need multiple save_metric calls; for a single entry pick a representative day with \`time_shift\`
   - "this morning" (and it's currently evening) → \`time_shift_quantity: -8, time_shift_unit: "hour"\` (rough)

**3. Absolute date** — the user names a specific date or weekday. Resolve to an ISO datetime using the **Current local date** from the [Timing] block in your context, then pass it as \`timestamp\`. Default to noon local if no time of day was given.
   Examples:
   - "On May 13 I swam 44 laps" → \`timestamp: "2026-05-13T17:00:00Z"\` (noon ET = 17:00 UTC; use the user's TZ)
   - "Last Tuesday I ran 5K" → resolve which Tuesday relative to today, then ISO datetime at noon local

If both \`time_shift\` and \`timestamp\` are passed, \`timestamp\` wins. The system derives the event-time triple (\`ts\` real-UTC instant, \`local_date\` YYYY-MM-DD in the user's tz, \`local_tz\` IANA zone) from whichever you provide.

**Why this matters**: \`local_date\` is the chart x-axis bucket key and what daily streak/aggregation queries group on. If you save a "yesterday" entry without setting \`time_shift\`, it will plot on today's bar — the user will see the bar in the wrong place.

### Preparing Metrics (No Data Yet)
Use prepare_metric when the user says they WANT to track something but hasn't reported a value yet (e.g. during onboarding: "I want to track handstands"). This registers the metric definition so it appears in future get_metrics_context calls. The agent decides metric_type (boolean vs numeric) and unit based on context. Do NOT call save_metric — no data point is created.

### Boolean / Habit Metrics
Some metrics are boolean habits — "did I do X today?" rather than "how many X did I do?"
- When the user says "I meditated today", "I journaled", "I flossed", etc., save with metric_type: "boolean" — value and unit are auto-set (do NOT ask for a value or unit)
- When the user says they did NOT do something ("I didn't meditate today"), save with metric_type: "boolean", value: 0
- Boolean metrics show up in get_metrics_context() with metric_type: "boolean" and unit: "done"
- Use retrieve_habit_summary() to answer habit questions: "how's my meditation streak?", "how consistent am I with journaling?"
- Use display_metrics with presentation "summary" for boolean metrics — it shows streak and completion info automatically

### Retrieving Metric Data
Use retrieve_metrics() when you need to look up, analyze, or answer questions about metric data without visualization.
Use retrieve_metrics or display_metrics for metrics — only use access_database_with_surreal_ql if the user explicitly asks for a raw database query.

Date/time filtering options (pick one — priority: date > from_date/to_date > recency > date_range):
- date: a single local date — "today", "yesterday", "2026-03-23"
- from_date / to_date: a local date range — "2026-03-01" to "2026-03-31"
- recency: a duration for recent data — "30s", "5m", "3h", "2d", "4w"
- date_range: same duration syntax as recency (default "4w")
- The recency/date_range parameters only support h/d/w units. Convert months to weeks: 1 month → "4w", 2 months → "8w", 3 months → "12w", 6 months → "26w", 1 year → "52w".

All dates are local calendar dates (YYYY-MM-DD), not UTC timestamps.
These date options work the same in both retrieve_metrics and display_metrics.

### Viewing Metrics
Use display_metrics() when the user wants to SEE their data — trends, charts, tables, or summaries.
- Prefer line_chart for time-series trends (weight, distance over time)
- Prefer bar_chart for comparing values across dates
- Prefer pie_chart for value distribution ("how often do I drink 1 vs 2 vs 3 bottles")
- Prefer table for detailed data review
- Prefer summary for quick "what's my latest weight?" style questions
- Prefer calendar for monthly habit views or daily heatmaps (e.g. "show my meditation this month", "steps calendar")
- Use daily_latest aggregation for metrics like weight where only the last reading per day matters
- Use daily_sum for additive metrics (exercise reps, food intake, miles run) where same-day entries should be totaled — without it, raw mode merges same-day entries by summing automatically, but daily_sum makes the intent explicit and produces cleaner chart labels
- Use daily_avg or weekly_avg for high-frequency metrics like steps or calories

### Time Mode (Sparse vs Dense)
By default, charts use dense mode — showing the full date range with 0 for missing days, so gaps in tracking are clearly visible. Set time_mode: "sparse" to only show days with data (gaps are invisible).
- Dense mode (default) is best for most views: trends, consistency checks, gap visibility
- Use sparse mode when you only care about days with actual data and don't want to see missing days
- Dense mode connects lines through missing days (filled with 0) and shows empty bar slots

### Grouped Metrics
When related metrics share the same unit (e.g. situps, weighted_situps, inclined_weighted_situps — all in "reps"), display them together using the metric_names parameter:
- group_mode "combined": sums all variants into one series (total situps per day)
- group_mode "stacked": separate series per metric on the same chart (compare variants)

### Batch Extraction from Logs
CRITICAL: Do NOT write code/scripts/regex to parse log entries. You are an LLM — read each log's content yourself, understand it, and construct the extractions object directly as a JSON literal. No loops, no regex, no string matching. Just read → understand → build the object.

Steps:
1. Fetch logs — use get_recent_logs with category filter when the category is known (e.g. category: "water"). Only use search_logs or search_logs_semantic when you need to find logs across categories by content or meaning. Do NOT use semantic search with keyword lists — use natural language queries.
2. Read each log's content. For each one, identify metrics using your own comprehension.
3. Build the extractions object inline as a literal — one key per log id, each with a metrics array.
4. Call show_metric_extraction_review({ logs, extractions }) for user review before saving.

### After Review Submission
When you receive the "[Extraction review submitted]" message, simply call save_reviewed_metrics(). It reads the workspace automatically, filters accepted/edited metrics, strips internal fields, and batch-saves them. No arguments needed.
`

// ── display_metrics helpers ──

/** Shared query executor for retrieve_metrics and display_metrics */
async function executeMetricsQuery(spec: MetricsQuerySpec, log: Function): Promise<{ rows: any[]; query: string; error?: string }> {
    let queryInfo: { query: string; variables: Record<string, any> }
    try {
        queryInfo = queries.buildMetricsQuery(spec, getUserTimezone(), TIME_FILTER_CTX) as { query: string; variables: Record<string, any> }
    } catch (err: any) {
        return { rows: [], query: '', error: err.message }
    }

    const names = spec.metric_names || [spec.metric_name]
    const displayLabel = names.length > 1 ? names.join(', ') : names[0]
    log(`Querying ${displayLabel} with ${spec.aggregation || 'raw'} aggregation`)

    const response = await getBackend().data.query(queryInfo) as any

    try {
        const rows = response.rows
        // Enrich weekly rows with human-readable dates so the agent can reference and drill down
        if (rows.length > 0 && rows[0].yr != null && rows[0].wk != null) {
            for (const row of rows) {
                const monday = isoWeekMonday(row.yr, row.wk)
                const sunday = new Date(new Date(monday).getTime() + 6 * 86400000).toISOString()
                row.bucket = monday
                row.week_start = monday.slice(0, 10)
                row.week_end = sunday.slice(0, 10)
            }
        }
        return { rows, query: queryInfo.query }
    } catch (err: any) {
        return { rows: [], query: queryInfo.query, error: err.message }
    }
}

/** Compute the Monday (ISO week start) for a given ISO year + week number */
/**
 * Convert a time-shift descriptor (e.g. -1 day, +3 hours) into a
 * milliseconds delta you can add/subtract from a Date. Used by save_metric
 * to derive the anchor moment when the user describes a past entry
 * verbally ("yesterday", "2 hours ago", etc.).
 *
 * Returns 0 for unknown units — caller doesn't shift, falls back to "now."
 */
function shiftMs(quantity: number, unit: string): number {
    const u = unit.toLowerCase().replace(/s$/, '');
    if (u === 'minute') return quantity * 60 * 1000;
    if (u === 'hour') return quantity * 60 * 60 * 1000;
    if (u === 'day') return quantity * 24 * 60 * 60 * 1000;
    if (u === 'week') return quantity * 7 * 24 * 60 * 60 * 1000;
    return 0;
}

/**
 * Compute the anchor moment a metric event actually represents.
 *
 * The event-time triple (`ts` / `local_date` / `local_tz`) all derive
 * from this single anchor via `eventTimeAt(anchor, tz)` — keeps the
 * three fields consistent.
 *
 * Resolution priority:
 *   1. explicit `timestamp` (agent extracted a specific event datetime,
 *      e.g. "on May 13")
 *   2. `time_shift_quantity` + `time_shift_unit` applied to now (e.g.
 *      "yesterday" → -1 day)
 *   3. now (real-time save — most common path)
 */
function computeAnchor(opts: {
    timestamp?: string | null;
    time_shift_quantity?: number | null;
    time_shift_unit?: string | null;
}): Date {
    const tsValue = opts.timestamp && String(opts.timestamp).trim() ? String(opts.timestamp).trim() : null;
    if (tsValue) return new Date(tsValue);
    if (opts.time_shift_quantity != null && opts.time_shift_unit) {
        return new Date(Date.now() + shiftMs(Number(opts.time_shift_quantity), String(opts.time_shift_unit)));
    }
    return new Date();
}

function isoWeekMonday(year: number, week: number): string {
    // Jan 4 is always in ISO week 1
    const jan4 = new Date(Date.UTC(year, 0, 4))
    const dayOfWeek = jan4.getUTCDay() || 7 // Mon=1..Sun=7
    const monday = new Date(jan4)
    monday.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1 + (week - 1) * 7)
    return monday.toISOString()
}

/** Format a timestamp or bucket for display. Uses UTC because the bucket keys arriving here are either `local_date` (a YYYY-MM-DD string that parses as midnight UTC of the local day we want to render) or `ts` (a real-UTC instant whose UTC date is close enough for chart labels). */
function formatDateLabel(ts: string): string {
    const d = new Date(ts)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** Group rows by metric_name for stacked visualizations */
function groupByMetric(rows: any[]): Record<string, any[]> {
    const byMetric: Record<string, any[]> = {}
    for (const r of rows) {
        const mn = r.metric_name || 'unknown'
        ;(byMetric[mn] ||= []).push(r)
    }
    return byMetric
}

/**
 * Fill date gaps with 0 for dense time_mode.
 *
 * Sparse mode passes through unchanged — each row keeps its own x slot.
 *
 * Dense mode produces exactly one row per day across the requested range:
 *   - For aggregated SQL queries (`daily_sum`, `daily_avg`, etc.) each day
 *     already has at most one row — the merge logic below is a no-op.
 *   - For raw mode, multiple same-day rows are merged. Numeric metrics
 *     sum (matches the additive mental model: "2 swims today = total laps");
 *     boolean metrics take the max ("any 'done' marks the day done").
 *     If you want a different reduction (avg, latest), pass an explicit
 *     `aggregation` (e.g. `daily_avg`, `daily_latest`).
 */
function fillDateGaps(rows: any[], spec: MetricsQuerySpec): any[] {
    if (spec.time_mode !== 'dense') return rows
    if (rows.length === 0) return rows
    const agg = spec.aggregation || 'raw'

    const isWeekly = agg.startsWith('weekly_')
    const unit = rows[0]?.unit || ''

    if (isWeekly) {
        // For weekly: sort by yr,wk and fill missing weeks
        const sorted = [...rows].sort((a, b) => (a.yr - b.yr) || (a.wk - b.wk))
        const startDate = new Date(isoWeekMonday(sorted[0].yr, sorted[0].wk))
        const endDate = new Date(isoWeekMonday(sorted[sorted.length - 1].yr, sorted[sorted.length - 1].wk))
        const existing = new Map<string, any>()
        for (const r of sorted) existing.set(`${r.yr}-${r.wk}`, r)

        const result: any[] = []
        const cur = new Date(startDate)
        while (cur <= endDate) {
            const yr = cur.getUTCFullYear()
            // Compute ISO week number
            const jan4 = new Date(Date.UTC(yr, 0, 4))
            const dayOfWeek = jan4.getUTCDay() || 7
            const weekStart = new Date(jan4)
            weekStart.setUTCDate(jan4.getUTCDate() - dayOfWeek + 1)
            const wk = Math.ceil(((cur.getTime() - weekStart.getTime()) / 86400000 + 1) / 7)
            const key = `${yr}-${wk}`
            if (existing.has(key)) {
                result.push(existing.get(key))
            } else {
                result.push({ yr, wk, value: 0, unit })
            }
            cur.setUTCDate(cur.getUTCDate() + 7)
        }
        return result
    }

    // Daily: fill missing days
    const getBucket = (r: any) => rowDate(r)
    const sorted = [...rows].sort((a, b) => getBucket(a).localeCompare(getBucket(b)))

    // Determine date range
    let startStr = spec.from_date || getBucket(sorted[0]).slice(0, 10)
    let endStr = spec.to_date || getBucket(sorted[sorted.length - 1]).slice(0, 10)
    // Handle special date values
    if (spec.date === 'today') {
        startStr = endStr = new Date().toISOString().slice(0, 10)
    } else if (spec.date === 'yesterday') {
        const d = new Date(); d.setDate(d.getDate() - 1)
        startStr = endStr = d.toISOString().slice(0, 10)
    } else if (spec.date) {
        startStr = endStr = spec.date
    }

    // Merge same-day rows. For aggregated SQL paths (daily_sum etc.) the SQL
    // already guarantees one row per day so this is a no-op. For raw mode it
    // sums numerics / OR-s booleans (see fillDateGaps docstring).
    const existing = new Map<string, any>()
    for (const r of sorted) {
        const dayKey = getBucket(r).slice(0, 10)
        const prev = existing.get(dayKey)
        if (prev === undefined) {
            existing.set(dayKey, r)
        } else {
            const isBool = r.metric_type === 'boolean' || prev.metric_type === 'boolean'
            const prevVal = Number(prev.value) || 0
            const curVal = Number(r.value) || 0
            const mergedValue = isBool ? Math.max(prevVal, curVal) : prevVal + curVal
            existing.set(dayKey, { ...prev, value: mergedValue })
        }
    }

    const result: any[] = []
    const cur = new Date(startStr + 'T00:00:00Z')
    const end = new Date(endStr + 'T00:00:00Z')
    while (cur <= end) {
        const dateKey = cur.toISOString().slice(0, 10)
        if (existing.has(dateKey)) {
            result.push(existing.get(dateKey))
        } else {
            result.push({ bucket: dateKey + 'T00:00:00Z', value: 0, unit })
        }
        cur.setUTCDate(cur.getUTCDate() + 1)
    }
    return result
}

function mapRowValue(r: any): number | null {
    if (r.value === null || r.value === undefined) return null
    return Number(r.value) || 0
}

// Date source priority for chart x-axis:
//   1. r.local_date — YYYY-MM-DD in the user's tz (canonical event-time bucket key)
//   2. r.bucket     — daily aggregation alias for local_date (same shape)
//   3. iso week     — computed from yr/wk on weekly aggregations
//   4. r.ts         — real-UTC instant fallback (renders as UTC date — slightly
//                     off for late-evening rows but acceptable as last resort)
function rowDate(r: any): any {
    return r.local_date || r.bucket || isoWeekMonday(r.yr, r.wk) || r.ts
}

function mapRowToPoint(r: any): { x: string; y: number | null; _date?: string } {
    const rawDate = rowDate(r)
    return {
        x: formatDateLabel(rawDate),
        y: mapRowValue(r),
        _date: typeof rawDate === 'string' ? rawDate.slice(0, 10) : undefined,
    }
}

function mapRowToItem(r: any): { label: string; value: number | null; _date?: string } {
    const rawDate = rowDate(r)
    return {
        label: formatDateLabel(rawDate),
        value: mapRowValue(r),
        _date: typeof rawDate === 'string' ? rawDate.slice(0, 10) : undefined,
    }
}

function transformToVizProps(rows: any[], spec: MetricsQuerySpec & { presentation?: string; title?: string }): { vizType: string; props: any } {
    const presentation = spec.presentation || 'line_chart'
    const isStacked = spec.group_mode === 'stacked'
    const names = spec.metric_names || [spec.metric_name]
    const name = names.length === 1 ? names[0].replace(/_/g, ' ') : names.map(n => n.replace(/_/g, ' ')).join(' + ')
    const unit = rows[0]?.unit || ''
    const title = spec.title || `${name}${unit ? ` (${unit})` : ''}`
    const timeMode = spec.time_mode || 'sparse'

    // Apply gap-filling for dense mode before transforming
    const filledRows = fillDateGaps(rows, spec)

    switch (presentation) {
        case 'line_chart': {
            if (isStacked) {
                const byMetric = groupByMetric(filledRows)
                return {
                    vizType: 'line_chart',
                    props: {
                        title,
                        series: Object.entries(byMetric).map(([mn, pts]) => ({
                            label: mn.replace(/_/g, ' '),
                            points: pts.map(mapRowToPoint),
                        })),
                        xLabel: 'Date',
                        yLabel: unit || 'Value',
                        timeMode,
                    },
                }
            }
            return {
                vizType: 'line_chart',
                props: {
                    title,
                    series: [{
                        label: name,
                        points: filledRows.map(mapRowToPoint),
                    }],
                    xLabel: 'Date',
                    yLabel: unit || 'Value',
                    timeMode,
                },
            }
        }
        case 'bar_chart': {
            if (isStacked) {
                const byMetric = groupByMetric(filledRows)
                return {
                    vizType: 'bar_chart',
                    props: {
                        title,
                        series: Object.entries(byMetric).map(([mn, pts]) => ({
                            label: mn.replace(/_/g, ' '),
                            items: pts.map(mapRowToItem),
                        })),
                        unit,
                        timeMode,
                    },
                }
            }
            return {
                vizType: 'bar_chart',
                props: {
                    title,
                    items: filledRows.map(mapRowToItem),
                    unit,
                    timeMode,
                },
            }
        }
        case 'table': {
            if (isStacked) {
                return {
                    vizType: 'table',
                    props: {
                        title,
                        columns: [
                            { key: 'date', label: 'Date' },
                            { key: 'metric', label: 'Metric' },
                            { key: 'value', label: `Value${unit ? ` (${unit})` : ''}` },
                        ],
                        rows: rows.map(r => ({
                            date: formatDateLabel(rowDate(r)),
                            metric: (r.metric_name || 'unknown').replace(/_/g, ' '),
                            value: Number(r.value) || 0,
                        })),
                    },
                }
            }
            return {
                vizType: 'table',
                props: {
                    title,
                    columns: [
                        { key: 'date', label: 'Date' },
                        { key: 'value', label: `Value${unit ? ` (${unit})` : ''}` },
                    ],
                    rows: rows.map(r => ({
                        date: formatDateLabel(rowDate(r)),
                        value: Number(r.value) || 0,
                    })),
                },
            }
        }
        case 'pie_chart': {
            if (isStacked) {
                // Slice by metric_name: total value per metric
                const totals: Record<string, number> = {}
                for (const r of rows) {
                    const mn = (r.metric_name || 'unknown').replace(/_/g, ' ')
                    totals[mn] = (totals[mn] || 0) + (Number(r.value) || 0)
                }
                return {
                    vizType: 'pie_chart',
                    props: {
                        title,
                        slices: Object.entries(totals).map(([label, value]) => ({ label, value })),
                    },
                }
            }
            // Bin rows by value and show distribution as slices
            const counts: Record<string, number> = {}
            for (const r of rows) {
                const key = `${Number(r.value) || 0} ${unit}`.trim()
                counts[key] = (counts[key] || 0) + 1
            }
            return {
                vizType: 'pie_chart',
                props: {
                    title,
                    slices: Object.entries(counts).map(([label, value]) => ({ label, value })),
                },
            }
        }
        case 'summary': {
            if (isStacked) {
                // Show latest for each metric
                const byMetric = groupByMetric(rows)
                const stats = Object.entries(byMetric).map(([mn, pts]) => {
                    const latest = pts[pts.length - 1]
                    return { label: mn.replace(/_/g, ' '), value: `${Number(latest.value) || 0} ${unit}`.trim() }
                })
                return {
                    vizType: 'stat_card',
                    props: {
                        label: title,
                        stats,
                    },
                }
            }
            // Boolean/habit metric: show streak + completion info
            if (unit === 'done') {
                const doneDatesSet = new Set<string>()
                for (const r of rows) {
                    if (Number(r.value) < 1) continue
                    const ts = rowDate(r)
                    if (ts) doneDatesSet.add(new Date(ts).toISOString().slice(0, 10))
                }
                const doneDates = Array.from(doneDatesSet).sort()

                let currentStreak = 0
                if (doneDates.length > 0) {
                    const today = new Date().toISOString().slice(0, 10)
                    let checkDate = today
                    while (doneDatesSet.has(checkDate)) {
                        currentStreak++
                        const prev = new Date(new Date(checkDate + 'T12:00:00Z').getTime() - 86400000)
                        checkDate = prev.toISOString().slice(0, 10)
                    }
                }

                const streakLabel = currentStreak === 1 ? '1 day streak' : `${currentStreak} day streak`
                return {
                    vizType: 'stat_card',
                    props: {
                        label: title,
                        value: streakLabel,
                        delta: `${doneDates.length} days done`,
                        deltaDirection: (currentStreak > 0 ? 'up' : 'neutral') as 'up' | 'neutral',
                    },
                }
            }

            const latest = rows[rows.length - 1]
            const previous = rows.length > 1 ? rows[rows.length - 2] : null
            const latestVal = Number(latest.value) || 0
            let delta: string | undefined
            let deltaDirection: 'up' | 'down' | 'neutral' | undefined
            if (previous) {
                const prevVal = Number(previous.value) || 0
                const diff = latestVal - prevVal
                delta = `${diff >= 0 ? '+' : ''}${diff.toFixed(1)} ${unit}`
                deltaDirection = diff > 0 ? 'up' : diff < 0 ? 'down' : 'neutral'
            }
            return {
                vizType: 'stat_card',
                props: {
                    label: title,
                    value: `${latestVal} ${unit}`.trim(),
                    delta,
                    deltaDirection,
                },
            }
        }
        case 'cumulative': {
            if (isStacked) {
                const byMetric = groupByMetric(filledRows)
                return {
                    vizType: 'line_chart',
                    props: {
                        title: title || `${name} (cumulative)`,
                        series: Object.entries(byMetric).map(([mn, pts]) => {
                            let sum = 0
                            return {
                                label: mn.replace(/_/g, ' '),
                                points: pts.map(r => { sum += mapRowValue(r) || 0; return { x: formatDateLabel(rowDate(r)), y: sum }; }),
                            }
                        }),
                        xLabel: 'Date',
                        yLabel: `Total ${unit || 'Value'}`,
                        timeMode,
                    },
                }
            }
            let sum = 0
            return {
                vizType: 'line_chart',
                props: {
                    title: title || `${name} (cumulative)`,
                    series: [{
                        label: name,
                        points: filledRows.map(r => { sum += mapRowValue(r) || 0; return { x: formatDateLabel(rowDate(r)), y: sum }; }),
                    }],
                    xLabel: 'Date',
                    yLabel: `Total ${unit || 'Value'}`,
                    timeMode,
                },
            }
        }
        case 'calendar': {
            // Extract year/month from first row's bucket
            const firstBucket = filledRows[0]?.local_date || filledRows[0]?.bucket || isoWeekMonday(filledRows[0]?.yr, filledRows[0]?.wk) || filledRows[0]?.ts
            const firstDate = new Date(firstBucket)
            const calYear = firstDate.getUTCFullYear()
            const calMonth = firstDate.getUTCMonth() + 1
            const isBoolean = unit === 'done' || unit === 'completed' || unit === 'boolean'
            const days = filledRows.map(r => {
                const rawDate = rowDate(r)
                const dateStr = typeof rawDate === 'string' ? rawDate.slice(0, 10) : new Date(rawDate).toISOString().slice(0, 10)
                const val = mapRowValue(r)
                return {
                    date: dateStr,
                    value: val !== null ? val : undefined,
                    done: isBoolean ? (val !== null && val >= 1) : undefined,
                }
            }).filter((d: any) => d.value !== undefined || d.done !== undefined)
            return {
                vizType: 'calendar',
                props: {
                    title,
                    year: calYear,
                    month: calMonth,
                    days,
                    mode: isBoolean ? 'boolean' : 'quantitative',
                    unit: isBoolean ? undefined : unit,
                },
            }
        }
        default:
            return transformToVizProps(rows, { ...spec, presentation: 'line_chart' })
    }
}

export function createMetricsModule() {
    return {
        id: 'metrics',
        name: 'Metrics',
        position: 42,
        system_msg: METRICS_SYSTEM_MSG,
        functions: [
            {
                enabled: true,
                description: `Save a metric data point. Supports numeric values and boolean habits (metric_type='boolean').`,
                name: 'save_metric',
                parameters: {
                    metric_name: 'string',
                    value: 'number',
                    unit: 'string',
                    metric_type: 'string',
                    timestamp: 'string',
                    source: 'string',
                    source_text: 'string',
                    source_log_id: 'string',
                    category: 'string',
                    time_shift_quantity: 'number',
                    time_shift_unit: 'string',
                    note: 'string'
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { metric_name, value, unit, timestamp, source, source_text, source_log_id, category, time_shift_quantity, time_shift_unit, note, metric_type } = ops.params

                    const isBoolean = metric_type === 'boolean'
                    const resolvedValue = isBoolean ? (value === 0 ? 0 : 1) : (Number(value) || 0)
                    const resolvedUnit = isBoolean ? 'done' : (unit || '')
                    const resolvedMetricType = isBoolean ? 'boolean' : 'numeric'

                    log(`Saving metric: ${metric_name} = ${resolvedValue} ${resolvedUnit} (${resolvedMetricType})`)

                    // All event-time fields derive from the same anchor.
                    // For metrics, the legacy `timestamp` column is populated
                    // from the bundle's `ts` inside the builder.
                    const tz = getUserTimezone()
                    const anchor = computeAnchor({ timestamp, time_shift_quantity, time_shift_unit })

                    const response = await getBackend().data.query(queries.insertMetric({
                        metric_name: metric_name || '',
                        value: resolvedValue,
                        unit: resolvedUnit,
                        metric_type: resolvedMetricType,
                        ...eventTimeAt(anchor, tz),
                        source: source || 'user_conversation',
                        source_text: source_text || '',
                        source_log_id: source_log_id || null,
                        category: category || 'general',
                        time_shift_quantity: time_shift_quantity != null ? Number(time_shift_quantity) : null,
                        time_shift_unit: time_shift_unit || null,
                        note: note || null,
                    })) as any
                    log(`save_metric response:`)
                    log(response)

                    try {
                        return response.rows
                    } catch (error: any) {
                        return `Error saving metric: ${JSON.stringify(error)}`
                    }
                },
                return_type: 'any'
            },
            {
                enabled: true,
                description: `Get summary of all tracked metrics: names, units, categories, recent entries. Call at session start.`,
                name: 'get_metrics_context',
                parameters: null,
                fn: async (ops: any) => {
                    const { log } = ops.util
                    log(`Fetching metrics context`)
                    const loaders = getStartupLoaders()
                    const result = loaders ? await loaders.metrics_context.get() : await fetchMetricsContext()
                    log(`Got metrics context`)
                    return result
                },
                return_type: 'object'
            },
            {
                enabled: true,
                description: `Batch-save accepted/edited metrics from extraction review. Reads from workspace automatically.`,
                name: 'save_reviewed_metrics',
                parameters: null,
                fn: async (ops: any) => {
                    const { log, get_workspace } = ops.util;

                    const workspace = get_workspace();
                    const reviewData = workspace['structured_extractions_review'];

                    if (!reviewData || typeof reviewData !== 'object') {
                        return { saved: 0, failed: 0, skipped: 0, errors: ['No extraction review data found in workspace'] };
                    }

                    // Collect accepted/edited metrics, strip _status
                    const toSave: any[] = [];
                    let skipped = 0;

                    for (const [_logId, extraction] of Object.entries(reviewData as Record<string, any>)) {
                        if (!extraction?.metrics || !Array.isArray(extraction.metrics)) continue;
                        for (const m of extraction.metrics) {
                            if (m._status === 'accepted' || m._status === 'edited') {
                                const { _status, ...metric } = m;
                                toSave.push(metric);
                            } else {
                                skipped++;
                            }
                        }
                    }

                    if (toSave.length === 0) {
                        return { saved: 0, failed: 0, skipped, errors: ['No accepted or edited metrics to save'] };
                    }

                    log(`Batch saving ${toSave.length} reviewed metrics (${skipped} skipped)`);

                    const results = await Promise.allSettled(
                        toSave.map((m: any) => {
                            const tz = getUserTimezone()
                            const anchor = computeAnchor({
                                timestamp: m.timestamp,
                                time_shift_quantity: m.time_shift_quantity,
                                time_shift_unit: m.time_shift_unit,
                            })
                            const eventTime = eventTimeAt(anchor, tz)

                            const isBool = m.metric_type === 'boolean'

                            return getBackend().data.query(queries.insertMetric({
                                metric_name: m.metric_name || '',
                                value: isBool ? (m.value === 0 ? 0 : 1) : (Number(m.value) || 0),
                                unit: isBool ? 'done' : (m.unit || ''),
                                metric_type: isBool ? 'boolean' : 'numeric',
                                ...eventTime,
                                source: m.source || 'user_log',
                                source_text: m.source_text || '',
                                source_log_id: m.source_log_id || null,
                                category: m.category || 'general',
                                time_shift_quantity: m.time_shift_quantity != null ? Number(m.time_shift_quantity) : null,
                                time_shift_unit: m.time_shift_unit || null,
                                note: m.note || null,
                            }));
                        })
                    );

                    let saved = 0;
                    let failed = 0;
                    const errors: string[] = [];

                    results.forEach((r, i) => {
                        if (r.status === 'fulfilled') {
                            const res = r.value as any;
                            const stmts = res?.data?.result?.result;
                            const stmt = Array.isArray(stmts) ? stmts[0] : stmts;
                            const dbStatus = stmt?.status;
                            if (dbStatus === 'ERR') {
                                failed++;
                                const dbError = stmt?.result || 'unknown DB error';
                                errors.push(`Metric ${i} (${toSave[i]?.metric_name}): ${dbError}`);
                            } else {
                                saved++;
                            }
                        } else {
                            failed++;
                            errors.push(`Metric ${i} (${toSave[i]?.metric_name}): ${r.reason}`);
                        }
                    });

                    log(`Batch save complete: ${saved} saved, ${failed} failed, ${skipped} skipped`);
                    return { saved, failed, skipped, errors };
                },
                return_type: 'object'
            },
            {
                enabled: true,
                description: `Retrieve raw metric data rows for analysis (no visualization). Use this to answer questions about data; use display_metrics to show charts/tables. Date filter priority: date > from_date/to_date > recency > date_range.`,
                name: 'retrieve_metrics',
                parameters: {
                    metric_name: 'string',
                    metric_names: 'array',
                    group_mode: 'string',
                    date: 'string',
                    from_date: 'string',
                    to_date: 'string',
                    recency: 'string',
                    date_range: 'string',
                    aggregation: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { metric_name, metric_names, group_mode, date, from_date, to_date, recency, date_range, aggregation } = ops.params

                    if (!metric_name && (!metric_names || !Array.isArray(metric_names) || metric_names.length === 0)) {
                        return { error: 'Either metric_name or metric_names (non-empty array) is required' }
                    }
                    if (metric_name && metric_names) {
                        return { error: 'Provide either metric_name or metric_names, not both' }
                    }

                    const resolvedName = metric_name || metric_names[0]
                    const spec: MetricsQuerySpec = {
                        metric_name: resolvedName,
                        metric_names: metric_names || undefined,
                        group_mode: (group_mode === 'stacked' ? 'stacked' : 'combined') as 'combined' | 'stacked',
                        date: date || undefined,
                        from_date: from_date || undefined,
                        to_date: to_date || undefined,
                        recency: recency || undefined,
                        date_range: date_range || undefined,
                        aggregation: aggregation || 'raw',
                    }

                    const result = await executeMetricsQuery(spec, log)
                    if (result.error) return { error: result.error, query: result.query }

                    if (result.rows.length === 0) {
                        const displayLabel = metric_names ? metric_names.join(', ') : resolvedName
                        return { rows: [], row_count: 0, metric_name: resolvedName, message: `No data found for "${displayLabel}" in the specified range.`, query: result.query }
                    }

                    const unit = result.rows[0]?.unit || ''
                    const dateFilterUsed = date ? `date: ${date}` :
                        from_date ? `from_date: ${from_date}, to_date: ${to_date || 'today'}` :
                        recency ? `recency: ${recency}` :
                        `date_range: ${date_range || '4w'}`

                    return {
                        rows: result.rows,
                        row_count: result.rows.length,
                        metric_name: resolvedName,
                        ...(metric_names ? { metric_names, group_mode: spec.group_mode } : {}),
                        unit,
                        aggregation: spec.aggregation,
                        date_filter_used: dateFilterUsed,
                        query: result.query,
                    }
                },
                return_type: 'object'
            },
            {
                enabled: true,
                description: `Display metric visualization when user wants to SEE data. Presentations: line_chart (default), bar_chart, pie_chart, table, summary, calendar, cumulative (running total over time). Use retrieve_metrics for analysis without visualization.`,
                name: 'display_metrics',
                parameters: {
                    metric_name: 'string',
                    metric_names: 'array',
                    group_mode: 'string',
                    date: 'string',
                    from_date: 'string',
                    to_date: 'string',
                    recency: 'string',
                    date_range: 'string',
                    from: 'string',
                    to: 'string',
                    aggregation: 'string',
                    presentation: 'string',
                    title: 'string',
                    time_mode: 'string',
                },
                fn: async (ops: any) => {
                    const { log, event, update_workspace } = ops.util
                    const { metric_name, metric_names, group_mode, date, from_date, to_date, recency, date_range, from, to, aggregation, presentation, title, time_mode } = ops.params

                    if (!metric_name && (!metric_names || !Array.isArray(metric_names) || metric_names.length === 0)) {
                        return { error: 'Either metric_name or metric_names (non-empty array) is required' }
                    }
                    if (metric_name && metric_names) {
                        return { error: 'Provide either metric_name or metric_names, not both' }
                    }

                    const resolvedName = metric_name || metric_names[0]

                    // Map legacy from/to to from_date/to_date (extract date portion)
                    const resolvedFromDate = from_date || (from ? from.slice(0, 10) : undefined)
                    const resolvedToDate = to_date || (to ? to.slice(0, 10) : undefined)

                    const spec: MetricsQuerySpec & { presentation?: string; title?: string } = {
                        metric_name: resolvedName,
                        metric_names: metric_names || undefined,
                        group_mode: group_mode === 'stacked' ? 'stacked' : 'combined',
                        date: date || undefined,
                        from_date: resolvedFromDate,
                        to_date: resolvedToDate,
                        recency: recency || undefined,
                        date_range: date_range || undefined,
                        aggregation: aggregation || 'raw',
                        presentation: presentation || 'line_chart',
                        title: title || undefined,
                        time_mode: (time_mode === 'sparse' ? 'sparse' : 'dense') as 'sparse' | 'dense',
                    }

                    const result = await executeMetricsQuery(spec, log)
                    if (result.error) return { error: result.error }

                    const rows = result.rows
                    if (rows.length === 0) {
                        return { metric_name, row_count: 0, message: `No data found for "${metric_name}" in the specified range.` }
                    }

                    // Transform to viz props
                    const { vizType, props } = transformToVizProps(rows, spec)

                    // Audit to workspace
                    const resolvedAt = new Date().toISOString()
                    const auditKey = `metric_view_${resolvedName}_${Date.now()}`
                    const audit = {
                        spec,
                        query: result.query,
                        rows,
                        row_count: rows.length,
                        resolved_at: resolvedAt,
                    }
                    update_workspace({ [auditKey]: audit })

                    // Emit audit event to insights
                    event({
                        type: 'metric_view_audit',
                        spec,
                        query: result.query,
                        row_count: rows.length,
                        resolved_at: resolvedAt,
                    })

                    // Render visualization
                    event({ type: 'visualization_update', vizType, props })

                    // Return summary to agent
                    const unit = rows[0]?.unit || ''
                    const latestValue = rows[rows.length - 1]?.value
                    return {
                        metric_name: resolvedName,
                        ...(metric_names ? { metric_names } : {}),
                        ...(metric_names ? { group_mode: spec.group_mode } : {}),
                        row_count: rows.length,
                        latest_value: latestValue,
                        unit,
                        presentation: vizType,
                        message: `Displayed ${rows.length} data points as ${vizType}${metric_names ? ` (${metric_names.length} metrics, ${spec.group_mode})` : ''}.`,
                    }
                },
                return_type: 'object'
            },
            {
                enabled: true,
                description: `Get habit completion stats: streak, days done, completion rate. For boolean metrics only.`,
                name: 'retrieve_habit_summary',
                parameters: {
                    metric_name: 'string',
                    date: 'string',
                    from_date: 'string',
                    to_date: 'string',
                    recency: 'string',
                    date_range: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { metric_name, date, from_date, to_date, recency, date_range } = ops.params

                    if (!metric_name) {
                        return { error: 'metric_name is required' }
                    }

                    log(`Computing habit summary for: ${metric_name}`)

                    const tz = getUserTimezone()
                    const timeFilter = queries.buildMetricsTimeFilter({ date, from_date, to_date, recency, date_range }, tz, TIME_FILTER_CTX)

                    // Only count "done" entries (value >= 1), not explicit "did not do" (value = 0)
                    const response = await getBackend().data.query(queries.getHabitDoneTimestamps({
                        metric_name,
                        dateFilter: timeFilter,
                    })) as any
                    const rows = response.rows

                    // Extract distinct local dates — query returns local_date directly.
                    const doneDatesSet = new Set<string>()
                    for (const row of rows) {
                        if (typeof row.local_date === 'string') {
                            doneDatesSet.add(row.local_date)
                        }
                    }
                    const doneDates = Array.from(doneDatesSet).sort()

                    // Determine date range boundaries
                    const today = getCurrentLocalDate(tz)
                    let rangeStart: string
                    let rangeEnd: string

                    if (date) {
                        let d = date
                        if (d === 'today') d = today
                        else if (d === 'yesterday') {
                            const y = new Date(Date.now() - 86400000)
                            d = y.toLocaleDateString('sv-SE', { timeZone: tz })
                        }
                        rangeStart = d
                        rangeEnd = d
                    } else if (from_date) {
                        rangeStart = from_date
                        rangeEnd = to_date || today
                    } else {
                        const dur = recency || date_range || '4w'
                        const match = dur.match(/^(\d+)(s|m|h|d|w|y)$/)
                        if (!match) return { error: `Invalid duration: ${dur}` }
                        const ms = parseInt(match[1]) * DURATION_MS[match[2]]
                        const startDate = new Date(Date.now() - ms)
                        rangeStart = startDate.toLocaleDateString('sv-SE', { timeZone: tz })
                        rangeEnd = today
                    }

                    // Count days in range (inclusive)
                    const startMs = new Date(rangeStart + 'T00:00:00Z').getTime()
                    const endMs = new Date(rangeEnd + 'T00:00:00Z').getTime()
                    const daysInRange = Math.max(1, Math.floor((endMs - startMs) / 86400000) + 1)

                    const daysDone = doneDates.length
                    const completionRate = Math.round((daysDone / daysInRange) * 100)

                    // Current streak: walk backwards from today
                    let currentStreak = 0
                    if (doneDates.length > 0) {
                        let checkDate = today
                        while (doneDatesSet.has(checkDate)) {
                            currentStreak++
                            const prev = new Date(new Date(checkDate + 'T12:00:00Z').getTime() - 86400000)
                            checkDate = prev.toISOString().slice(0, 10)
                        }
                    }

                    // Longest streak: scan sorted dates
                    let longestStreak = 0
                    if (doneDates.length > 0) {
                        let streak = 1
                        for (let i = 1; i < doneDates.length; i++) {
                            const prevMs = new Date(doneDates[i - 1] + 'T12:00:00Z').getTime()
                            const currMs = new Date(doneDates[i] + 'T12:00:00Z').getTime()
                            if (Math.round((currMs - prevMs) / 86400000) === 1) {
                                streak++
                            } else {
                                longestStreak = Math.max(longestStreak, streak)
                                streak = 1
                            }
                        }
                        longestStreak = Math.max(longestStreak, streak)
                    }

                    const lastDoneDate = doneDates.length > 0 ? doneDates[doneDates.length - 1] : null

                    const dateFilterUsed = date ? `date: ${date}` :
                        from_date ? `from_date: ${from_date}, to_date: ${to_date || 'today'}` :
                        recency ? `recency: ${recency}` :
                        `date_range: ${date_range || '4w'}`

                    return {
                        metric_name,
                        days_done: daysDone,
                        days_in_range: daysInRange,
                        completion_rate: `${completionRate}%`,
                        current_streak: currentStreak,
                        longest_streak: longestStreak,
                        last_done_date: lastDoneDate,
                        date_range_used: dateFilterUsed,
                    }
                },
                return_type: 'object'
            },

            // ── prepare_metric ──
            {
                enabled: true,
                description: `Register a metric the user intends to track, without saving an actual data point. Use during onboarding or when the user says "I want to track X" but hasn't reported a value yet. This makes the metric visible in get_metrics_context so you know about it on future sessions.`,
                name: 'prepare_metric',
                parameters: {
                    metric_name: 'string',
                    unit: 'string',
                    metric_type: 'string',
                    category: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    let { metric_name, unit, metric_type, category } = ops.params

                    if (!metric_name) return { error: 'metric_name is required' }

                    // Normalize
                    metric_name = metric_name.trim().toLowerCase().replace(/\s+/g, '_')
                    const isBoolean = metric_type === 'boolean'
                    const resolvedUnit = isBoolean ? 'done' : (unit || 'count')
                    const resolvedType = isBoolean ? 'boolean' : 'numeric'

                    log(`Preparing metric: ${metric_name} (${resolvedType}, ${resolvedUnit})`)

                    // Check if already exists in metrics table
                    const existsRes = await getBackend().data.query(queries.findMetricByName(metric_name)) as any
                    if (existsRes.rows.length > 0) {
                        return { ok: true, metric_name, already_tracked: true, message: `${metric_name} already has data entries` }
                    }

                    // Check if already prepared
                    const prepRes = await getBackend().data.query(queries.findPreparedMetric(metric_name)) as any
                    if (prepRes.rows.length > 0) {
                        return { ok: true, metric_name, already_prepared: true }
                    }

                    // Insert definition
                    await getBackend().data.query(queries.insertPreparedMetric({
                        metric_name,
                        unit: resolvedUnit,
                        metric_type: resolvedType,
                        category: category || 'general',
                    }))

                    return { ok: true, metric_name, unit: resolvedUnit, metric_type: resolvedType, category: category || 'general', prepared: true }
                },
                return_type: 'object'
            },

            // ── update_metric ──
            {
                enabled: true,
                description: `Update a metric entry by id. Whitelisted fields: value, category, note, source_text. metric_name / unit / metric_type are NOT editable — those define what the metric IS; correct via delete + re-save instead.`,
                name: 'update_metric',
                parameters: {
                    id: 'string',
                    value: 'number',
                    category: 'string',
                    note: 'string',
                    source_text: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { id, value, category, note, source_text } = ops.params

                    if (!id) return { error: 'id is required' }

                    const patch: { value?: number; category?: string; note?: string | null; source_text?: string } = {}
                    if (value !== undefined && value !== null) patch.value = Number(value)
                    if (category !== undefined && category !== null) patch.category = category
                    if (note !== undefined) patch.note = note
                    if (source_text !== undefined) patch.source_text = source_text

                    const spec = queries.updateMetric({ recordId: id, patch })
                    if (!spec) return { updated: false, error: 'No fields to update' }

                    log(`update_metric: ${id}`)
                    const response = await getBackend().data.query(spec) as any
                    const rows = response.rows
                    return rows.length > 0 ? { updated: true, id } : { updated: false, error: 'Metric not found' }
                },
                return_type: 'object'
            },

            // ── delete_metric ──
            {
                enabled: true,
                description: `Delete a metric entry by id. Returns the deleted row. Use for cleanup of mistaken entries.`,
                name: 'delete_metric',
                parameters: {
                    id: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { id } = ops.params

                    if (!id) return { error: 'id is required' }

                    log(`delete_metric: ${id}`)
                    const response = await getBackend().data.query(queries.deleteMetric(id)) as any
                    const rows = response.rows
                    return rows.length > 0 ? { deleted: true, id, before: rows[0] } : { deleted: false, error: 'Metric not found' }
                },
                return_type: 'object'
            },
        ],
    }
}
