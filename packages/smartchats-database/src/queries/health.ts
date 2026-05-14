/**
 * Health-probe query builders.
 *
 * Used by the local server's `/health` aggregate readiness endpoint and
 * the `/data/health` per-table check. The table-existence probe is a
 * single-row SELECT against `type::table($t)` which round-trips the DB
 * connection and verifies the destination table is reachable, without
 * caring what (if anything) is in it.
 */

import type { QuerySpec } from '../types.js';

/**
 * Single-row SELECT against an arbitrary table — used as a connectivity
 * + table-existence probe. Returns `[]` on an empty table, errors if the
 * table doesn't exist or the DB is unreachable.
 */
export function probeTableExists(table: string): QuerySpec {
    return {
        query: `SELECT * FROM type::table($t) LIMIT 1`,
        variables: { t: table },
    };
}
