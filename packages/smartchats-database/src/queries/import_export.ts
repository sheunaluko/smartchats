/**
 * Generic import / export query builders.
 *
 * Used by the MCP `import_user_data` / `export_user_data` tools to move
 * user state between deployments (cloud → local, etc.). The builders
 * here are intentionally generic SurrealQL constructors — they don't
 * know anything about the MCP transport, file paths, or pagination
 * orchestration; those stay in the consumer.
 *
 * Why these are not table-specific: the import pipeline streams over
 * arbitrary user-owned tables (logs, metrics, user_entities, app_data,
 * etc.) and writes each row generically. Dispatching to the right shape
 * (UPSERT vs RELATE) is the only schema-aware step, and it lives here
 * so all SurrealQL composition stays inside the database package.
 */

import type { QuerySpec } from '../types.js';

/**
 * Fields stripped from every imported row regardless of table. `id` is
 * already encoded in the record reference itself. `created_at` and
 * `updated_at` are physical row-lifecycle fields owned by the destination
 * DB (the schema's VALUE time::now() / READONLY would reject them anyway).
 * `owner` is a cloud-side multi-tenant invariant — local mode is single-user
 * and the field has no meaning there.
 *
 * `createdAt` / `updatedAt` (camelCase) are stripped for backward-compat
 * with bundles exported BEFORE the cortex schema normalization (cloud
 * 1.2.0 / local 1.4.0). Importing those bundles into a normalized
 * destination would otherwise leave orphan camelCase fields on cortex
 * rows alongside the new snake_case ones.
 */
export const IMPORT_STRIP_FIELDS = new Set([
    'id',
    'created_at',
    'updated_at',
    'owner',
    'createdAt',
    'updatedAt',
    // Legacy fields from pre-v1.0.0 schemas. Bundles exported before the
    // v1.0.0 event-time baseline may carry these — silently drop them on
    // import. The clean shape is ts/local_date/local_tz; legacy data
    // requiring conversion goes through `operations/convert_legacy_bundle.ts`
    // before being handed to the importer.
    'lts',
    // `metrics.timestamp` was the pre-v1.0.0 real-UTC column on metrics;
    // renamed to `ts` to unify with every other event-time table.
    'timestamp',
]);

/**
 * Match strings that are ISO 8601 datetime values. Used to detect fields
 * that need an explicit `<datetime>` cast in UPSERT — SurrealDB does NOT
 * coerce ISO strings to datetime values automatically; type validation on
 * `option<datetime>` fields rejects them. Allows optional fractional
 * seconds, requires `Z` suffix.
 */
export const ISO_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

/**
 * Tables declared `TYPE RELATION` in the local schema. Imports for these
 * tables go through `buildRelateQuery`; everything else uses
 * `buildUpsertQuery`. Currently single-entry; kept as a Set for cheap
 * extension.
 */
export const RELATION_TABLES = new Set(['user_relations']);

/**
 * Build an UPSERT query for one row.
 *
 * Why UPSERT and not UPDATE: SurrealDB's `UPDATE record:id MERGE {...}`
 * silently no-ops when the record doesn't exist — `status: OK, result: []`,
 * no error. UPSERT explicitly creates-or-updates and returns the row.
 *
 * Why SET (not MERGE): SurrealDB MERGE's payload variable doesn't allow
 * per-field type casts. We need `<datetime>` casts on ISO datetime
 * strings (and `<string>` casts on `local_date` to defeat SurrealDB
 * v3's HTTP-RPC auto-coercion of date-shaped strings into datetimes,
 * per the 2026-06-04 prod incident). SET with one binding per field
 * gives us per-field control.
 */
export function buildUpsertQuery(
    tableName: string,
    key: string,
    row: Record<string, unknown>,
): QuerySpec {
    const setClauses: string[] = [];
    const variables: Record<string, unknown> = { table_name: tableName, key };
    let counter = 0;

    for (const [field, value] of Object.entries(row)) {
        if (IMPORT_STRIP_FIELDS.has(field)) continue;
        // Defensive: reject fields with unsafe characters. Cloud-exported
        // fields are always identifier-shaped, but be paranoid since field
        // names interpolate into the query string.
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) continue;
        const varName = `v${counter++}`;
        if (typeof value === 'string' && ISO_DATETIME_RE.test(value)) {
            setClauses.push(`${field} = <datetime> $${varName}`);
        } else {
            setClauses.push(`${field} = $${varName}`);
        }
        variables[varName] = value;
    }

    return {
        query: `UPSERT type::record($table_name, $key) SET ${setClauses.join(', ')}`,
        variables,
    };
}

/**
 * Build a DELETE+RELATE query for a graph-edge row. Returns `null` if
 * the row is malformed (missing in/out as `table:key` strings).
 *
 * Why this exists: SurrealDB tables declared `TYPE RELATION` (currently
 * only `user_relations` in the local schema) reject plain UPSERT —
 * relations must be created via `RELATE @from -> rel -> @to`. RELATE
 * has no native upsert form, so DELETE-then-RELATE in a single
 * multi-statement request gives us idempotent re-import semantics.
 * `in` and `out` move from SET to the arrow positions; everything else
 * stays in SET (with the same `<datetime>` cast rules as
 * buildUpsertQuery).
 */
export function buildRelateQuery(
    tableName: string,
    key: string,
    row: Record<string, unknown>,
): QuerySpec | null {
    const inStr = row.in;
    const outStr = row.out;
    if (typeof inStr !== 'string' || typeof outStr !== 'string') return null;
    // SurrealDB record IDs split on the FIRST ':' — `key` may itself contain
    // colons (rare, but possible), so use indexOf+slice rather than split.
    const inSep = inStr.indexOf(':');
    const outSep = outStr.indexOf(':');
    if (inSep < 0 || outSep < 0) return null;
    const inTable = inStr.slice(0, inSep);
    const inKey = inStr.slice(inSep + 1);
    const outTable = outStr.slice(0, outSep);
    const outKey = outStr.slice(outSep + 1);

    const variables: Record<string, unknown> = {
        rel_table: tableName,
        rel_key: key,
        in_table: inTable,
        in_key: inKey,
        out_table: outTable,
        out_key: outKey,
    };

    const setClauses: string[] = [];
    let counter = 0;
    for (const [field, value] of Object.entries(row)) {
        if (IMPORT_STRIP_FIELDS.has(field)) continue;
        // `in`/`out` belong in the RELATE arrow positions, not SET — the
        // schema enforces them as relation endpoints, not regular fields.
        if (field === 'in' || field === 'out') continue;
        if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(field)) continue;
        const varName = `v${counter++}`;
        if (typeof value === 'string' && ISO_DATETIME_RE.test(value)) {
            setClauses.push(`${field} = <datetime> $${varName}`);
        } else {
            setClauses.push(`${field} = $${varName}`);
        }
        variables[varName] = value;
    }
    const setClause = setClauses.length > 0 ? ` SET ${setClauses.join(', ')}` : '';

    // SurrealDB v1.x parser does NOT accept `type::record(...)` directly in
    // the `->` arrow positions of a RELATE — it errors with `Unexpected
    // token ::, expected :`. The canonical programmatic form is to bind
    // record references via LET, then use the `$param` variables in the
    // arrow positions. Verified against running surreal v1.x.
    //
    // RELATE on an already-existing edge id is upsert-like (updates SET
    // fields). The DELETE before RELATE is belt-and-suspenders idempotency
    // so re-import always lands a fresh edge even if endpoints changed.
    const query = [
        `LET $in_rec = type::record($in_table, $in_key)`,
        `LET $rel_rec = type::record($rel_table, $rel_key)`,
        `LET $out_rec = type::record($out_table, $out_key)`,
        `DELETE $rel_rec`,
        `RELATE $in_rec -> $rel_rec -> $out_rec${setClause}`,
    ].join('; ') + ';';

    return { query, variables };
}

/**
 * Dispatcher: routes a row to the right query builder based on whether
 * the destination table is a graph-edge (RELATION) table or a normal
 * record table.
 */
export function buildImportQuery(
    tableName: string,
    key: string,
    row: Record<string, unknown>,
): QuerySpec | null {
    if (RELATION_TABLES.has(tableName)) {
        return buildRelateQuery(tableName, key, row);
    }
    return buildUpsertQuery(tableName, key, row);
}

/**
 * One page of a paginated full-table export. Returns rows ordered by
 * `id` so page boundaries are stable across calls — without ORDER BY,
 * SurrealDB's row order across pages is undefined and rows could repeat
 * or vanish. The caller chooses the page size (`limit`) — typically
 * small (~100) for tables with embedded vectors that exceed transport
 * size caps on a full-table SELECT.
 *
 * Note: `table` interpolates directly into the query string. Callers
 * MUST validate `table` against an allowlist before invoking — there
 * is no parameterized form for table identifiers in the FROM clause.
 */
export function exportTablePage(args: { table: string; limit: number; offset: number }): QuerySpec {
    return {
        query: `SELECT * FROM ${args.table} ORDER BY id LIMIT ${args.limit} START ${args.offset}`,
        variables: {},
    };
}
