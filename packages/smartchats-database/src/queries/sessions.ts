/**
 * Session query builders.
 *
 * Sessions are saved conversation transcripts. Sort by `lts DESC` so
 * original timing survives migration (ORDER BY updated_at would
 * re-stamp on import). See packages/smartchats-local-server/src/schema.ts
 * for the dual-field timestamp invariant.
 */

import type { QuerySpec, AuditFields, EventTimeFields } from '../types.js';

export interface SessionSummaryRow extends AuditFields {
    id: string;
    label: string;
    message_count: number;
}

export interface ListSessionsArgs {
    limit?: number;
}

/**
 * Recent sessions with summary fields (label + message count + audit
 * timestamps). Used in the session browser UI and for LLM consumers
 * picking a session to load.
 *
 * Sort is by `ts DESC` (real-UTC instant) — monotonic across DST and
 * travel. Projection retains legacy `lts` alongside `ts`/`local_date`/
 * `local_tz` during the 1.5.0 → 1.6.0 dual-read window.
 */
export function listSessions(args: ListSessionsArgs = {}): QuerySpec {
    const limit = Math.min(Math.max(args.limit ?? 50, 1), 200);
    return {
        query: `SELECT id, label, message_count, created_at, updated_at, lts, ts, local_date, local_tz FROM sessions ORDER BY ts DESC LIMIT ${limit}`,
        variables: {},
    };
}

export interface SearchSessionsArgs {
    query: string;
    limit?: number;
}

/**
 * Substring search across session labels and the chat-history JSON.
 * Case-insensitive. Slow-ish on large session collections — relies on
 * a SurrealDB-side string contains check rather than a real index.
 * Guards against NULL labels (string::lowercase NULL would ERR).
 */
export function searchSessions(args: SearchSessionsArgs): QuerySpec {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    return {
        query: `SELECT id, label, message_count, created_at, updated_at, lts, ts, local_date, local_tz FROM sessions WHERE (label != NONE AND string::lowercase(label) CONTAINS string::lowercase($q)) OR string::lowercase(<string> chat_history) CONTAINS string::lowercase($q) ORDER BY ts DESC LIMIT ${limit}`,
        variables: { q: args.query },
    };
}

/**
 * Load a single session by full ID (e.g. "sessions:abc123").
 */
export function loadSession(sessionId: string): QuerySpec {
    const key = sessionId.includes(':') ? sessionId.split(':').slice(1).join(':') : sessionId;
    return {
        query: `SELECT * FROM type::record('sessions', $key)`,
        variables: { key },
    };
}

/**
 * Strip the table prefix off a full SurrealDB record id (`sessions:abc123` →
 * `abc123`). If no `:` is present, returns the input unchanged. Splits on
 * the FIRST colon only — the key portion may itself contain colons.
 */
function sessionKey(sessionId: string): string {
    const idx = sessionId.indexOf(':');
    return idx < 0 ? sessionId : sessionId.slice(idx + 1);
}

/**
 * Fields written on every session save (both insert + update). Mirrored as a
 * type so callers don't drift from the schema.
 */
export interface SessionWriteFields extends EventTimeFields {
    label: string;
    message_count: number;
    chat_history: unknown[];
    workspace: Record<string, unknown>;
    thought_history: unknown[];
    execution_history: unknown[];
    settings: unknown;
}

/**
 * INSERT a new session row. Returns the created row (including `id`) on
 * the first statement so the caller can capture the new record id.
 * Dual-writes legacy `lts` and the 1.5.0 event-time triple during the
 * migration window.
 */
export function insertSession(data: SessionWriteFields): QuerySpec {
    return {
        query: `INSERT INTO sessions {
            label: $label,
            message_count: $message_count,
            chat_history: $chat_history,
            workspace: $workspace,
            thought_history: $thought_history,
            execution_history: $execution_history,
            settings: $settings,
            lts: <datetime> $lts,
            ts: <datetime> $ts,
            local_date: $local_date,
            local_tz: $local_tz
        }`,
        variables: { ...data },
    };
}

/**
 * UPDATE an existing session by full id. `type::record()` is used because a
 * parameterized `$id` binds as a string — SurrealDB refuses string-typed
 * UPDATE targets and needs a record reference.
 */
export function updateSession(sessionId: string, data: SessionWriteFields): QuerySpec {
    return {
        query: `UPDATE type::record('sessions', $key) SET
            label = $label,
            message_count = $message_count,
            chat_history = $chat_history,
            workspace = $workspace,
            thought_history = $thought_history,
            execution_history = $execution_history,
            settings = $settings,
            lts = <datetime> $lts,
            ts = <datetime> $ts,
            local_date = $local_date,
            local_tz = $local_tz`,
        variables: { key: sessionKey(sessionId), ...data },
    };
}

/**
 * DELETE a session by full id.
 */
export function deleteSession(sessionId: string): QuerySpec {
    return {
        query: `DELETE type::record('sessions', $key)`,
        variables: { key: sessionKey(sessionId) },
    };
}
