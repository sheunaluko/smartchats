/**
 * Pure SurrealQL query builders for `insights_events` lookups.
 *
 * Returns `{query, variables}` specs — caller dispatches via a Client.
 * No SurrealDB SDK access here; mirrors the smartchats-database/queries
 * pattern.
 *
 * Filter behaviors:
 *   - `tags` filter is AND across the array — every tag must be present
 *     in the event's `tags` field (which is itself an array).
 *   - `sessionId` filter is exact-match on `session_id`.
 *   - `appName` filter is exact-match on `app_name`.
 *   - `sinceTimestamp` / `untilTimestamp` accept either ISO strings or
 *     epoch milliseconds; converted to SurrealDB datetime via `<datetime> $...`.
 */

import type { QuerySpec } from 'smartchats-database';
import type {
    SessionEventsFilter,
    FindSessionsArgs,
    CandidateSessionsFilter,
} from './types.js';

/** Convert ISO string or epoch ms → ISO string SurrealDB will accept as datetime. */
function toIsoDatetime(value: string | number): string {
    if (typeof value === 'number') return new Date(value).toISOString();
    // Already a string — assume ISO. Could validate via `new Date(value).toISOString()`
    // but that loses sub-millisecond precision unnecessarily.
    return value;
}

/**
 * Fetch every event matching the supplied filter, sorted by timestamp ASC.
 *
 * Result shape: `InsightEventRow[]` (one statement returned).
 */
export function getSessionEventsQuery(filter: SessionEventsFilter): QuerySpec {
    const conditions: string[] = [];
    const variables: Record<string, unknown> = {};

    if (filter.sessionId) {
        conditions.push('session_id = $session_id');
        variables.session_id = filter.sessionId;
    }
    if (filter.appName) {
        conditions.push('app_name = $app_name');
        variables.app_name = filter.appName;
    }
    if (filter.tags && filter.tags.length > 0) {
        // AND-across: every tag in `filter.tags` must appear in the event's
        // `tags` field. SurrealDB's `CONTAINSALL $needle` does exactly this.
        conditions.push('tags CONTAINSALL $tags');
        variables.tags = filter.tags;
    }
    if (filter.sinceTimestamp !== undefined) {
        conditions.push('timestamp >= <datetime> $since_timestamp');
        variables.since_timestamp = toIsoDatetime(filter.sinceTimestamp);
    }
    if (filter.untilTimestamp !== undefined) {
        conditions.push('timestamp <= <datetime> $until_timestamp');
        variables.until_timestamp = toIsoDatetime(filter.untilTimestamp);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit ? `LIMIT ${Math.max(1, filter.limit)}` : '';
    return {
        query: `SELECT * FROM insights_events ${where} ORDER BY timestamp ASC ${limit}`.trim(),
        variables,
    };
}

/**
 * Find recent sessions (distinct session_ids) optionally filtered by app or tags.
 *
 * Result shape: rows with one entry per session — `{session_id, app_name,
 * tags, start_time, end_time, event_count}`. Sorted by `end_time DESC`
 * (most recent activity first).
 *
 * Implementation detail: SurrealDB v3 `GROUP BY` aggregations let us
 * compute min/max/count in a single round-trip. Tags are picked from
 * `array::first(tags)` — events within a session share the same tags
 * array (set at session start), so picking from any one row is fine.
 */
export function findSessionsQuery(args: FindSessionsArgs = {}): QuerySpec {
    const conditions: string[] = ['session_id != NONE'];
    const variables: Record<string, unknown> = {};

    if (args.appName) {
        conditions.push('app_name = $app_name');
        variables.app_name = args.appName;
    }
    if (args.tags && args.tags.length > 0) {
        conditions.push('tags CONTAINSALL $tags');
        variables.tags = args.tags;
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const limit = args.limit ? `LIMIT ${Math.max(1, args.limit)}` : 'LIMIT 50';

    return {
        query: `SELECT
            session_id,
            array::first(array::group(app_name)) AS app_name,
            array::first(array::group(tags)) AS tags,
            time::min(timestamp) AS start_time,
            time::max(timestamp) AS end_time,
            count() AS event_count
        FROM insights_events
        ${where}
        GROUP BY session_id
        ORDER BY end_time DESC
        ${limit}`,
        variables,
    };
}

/**
 * Cross-session triage query — returns one row per session with the
 * aggregate counts a caller needs to decide which sessions are worth
 * pulling locally for full analysis.
 *
 * Only **row-level** filters are pushed into WHERE here (appName, tags,
 * since/until). The predicate filters (`hasError`, `hasEventType`,
 * `missingEventType`, `minEvents`, `minDuration`, …) are applied
 * **JS-side in `findCandidateSessions`** against the aggregates this
 * query returns. This keeps the SurrealQL portable across v3 minor
 * versions (no reliance on HAVING / FILTER syntax).
 *
 * Returned row shape (one per session):
 *   {
 *     session_id, app_name, session_tags, start_time, end_time,
 *     event_count, error_count, llm_count, execution_count,
 *     event_types_present[], event_tags_present[]
 *   }
 *
 * Sort: `end_time DESC` (most recent activity first). LIMIT defaults to
 * 200 so JS-side filtering has enough material to work with even when
 * the eventual --limit is small.
 */
export function findCandidateSessionsQuery(filter: CandidateSessionsFilter = {}): QuerySpec {
    const conditions: string[] = ['session_id != NONE'];
    const variables: Record<string, unknown> = {};

    if (filter.appName) {
        conditions.push('app_name = $app_name');
        variables.app_name = filter.appName;
    }
    if (filter.tags && filter.tags.length > 0) {
        conditions.push('tags CONTAINSALL $tags');
        variables.tags = filter.tags;
    }
    if (filter.sinceTimestamp !== undefined) {
        conditions.push('timestamp >= <datetime> $since_timestamp');
        variables.since_timestamp = toIsoDatetime(filter.sinceTimestamp);
    }
    if (filter.untilTimestamp !== undefined) {
        conditions.push('timestamp <= <datetime> $until_timestamp');
        variables.until_timestamp = toIsoDatetime(filter.untilTimestamp);
    }

    const where = `WHERE ${conditions.join(' AND ')}`;
    // Cap the raw aggregate fetch generously — JS-side predicate filters
    // need enough rows to find matches even when --limit is small.
    const rawLimit = Math.max(filter.limit ?? 50, 200);

    // Note: SurrealDB rejects nested aggregates (e.g. array::distinct of
    // array::group). We aggregate the raw per-row values and de-duplicate
    // / flatten JS-side in `findCandidateSessions`. Same for error/llm/exec
    // counts — math::sum(IF ... THEN 1 ELSE 0 END) is the portable pattern
    // (not every SurrealDB version exposes `count(predicate)`).
    return {
        query: `SELECT
            session_id,
            array::first(array::group(app_name)) AS app_name,
            array::first(array::group(tags)) AS session_tags,
            time::min(timestamp) AS start_time,
            time::max(timestamp) AS end_time,
            count() AS event_count,
            math::sum(IF payload.status = 'error' OR 'error' IN (tags ?? []) OR event_type CONTAINS 'error' OR event_type CONTAINS 'fail' THEN 1 ELSE 0 END) AS error_count,
            math::sum(IF event_type = 'llm_invocation' THEN 1 ELSE 0 END) AS llm_count,
            math::sum(IF event_type = 'execution' THEN 1 ELSE 0 END) AS execution_count,
            array::group(event_type) AS event_types_raw,
            array::group(tags) AS event_tags_raw
        FROM insights_events
        ${where}
        GROUP BY session_id
        ORDER BY end_time DESC
        LIMIT ${rawLimit}`,
        variables,
    };
}
