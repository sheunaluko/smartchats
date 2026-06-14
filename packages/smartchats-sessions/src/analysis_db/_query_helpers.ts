/**
 * Shared query-construction helpers for analysis_db/ modules.
 *
 * Every analyzer takes a `BaseFilter` (time window + dimensional filters)
 * and composes it with module-specific WHERE additions via
 * `buildFilterClause()`. The returned `{ where, vars }` plug into the
 * module's own SurrealQL template.
 *
 * Pure — no I/O. Time-shorthand parsing is local; epoch-ms / ISO inputs
 * pass through unchanged.
 */

/** Dimensional filters every analysis_db/ module accepts. */
export interface BaseFilter {
    /**
     * Lower bound on event timestamp. Accepts:
     *   - ISO 8601 string ("2026-06-14T00:00:00Z")
     *   - epoch milliseconds (1781429208807)
     *   - shorthand ("7d", "24h", "30m", "2w", "1y") — interpreted as
     *     "now minus this duration"
     */
    since?: string | number;
    /** Upper bound. Same accepted forms as `since`. Defaults to "now". */
    until?: string | number;
    /** Exact-match on `app_name`. */
    app?: string;
    /** Exact-match on `user_id`. */
    userId?: string;
    /** Exact-match on `session_id`. */
    sessionId?: string;
    /** Hard cap on rows. Per-module sensible default if omitted. */
    limit?: number;
}

/** Compiled WHERE pieces ready to splice into a query template. */
export interface FilterClause {
    /**
     * AND'd WHERE conditions WITHOUT the leading `WHERE` keyword. Empty
     * string if no filters apply. Composers prepend `WHERE` (or `AND`
     * if their query template already has a WHERE) at splice time.
     */
    where: string;
    /** Bound variables for the conditions. */
    vars: Record<string, unknown>;
    /** Resolved LIMIT (caller decides whether to use it). */
    limit?: number;
}

/**
 * Build a WHERE clause from a BaseFilter. Returns empty `where` when no
 * filters are set — callers must handle the no-WHERE case (typically
 * "if (where) { sql += ` WHERE ${where}` }").
 *
 * Convention: time-shorthand inputs are rendered as `time::now() - 7d`
 * literals (no variable binding needed) so the query reads cleanly when
 * dumped to logs. ISO / epoch values are bound as `$since` / `$until`.
 */
export function buildFilterClause(f: BaseFilter): FilterClause {
    const parts: string[] = [];
    const vars: Record<string, unknown> = {};

    const sinceClause = renderTimeBound(f.since, 'since', vars);
    if (sinceClause) parts.push(`timestamp > ${sinceClause}`);

    const untilClause = renderTimeBound(f.until, 'until', vars);
    if (untilClause) parts.push(`timestamp < ${untilClause}`);

    if (f.app) { parts.push(`app_name = $app`); vars.app = f.app; }
    if (f.userId) { parts.push(`user_id = $userId`); vars.userId = f.userId; }
    if (f.sessionId) { parts.push(`session_id = $sessionId`); vars.sessionId = f.sessionId; }

    return { where: parts.join(' AND '), vars, limit: f.limit };
}

/**
 * Compose two WHERE fragments with AND. Either may be empty. The result
 * is also empty if both are empty.
 *
 * Lets module-specific queries do:
 *   const filter = buildFilterClause(args);
 *   const where = combineWhere(filter.where, `event_type = 'execution'`);
 *   const sql = `SELECT ... FROM insights_events${where ? ' WHERE ' + where : ''} ...`;
 */
export function combineWhere(a: string, b: string): string {
    if (!a) return b;
    if (!b) return a;
    return `${a} AND ${b}`;
}

// ────────────────────────────────────────────────────────────────────────
// Internals
// ────────────────────────────────────────────────────────────────────────

const SHORTHAND_RE = /^(\d+)\s*(s|m|h|d|w|y)$/;

/**
 * Resolve a time bound input to a SurrealQL expression. Returns null if
 * the input is unset.
 *
 *   - Shorthand "7d" → `time::now() - 7d` (literal; SurrealDB-native duration)
 *   - Number       → bind as $name, render `<datetime> $name`
 *   - ISO string   → bind as $name, render `<datetime> $name`
 */
function renderTimeBound(
    value: string | number | undefined,
    name: 'since' | 'until',
    vars: Record<string, unknown>,
): string | null {
    if (value === undefined || value === null || value === '') return null;

    if (typeof value === 'string') {
        const m = value.match(SHORTHAND_RE);
        if (m) {
            const [, n, unit] = m;
            return `time::now() - ${n}${unit}`;
        }
        // Treat as ISO string.
        vars[name] = value;
        return `<datetime> $${name}`;
    }

    if (typeof value === 'number') {
        // epoch ms → ISO so SurrealDB casts cleanly
        vars[name] = new Date(value).toISOString();
        return `<datetime> $${name}`;
    }

    return null;
}
