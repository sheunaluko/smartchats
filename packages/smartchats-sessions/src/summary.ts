/**
 * Compute the per-session summary block from a flat event timeline.
 *
 * Pure functions — no DB access. Takes already-fetched events (any
 * `InsightEventRow[]` shape), returns the `SessionSummary` derived
 * from them.
 *
 * Token / latency extraction looks at the conventional shapes used by
 * the cortex engine + smartchats stores:
 *
 *   - `usage_update` events carry `{ payload: { call: { promptTokens, completionTokens, ... }, cumulative: { ... } } }`.
 *     We sum the per-call deltas (more accurate than reading the cumulative).
 *   - `voice_interaction_complete` / LLM-stamped events carry `duration_ms`
 *     when emitted by orchestrator paths; treat any event with both
 *     `event_type` matching /llm/ AND `duration_ms` as an LLM latency sample.
 *
 * Heuristics are intentionally permissive — better to under-count than to
 * crash on payload variants from older clients.
 */

import type {
    InsightEventRow,
    SessionSummary,
    SessionTimelineEntry,
} from './types.js';

/** Normalize an `insights_events` row's timestamp to epoch milliseconds.
 *
 * Handles every shape we've seen:
 *   - epoch ms (number)
 *   - JS `Date`
 *   - ISO string
 *   - SurrealDB SDK v2's `DateTime` class (has `toISOString()` method)
 */
export function normalizeTimestamp(value: unknown): number {
    if (value === null || value === undefined) return 0;
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (!isNaN(parsed)) return parsed;
        return 0;
    }
    // SurrealDB v2 `DateTime` instances (and other custom datetime types)
    // expose `toISOString()` — use it if present.
    if (typeof value === 'object' && value !== null) {
        const maybeIso = (value as { toISOString?: () => string }).toISOString;
        if (typeof maybeIso === 'function') {
            const parsed = Date.parse(maybeIso.call(value));
            if (!isNaN(parsed)) return parsed;
        }
        // Final fallback: stringify and parse.
        const parsed = Date.parse(String(value));
        if (!isNaN(parsed)) return parsed;
    }
    return 0;
}

/** Convert one DB row to a flat timeline entry. */
export function rowToTimelineEntry(row: InsightEventRow): SessionTimelineEntry {
    const entry: SessionTimelineEntry = {
        timestamp: normalizeTimestamp(row.timestamp),
        event_id: row.event_id,
        event_type: row.event_type,
        payload: row.payload ?? {},
    };
    if (row.trace_id) entry.trace_id = row.trace_id;
    if (row.parent_event_id) entry.parent_event_id = row.parent_event_id;
    if (row.duration_ms !== null && row.duration_ms !== undefined) {
        entry.duration_ms = row.duration_ms;
    }
    if (row.tags && row.tags.length > 0) entry.tags = row.tags;
    return entry;
}

/**
 * Convert a list of DB rows to sorted-by-timestamp timeline entries.
 * Uses ASC sort — analyzers reading the bundle linearly see events in
 * occurrence order.
 */
export function rowsToTimeline(rows: InsightEventRow[]): SessionTimelineEntry[] {
    return rows
        .map(rowToTimelineEntry)
        .sort((a, b) => a.timestamp - b.timestamp);
}

interface UsageUpdatePayload {
    call?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
}

/**
 * Extract LLM latency from an event payload when conventionally encoded.
 * Returns undefined when the event isn't an LLM-latency sample.
 */
function extractLlmLatencyMs(entry: SessionTimelineEntry): number | undefined {
    if (entry.duration_ms !== undefined && /llm/i.test(entry.event_type)) {
        return entry.duration_ms;
    }
    // voice_interaction_complete carries durations.* with llm-specific fields
    if (entry.event_type === 'voice_interaction_complete') {
        const durations = entry.payload?.durations as
            | { llm_call_total_ms?: number; llm_first_token_ms?: number }
            | undefined;
        if (durations?.llm_call_total_ms) return durations.llm_call_total_ms;
    }
    return undefined;
}

/** Compute the per-session summary from a timeline. */
export function computeSummary(timeline: SessionTimelineEntry[]): SessionSummary {
    const event_types: Record<string, number> = {};
    let total_prompt_tokens = 0;
    let total_completion_tokens = 0;
    let llm_invocations = 0;
    let error_count = 0;
    const trace_ids = new Set<string>();
    const llm_latencies: number[] = [];

    for (const entry of timeline) {
        event_types[entry.event_type] = (event_types[entry.event_type] ?? 0) + 1;

        if (entry.trace_id) trace_ids.add(entry.trace_id);

        if (/error/i.test(entry.event_type)) error_count++;

        // usage_update gives us per-call token deltas. Sum those.
        if (entry.event_type === 'usage_update') {
            const p = entry.payload as UsageUpdatePayload;
            const call = p.call ?? {};
            if (typeof call.promptTokens === 'number') {
                total_prompt_tokens += call.promptTokens;
            }
            if (typeof call.completionTokens === 'number') {
                total_completion_tokens += call.completionTokens;
            }
            llm_invocations++;
        }

        const latency = extractLlmLatencyMs(entry);
        if (latency !== undefined && latency > 0) llm_latencies.push(latency);
    }

    const avg_llm_latency_ms =
        llm_latencies.length > 0
            ? Math.round(
                llm_latencies.reduce((sum, x) => sum + x, 0) / llm_latencies.length,
            )
            : 0;

    return {
        event_types,
        total_tokens: total_prompt_tokens + total_completion_tokens,
        total_prompt_tokens,
        total_completion_tokens,
        llm_invocations,
        error_count,
        trace_count: trace_ids.size,
        avg_llm_latency_ms,
    };
}
