/**
 * Raw SurrealQL passthrough — for ad-hoc read-only queries.
 *
 * The MCP `run_query` tool exposes this with a SELECT-only safety check.
 * The check is conservative: it allows SELECT, RETURN, and LET (which
 * don't mutate state). UPDATE/CREATE/DELETE/REMOVE/DEFINE etc. are
 * rejected before the query reaches the dispatcher.
 *
 * This is defense-in-depth, not the primary auth boundary — the cloud
 * function's auth scope and the user's row-level permissions are the
 * real safeguards. The check exists to avoid accidental mutation from
 * an over-eager LLM caller.
 */

import type { QuerySpec } from '../types.js';

const READ_ONLY_PREFIXES = ['SELECT', 'RETURN', 'LET'];

export class NonReadOnlyQueryError extends Error {
    constructor(received: string) {
        super(`Only SELECT, RETURN, and LET queries are allowed. Got: ${received}`);
        this.name = 'NonReadOnlyQueryError';
    }
}

/**
 * Validate a raw query is read-only and produce a runnable spec. Throws
 * `NonReadOnlyQueryError` if the query starts with anything else.
 *
 * Note: `--`, `/*` comment prefixes etc. could fool this check; that's
 * acceptable since the actual security boundary is the cloud-function's
 * auth scope, not this prefix check.
 */
export function buildRawQuery(query: string, variables: Record<string, unknown> = {}): QuerySpec {
    const trimmed = query.trim();
    const upper = trimmed.toUpperCase();
    const allowed = READ_ONLY_PREFIXES.some((p) => upper.startsWith(p));
    if (!allowed) {
        throw new NonReadOnlyQueryError(upper.slice(0, 20));
    }
    return { query: trimmed, variables };
}
