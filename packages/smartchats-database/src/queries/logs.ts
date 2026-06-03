/**
 * Log query builders.
 *
 * The `logs` table stores user journal entries with optional embeddings
 * for semantic search. Display sort is by `created_at` (real UTC) for
 * recency; date-range filters use `lts` (logical/wall-clock time) so
 * day boundaries align with the user's local time.
 */

import type { QuerySpec, AuditFields, EventTimeFields } from '../types.js';

export interface LogRow extends AuditFields {
    id: string;
    content: string;
    category?: string;
    /** IANA timezone the lts was stamped in. */
    local_tz?: string;
}

/**
 * Aggregate log counts by category. Used to surface what kinds of data
 * the user is logging.
 */
export function getLogCategories(): QuerySpec {
    return {
        query: `SELECT category, count() AS count FROM logs GROUP BY category ORDER BY count DESC`,
        variables: {},
    };
}

// ── Prepared category definitions ──────────────────────────────────────────

/**
 * Fetch all "log_category_definition" rows from `user_data` — categories
 * the user has expressed interest in but not yet logged any entries for.
 * Surfaced alongside `getLogCategories()` so the UI can show prepared
 * categories with count: 0.
 */
export function getPreparedLogCategories(): QuerySpec {
    return {
        query: `SELECT * FROM user_data WHERE type = 'log_category_definition'`,
        variables: {},
    };
}

// ── Insert a log ────────────────────────────────────────────────────────────

export interface InsertLogArgs extends EventTimeFields {
    content: string;
    category: string;
    embedding: unknown;
}

/**
 * INSERT a new log row. Embedding is parameter-bound so vectors don't
 * inline into the query string. Dual-writes `lts` (legacy fake-UTC) and
 * `ts`/`local_date`/`local_tz` (the 1.5.0 event-time convention) during
 * the migration window; `lts` is dropped in 1.6.0.
 */
export function insertLog(args: InsertLogArgs): QuerySpec {
    return {
        query: `INSERT INTO logs {
                        content: $content,
                        category: $category,
                        embedding: $embedding,
                        lts: <datetime> $lts,
                        ts: <datetime> $ts,
                        local_date: $local_date,
                        local_tz: $local_tz
                    }`,
        variables: { ...args },
    };
}

// ── Update a log ───────────────────────────────────────────────────────────

/**
 * Updateable fields of a log row. Caller picks which to set; missing
 * fields are left untouched.
 */
export interface UpdateLogPatch {
    content?: string;
    embedding?: unknown;
    category?: string;
    /** Fake-UTC ISO datetime (`YYYY-MM-DDTHH:MM:00Z`). When set, `ts`/`local_date`/`local_tz` should be set together. */
    lts?: string;
    /** Real-UTC ISO datetime. */
    ts?: string;
    /** YYYY-MM-DD in the user's tz. */
    local_date?: string;
    local_tz?: string;
}

/**
 * UPDATE a log row by full record id (`logs:abc`). `updated_at` is
 * always bumped. Returns `null` when the patch contains no settable
 * fields — caller decides how to surface "nothing to update".
 */
export function updateLog(args: { recordId: string; patch: UpdateLogPatch }): QuerySpec | null {
    const key = args.recordId.includes(':') ? args.recordId.slice(args.recordId.indexOf(':') + 1) : args.recordId;
    const setClauses: string[] = ['updated_at = time::now()'];
    const variables: Record<string, unknown> = { log_id: key };

    if (args.patch.content !== undefined) {
        setClauses.push('content = $content');
        variables.content = args.patch.content;
    }
    if (args.patch.embedding !== undefined) {
        setClauses.push('embedding = $embedding');
        variables.embedding = args.patch.embedding;
    }
    if (args.patch.category !== undefined) {
        setClauses.push('category = $category');
        variables.category = args.patch.category;
    }
    if (args.patch.lts !== undefined) {
        setClauses.push('lts = <datetime> $lts');
        variables.lts = args.patch.lts;
    }
    if (args.patch.ts !== undefined) {
        setClauses.push('ts = <datetime> $ts');
        variables.ts = args.patch.ts;
    }
    if (args.patch.local_date !== undefined) {
        setClauses.push('local_date = $local_date');
        variables.local_date = args.patch.local_date;
    }
    if (args.patch.local_tz !== undefined) {
        setClauses.push('local_tz = $local_tz');
        variables.local_tz = args.patch.local_tz;
    }

    if (setClauses.length === 1) return null;
    return {
        query: `UPDATE type::record('logs', $log_id) SET ${setClauses.join(', ')}`,
        variables,
    };
}

// ── Filtered list / search (canonical log-lookup builder) ─────────────────

/**
 * Common filter envelope used by `get_recent_logs`, `search_logs`,
 * and `show_logs_grid` — composes category + lts-range + (optional)
 * substring-content-match.
 *
 * Replaces the previous `getRecentLogs` and `searchLogs` per-consumer
 * helpers — those were special cases of this same shape. When `searchText`
 * is omitted this is a plain "recent N" query; when present, it adds the
 * NULL-safe substring match.
 *
 * `ltsFilter` is a SurrealQL fragment beginning with ` AND ...` (or empty)
 * — built by the caller's tz-aware date-range helper. Embedding it as raw
 * SurrealQL preserves the historical behavior where date literals are
 * `d'...'` rather than parameter-bound.
 */
export interface ListLogsArgs {
    /** Filter by category. Lowercased internally. */
    category?: string;
    /**
     * Pre-built `' AND <predicate>'` SurrealQL fragment, or `''`. Typically
     * a local_date range (calendar filter) or a ts >= cutoff (duration
     * filter). Built by the caller's date-resolution helper.
     */
    dateFilter?: string;
    /** Optional substring search; case-insensitive across `content`. */
    searchText?: string;
    /** Cap result count. Default 20, capped at 100 for safety. */
    limit?: number;
}

/**
 * General-purpose log list/search builder. Supports any combination of
 * category filter, date filter, and content substring search.
 *
 * Sort is `ts DESC` — real-UTC instant, monotonic across DST and travel.
 * The previous `ORDER BY lts DESC` was preserved here for the dual-write
 * window; switched in 1.5.0 step 3 once every callsite populates `ts`.
 *
 * Projection includes both `lts` (legacy, dropped in 1.6.0) and `ts`/
 * `local_date` (1.5.0 convention) so MCP/UI consumers can migrate at
 * their own pace during the dual-read window.
 */
export function listLogs(args: ListLogsArgs): QuerySpec {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    const conditions: string[] = [];
    const variables: Record<string, unknown> = {};

    if (args.searchText !== undefined) {
        // `logs` is SCHEMALESS — `content` can be NONE, a string, or even a
        // record link if upstream writes are sloppy. `string::lowercase()`
        // errors on the non-string cases and kills the whole query (not
        // just the bad row). `type::is_string()` covers both NONE and
        // bad-type cases in one predicate; bad rows are silently skipped.
        conditions.push('type::is_string(content)');
        conditions.push('string::lowercase(content) CONTAINS string::lowercase($search_text)');
        variables.search_text = args.searchText.trim();
    }

    if (args.category) {
        conditions.push('category = $category');
        variables.category = args.category.toLowerCase();
    }

    let where = '';
    if (conditions.length > 0 || args.dateFilter) {
        where = 'WHERE ';
        if (conditions.length > 0) {
            where += conditions.join(' AND ');
        } else {
            // dateFilter is suffixed with " AND ..." — needs a baseline truthy
            // expression on its own.
            where += 'true';
        }
        if (args.dateFilter) where += args.dateFilter;
    }

    return {
        query: `SELECT id, content, category, created_at, lts, ts, local_date, local_tz FROM logs ${where} ORDER BY ts DESC LIMIT ${limit}`,
        variables,
    };
}

// ── Semantic search (KNN) ──────────────────────────────────────────────────

export interface SearchLogsSemanticArgs {
    embedding: unknown;
    category?: string;
    limit: number;
    effort?: number;
}

/**
 * KNN semantic search across log embeddings. Returns the top-N rows by
 * vector distance, with optional category filter applied as a second-stage
 * predicate. Default `effort` is 40 (matches in-app default).
 */
export function searchLogsSemantic(args: SearchLogsSemanticArgs): QuerySpec {
    const effort = args.effort ?? 40;
    const conditions: string[] = [`embedding <|${args.limit},${effort}|> $embedding`];
    const variables: Record<string, unknown> = { embedding: args.embedding };
    if (args.category) {
        conditions.push('category = $category');
        variables.category = args.category;
    }
    return {
        query: `SELECT id, content, category, created_at, lts, vector::distance::knn() AS distance FROM logs WHERE ${conditions.join(' AND ')} ORDER BY distance LIMIT ${args.limit}`,
        variables,
    };
}

// ── Prepared category lifecycle ────────────────────────────────────────────

/**
 * Look up a single log row by category — used by `prepare_log_category`
 * to detect whether the category already has actual entries.
 */
export function findLogByCategory(category: string): QuerySpec {
    return {
        query: `SELECT category FROM logs WHERE category = $cat LIMIT 1`,
        variables: { cat: category },
    };
}

/**
 * Look up a single `log_category_definition` row by category — used by
 * `prepare_log_category` to detect whether the category is already prepared.
 */
export function findPreparedLogCategory(category: string): QuerySpec {
    return {
        query: `SELECT * FROM user_data WHERE type = 'log_category_definition' AND data.category = $cat LIMIT 1`,
        variables: { cat: category },
    };
}

/**
 * INSERT a new `log_category_definition` row — registers a category the
 * user wants to journal in but hasn't yet logged any entries for.
 */
export function insertPreparedLogCategory(args: { category: string; description: string }): QuerySpec {
    return {
        query: `INSERT INTO user_data {
                            type: 'log_category_definition',
                            data: {
                                category: $category,
                                description: $description
                            },
                            created_at: time::now()
                        }`,
        variables: { ...args },
    };
}
