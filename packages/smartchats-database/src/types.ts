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
 * Common fields on user-data tables that carry the event-time
 * convention. See `schema/local.ts` header for the full invariant.
 *
 *   created_at / updated_at — physical row lifecycle, DB-stamped.
 *   ts                      — real-UTC instant the event happened.
 *   local_date              — YYYY-MM-DD in the user's tz at the event.
 *   local_tz                — IANA tz the user was in.
 */
export interface AuditFields {
    /** Physical row creation time, server-stamped, READONLY. */
    created_at?: string;
    /** Physical row last-write time, server-stamped, auto-updated. */
    updated_at?: string;
    /** Real-UTC event-time instant. */
    ts?: string;
    /** YYYY-MM-DD in the user's tz at the event. Indexed bucket key. */
    local_date?: string;
    /** IANA tz the user was in at the event. */
    local_tz?: string;
}

/**
 * Event-time bundle written by every user-data insert. Built once at
 * the callsite via apps/smartchats's `nowEventTime()` / `eventTimeAt()`
 * and spread into the builder args.
 *
 *   ts          — real-UTC instant the event happened
 *   local_date  — indexed bucket key (YYYY-MM-DD in user's tz)
 *   local_tz    — IANA name for re-derivation if buckets ever change
 */
export interface EventTimeFields {
    ts: string;
    local_date: string;
    local_tz: string;
}
