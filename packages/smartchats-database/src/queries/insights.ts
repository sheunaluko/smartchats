/**
 * Insights events — direct write path for admin scripts.
 *
 * Runtime app code writes events via `InsightsClient` (batched, keepalive,
 * POST /insights/batch). CLI tools that want to insert an event out-of-band
 * (e.g. `triage_mark` recording a status change) don't have that pipeline —
 * they connect directly to SurrealDB and issue an INSERT.
 *
 * The row shape mirrors what the local server's insights route writes
 * (packages/smartchats-local-server/src/routes/insights.ts): top-level
 * `event_id`, `event_type`, `session_id?`, `trace_id?`, `timestamp?`, and
 * an arbitrary payload merged in flat (schemaless).
 */
import type { QuerySpec } from '../types.js';

export interface InsertInsightEventArgs {
    /** Free-form event type discriminator (e.g. 'issue_status_change'). */
    event_type: string;
    /** Row-scoped identifier. Callers provide their own so writes are traceable. */
    event_id: string;
    /** Free-form payload. Flattened into the row (schemaless table). */
    payload: Record<string, unknown>;
    /** ISO datetime or Date. Defaults to server-now via SurrealQL time::now(). */
    timestamp?: string | Date;
    /** Optional linkage to a session. */
    session_id?: string;
    /** Optional trace grouping. */
    trace_id?: string;
    /** Optional user attribution (matches what the batch route writes). */
    user_id?: string;
    /** Optional app_name attribution. */
    app_name?: string;
}

/**
 * Build an INSERT for one `insights_events` row.
 *
 * `timestamp` binds as `<datetime>` — SurrealDB rejects raw strings there,
 * so ISO input gets cast at the DB layer. If omitted, `time::now()` is used.
 */
export function insertInsightEvent(args: InsertInsightEventArgs): QuerySpec {
    const hasTimestamp = args.timestamp !== undefined;
    const hasSession = args.session_id !== undefined && args.session_id !== null;
    const hasTrace = args.trace_id !== undefined && args.trace_id !== null;
    const hasUser = args.user_id !== undefined && args.user_id !== null;
    const hasApp = args.app_name !== undefined && args.app_name !== null;

    const fields: string[] = [
        `event_id: $event_id`,
        `event_type: $event_type`,
        `payload: $payload`,
    ];
    fields.push(hasTimestamp ? `timestamp: <datetime> $timestamp` : `timestamp: time::now()`);
    if (hasSession) fields.push(`session_id: $session_id`);
    if (hasTrace) fields.push(`trace_id: $trace_id`);
    if (hasUser) fields.push(`user_id: $user_id`);
    if (hasApp) fields.push(`app_name: $app_name`);

    const variables: Record<string, unknown> = {
        event_id: args.event_id,
        event_type: args.event_type,
        payload: args.payload,
    };
    if (hasTimestamp) {
        variables.timestamp =
            args.timestamp instanceof Date ? args.timestamp.toISOString() : String(args.timestamp);
    }
    if (hasSession) variables.session_id = args.session_id;
    if (hasTrace) variables.trace_id = args.trace_id;
    if (hasUser) variables.user_id = args.user_id;
    if (hasApp) variables.app_name = args.app_name;

    return {
        query: `INSERT INTO insights_events { ${fields.join(', ')} }`,
        variables,
    };
}
