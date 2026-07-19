/**
 * Batched startup context — merges 3 small independent loaders (init
 * instructions, procedural instructions, log-category summaries) into a
 * single multi-statement SurrealQL query so boot fires 1 network
 * roundtrip instead of 4.
 *
 * Backs the individual `fetchInitInstructions`, `fetchProceduralInstructions`,
 * and `fetchLogCategories` module functions — each awaits the shared
 * memoized batch and returns its slice. First caller triggers the fetch;
 * subsequent callers dedupe on the same promise.
 *
 * On any write that mutates one of the 3 fetch groups, call
 * `resetStartupContextBatch()` alongside the existing loader reset so
 * the next fetch picks up fresh data.
 *
 * The multi-statement pattern is native to SurrealDB: statements are
 * separated by `;` and each returns its own `{status, result, time}`
 * tuple in the response array.
 */

import { getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';

export interface StartupContextBatch {
    init: any[];
    procedural: any[];
    log_categories: any[];
    prepared_log_categories: any[];
}

let _promise: Promise<StartupContextBatch> | null = null;

/**
 * Returns the memoized batch. First caller fires the multi-statement
 * query; subsequent callers dedupe. On failure, populates all four
 * fields with empty arrays so downstream callers can still proceed.
 */
export function getStartupContextBatch(): Promise<StartupContextBatch> {
    if (!_promise) _promise = fetchBatch();
    return _promise;
}

/**
 * Invalidate the batch. Next `getStartupContextBatch()` will re-fetch.
 * Called from every write path that mutates init / procedural / log
 * category data.
 */
export function resetStartupContextBatch(): void {
    _promise = null;
}

async function fetchBatch(): Promise<StartupContextBatch> {
    try {
        // Compose the 4 statements into one query. Each existing builder
        // returns { query, variables: {} } (none of these builders use
        // parameters), so we can concatenate the query strings safely
        // with `;` separators.
        const init = queries.getInitInstructions();
        const proc = queries.getProceduralInstructions();
        const logCat = queries.getLogCategories();
        const logPrep = queries.getPreparedLogCategories();

        const multi = [init.query, proc.query, logCat.query, logPrep.query].join(';\n');

        const res: any = await getBackend().data.query({ query: multi, variables: {} });
        const statements: any[] = Array.isArray(res?.statements) ? res.statements : [];

        return {
            init:                    unwrap(statements[0]),
            procedural:              unwrap(statements[1]),
            log_categories:          unwrap(statements[2]),
            prepared_log_categories: unwrap(statements[3]),
        };
    } catch {
        // Cache the empty batch so we don't retry a rejecting fetch on every
        // caller. The individual write-path resets (resetStartupContextBatch)
        // will re-arm this promise on the next legitimate change.
        return { init: [], procedural: [], log_categories: [], prepared_log_categories: [] };
    }
}

function unwrap(stmt: any): any[] {
    if (!stmt) return [];
    if (stmt.status && stmt.status !== 'OK') return [];
    const r = stmt.result;
    return Array.isArray(r) ? r : (r == null ? [] : [r]);
}
