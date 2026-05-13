/**
 * Bundle format types — the stable JSON shape produced by `exportSessionsToFile`.
 *
 * Treat these as a public API. Adding fields is fine (analyzers should
 * tolerate unknown fields). Removing fields breaks every existing analyzer
 * — bump `EXPORTER_VERSION` and document in the package README before doing so.
 */

/** Bumped when the bundle shape changes incompatibly. */
export const EXPORTER_VERSION = '1.0.0';

/**
 * One row from the `insights_events` table. Fields mirror the schema in
 * smartchats-database/src/schema/local.ts (insights_events table).
 *
 * Server-side `timestamp` is a SurrealDB `datetime` — the SDK returns it
 * as either a Date or an ISO string depending on transport; we normalize
 * to epoch milliseconds inside the bundle's `timeline` entries.
 */
export interface InsightEventRow {
    event_id: string;
    event_type: string;
    /** Stored as datetime in SurrealDB; varies by SDK transport. */
    timestamp?: string | Date | number | null;
    session_id?: string | null;
    trace_id?: string | null;
    user_id?: string | null;
    app_name?: string | null;
    app_version?: string | null;
    parent_event_id?: string | null;
    payload?: Record<string, unknown>;
    tags?: string[] | null;
    duration_ms?: number | null;
    client_info?: Record<string, unknown> | null;
}

/** Single timeline entry — flattened, normalized representation of an event. */
export interface SessionTimelineEntry {
    /** Epoch ms — analyzer-friendly. */
    timestamp: number;
    event_id: string;
    event_type: string;
    payload: Record<string, unknown>;
    /** Optional fields surfaced when present on the source row. */
    trace_id?: string;
    parent_event_id?: string;
    duration_ms?: number;
    tags?: string[];
}

/** Per-session summary computed from the event stream. */
export interface SessionSummary {
    /** Counts by event_type. */
    event_types: Record<string, number>;
    /** Token totals across all `usage_update` / LLM events. 0 when no LLM ran. */
    total_tokens: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
    /** Number of LLM calls across the session. */
    llm_invocations: number;
    /** Count of any `error`-typed event (event_type contains "error"). */
    error_count: number;
    /** Distinct trace_ids seen. */
    trace_count: number;
    /** Average LLM latency in ms across all LLM calls. 0 when no LLM ran. */
    avg_llm_latency_ms: number;
}

/** Per-session metadata (computed at export time). */
export interface SessionMetadata {
    app_name: string;
    user_id: string;
    session_tags: string[];
    /** ISO datetime — earliest event in this session. */
    start_time: string;
    /** ISO datetime — latest event in this session. */
    end_time: string;
    duration_ms: number;
    event_count: number;
    /** ISO datetime when the export was produced. */
    export_timestamp: string;
    /** Bundle shape version (see EXPORTER_VERSION). */
    exporter_version: string;
}

/** Top-level bundle written to disk by `exportSessionsToFile`. */
export interface SessionBundle {
    session_id: string;
    metadata: SessionMetadata;
    summary: SessionSummary;
    timeline: SessionTimelineEntry[];
}

// ── Query input shapes ────────────────────────────────────────────────────

/** Filters supported by `getSessionEvents`. All fields optional. */
export interface SessionEventsFilter {
    /** Specific session id to fetch (e.g. `"ses_abc123"`). */
    sessionId?: string;
    /** Subset of session_tags any event must carry. AND across tags. */
    tags?: string[];
    /** Filter to events from a single app (e.g. `"smartchats"`, `"rai"`). */
    appName?: string;
    /**
     * Lower bound on event `timestamp`. ISO string or epoch ms.
     * (Exclusive of unset events — events with no timestamp are dropped.)
     */
    sinceTimestamp?: string | number;
    /** Upper bound on event `timestamp`. ISO string or epoch ms. */
    untilTimestamp?: string | number;
    /** Hard cap on the number of events returned. Default: no cap. */
    limit?: number;
}

/** Args for the high-level "find sessions" query. */
export interface FindSessionsArgs {
    appName?: string;
    tags?: string[];
    /** Number of distinct sessions to return (most recent first). */
    limit?: number;
}

/** Lightweight session descriptor returned by `findSessions`. */
export interface SessionDescriptor {
    session_id: string;
    app_name: string;
    /** Session-level tags, normalized to a string array. */
    tags: string[];
    /** ISO datetime — earliest event we saw. */
    start_time: string;
    /** ISO datetime — latest event we saw. */
    end_time: string;
    event_count: number;
}

// ── Cross-session triage ─────────────────────────────────────────────────

/**
 * Filter for `findCandidateSessionsQuery`. All fields optional.
 *
 * Row-level filters are pushed into the WHERE clause; predicate filters
 * (`hasError`, `hasEventType`, `missingEventType`, etc.) are applied
 * post-aggregation since they depend on per-session GROUP BY summaries.
 *
 * Time bounds accept ISO strings or epoch ms (same as `SessionEventsFilter`).
 */
export interface CandidateSessionsFilter {
    /** Restrict to events from one app (e.g. "smartchats", "rai"). */
    appName?: string;
    /** Session-level tag filter: every tag must be present (AND). */
    tags?: string[];
    /** Lower bound on event timestamp. */
    sinceTimestamp?: string | number;
    /** Upper bound on event timestamp. */
    untilTimestamp?: string | number;
    /** Only sessions that contain at least one error event (status='error', error tag, or event_type matching /error|fail/i). */
    hasError?: boolean;
    /** Only sessions that contain at least one event tagged `tag`. */
    hasEventTag?: string;
    /** Only sessions that emitted at least one event with `event_type === type`. */
    hasEventType?: string;
    /** Only sessions that NEVER emitted `event_type === type` (useful for "text-only" / "no voice"). */
    missingEventType?: string;
    /** Inclusive lower bound on the session's event count. */
    minEvents?: number;
    /** Inclusive upper bound on the session's event count. */
    maxEvents?: number;
    /** Inclusive lower bound on the session's duration (ms). */
    minDurationMs?: number;
    /** Inclusive upper bound on the session's duration (ms). */
    maxDurationMs?: number;
    /** Hard cap on the number of sessions returned. Default 50. */
    limit?: number;
}

/**
 * Per-session triage record. Returned by `findCandidateSessions`.
 *
 * Aggregates are computed inside the DB query (event_count, error_count,
 * llm_count, execution_count, distinct event_types, distinct event tags).
 * Predicate filters in `CandidateSessionsFilter` are applied JS-side
 * against these aggregates.
 */
export interface SessionCandidate {
    session_id: string;
    app_name: string;
    /** Tags surfaced at the session level (first event's `tags` array). */
    session_tags: string[];
    /** ISO datetime — earliest event in this session. */
    start_time: string;
    /** ISO datetime — latest event in this session. */
    end_time: string;
    duration_ms: number;
    event_count: number;
    error_count: number;
    /** Number of `llm_invocation` events. */
    llm_count: number;
    /** Number of `execution` events (code/tool runs). */
    execution_count: number;
    /** Distinct event_types observed in this session. */
    event_types_present: string[];
    /** Distinct event-level tags observed (union across events). */
    event_tags_present: string[];
}
