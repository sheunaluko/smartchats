/**
 * Shared types for SmartChats query builders.
 *
 * Queries are pure data — `{ query, variables }` — produced by builder
 * functions and executed by per-consumer dispatchers (MCP server, CLI,
 * in-app via `getBackend().data.query()`). The dispatcher handles auth,
 * transport, and per-statement error checking; the builders concern
 * themselves only with SurrealQL composition.
 */

/**
 * A SurrealQL query plus its bound variables. Hand to a dispatcher to
 * execute. Variables use SurrealDB's `$name` placeholder syntax.
 */
export interface QuerySpec {
    query: string;
    variables: Record<string, unknown>;
}

/**
 * Common fields on user-data tables that carry the event-time convention
 * (created_at / updated_at = physical row lifecycle; lts/ts/local_date/local_tz
 * = the 1.5.0 event-time triple, plus legacy lts during the dual-write
 * window). See packages/smartchats-database/src/schema/local.ts header for
 * the full invariant.
 */
export interface AuditFields {
    /** Physical row creation time, server-stamped, READONLY. */
    created_at?: string;
    /** Physical row last-write time, server-stamped, auto-updated. */
    updated_at?: string;
    /** Legacy fake-UTC local wall-clock — dropped in 1.6.0. */
    lts?: string;
    /** Real-UTC event-time instant. */
    ts?: string;
    /** YYYY-MM-DD in the user's tz at the event. Indexed bucket key. */
    local_date?: string;
    /** IANA tz the user was in at the event. */
    local_tz?: string;
}

/**
 * The four-field event-time bundle written by every user-data insert in
 * the 1.5.0 → 1.6.0 dual-write window. Built once at the callsite via
 * apps/smartchats's `nowEventTime()` / `eventTimeAt()` and spread into
 * the builder args.
 *
 * `lts` is legacy (fake-UTC local wall-clock with `Z` suffix); dropped
 * in 1.6.0 by removing it from this interface — every builder and every
 * callsite that uses the bundle will auto-update.
 *
 * `ts` is the real-UTC instant. `local_date` is the indexed bucket key
 * (YYYY-MM-DD in the user's tz). `local_tz` is the IANA name for
 * re-derivation if buckets ever need to change.
 */
export interface EventTimeFields {
    lts: string;
    ts: string;
    local_date: string;
    local_tz: string;
}
