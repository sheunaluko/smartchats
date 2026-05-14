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
 * Common fields on user-data tables that carry the dual-field timestamp
 * invariant (created_at / updated_at = physical row lifecycle, lts =
 * logical event time). See packages/smartchats-local-server/src/schema.ts
 * header for the full invariant.
 */
export interface AuditFields {
    /** Physical row creation time, server-stamped, READONLY. */
    created_at?: string;
    /** Physical row last-write time, server-stamped, auto-updated. */
    updated_at?: string;
    /** Logical event time — when the thing this row represents happened in user time. */
    lts?: string;
}
