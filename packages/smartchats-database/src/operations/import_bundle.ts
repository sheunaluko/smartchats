/**
 * importBundle — load a previously-exported user-data bundle into a
 * SmartChats deployment.
 *
 * Backend-agnostic: takes a `SmartChatsBackend` instance (FirebaseBackend
 * for cloud, LocalBackend for local) and writes via `backend.data.query`.
 * Per-row writes; the row id determines the table (`table:key`).
 *
 * Auth + ownership: the destination's schema sets `owner = $auth.id` on
 * insert, so rows always land owned by whoever the backend is
 * authenticated as. The bundle's original `owner` field is stripped at
 * write time (see `IMPORT_STRIP_FIELDS` in queries/import_export.ts).
 *
 * Concurrency: writes are SEQUENTIAL by default. Parallel UPSERTs of
 * rows containing 1536-dim embedding vectors crash SurrealDB workers
 * (`bytes::advance` panic) — server-internal bug under concurrent
 * vector writes. Sequential is ~13 min vs ~1 min parallel for ~800 rows;
 * safety wins. Override via `concurrency` if you know your bundle has no
 * embeddings.
 *
 * Schema convergence: importBundle does NOT call applyLocalSchema itself
 * (it's backend-agnostic and applyLocalSchema is local-only). When
 * importing a pre-1.5.0 bundle into a 1.5.1-stamped destination, the
 * imported rows arrive WITHOUT the post-1.5.0 fields (ts / local_date).
 * Callers MUST re-converge the destination's schema after import for
 * the new fields to get backfilled — `applyLocalSchema(db)` for the
 * local case, cloud-side server boot for the cloud case (cloud handles
 * its own schema lifecycle). The diff harness and the local CLI's
 * `smartchats data import` command both do this; the MCP
 * `import_user_data` tool will once it grows a local-target hook.
 *
 * bundle.schemaVersion (added 2026-06-03) is informational only — used
 * for warning logs when the bundle came from a different schema version
 * than the importer's process knows about.
 */

import type { DataAPI } from 'smartchats-backend';
import { buildImportQuery } from '../queries/import_export.js';
import { LOCAL_SCHEMA_VERSION } from '../schema/local.js';
import type { Bundle } from './types.js';

/** Compare two semver-ish version strings. Returns -1/0/1. Treats undefined as 0.0.0. */
function compareSemverLike(a: string | undefined, b: string): -1 | 0 | 1 {
    const parse = (v: string | undefined): number[] =>
        (v ?? '0.0.0').split('.').map((p) => parseInt(p, 10) || 0);
    const av = parse(a);
    const bv = parse(b);
    const max = Math.max(av.length, bv.length);
    for (let i = 0; i < max; i++) {
        const x = av[i] ?? 0;
        const y = bv[i] ?? 0;
        if (x < y) return -1;
        if (x > y) return 1;
    }
    return 0;
}

export interface ImportOptions {
    /**
     * Subset of bundle tables to import. Default: all tables in the bundle.
     * Useful for partial restores ("just my logs") or for skipping tables
     * that diverge from the destination schema.
     */
    tables?: string[];
    /**
     * Concurrency for per-row writes. Default 1 (sequential). Raise only
     * if you've verified the bundle has no embedding-bearing rows.
     */
    concurrency?: number;
    /**
     * If true, parse + count rows but don't write. Useful for previewing
     * a bundle without touching the destination.
     */
    dryRun?: boolean;
    /**
     * Optional progress callback fired once per row (after success or
     * failure). Use to drive a CLI progress bar. The shape is intentionally
     * minimal: caller derives totals + percentages from `rowsByTable`.
     */
    onProgress?: (info: ImportProgress) => void;
    /**
     * Optional log sink for informational messages (schema-version
     * mismatches, post-import advice). Falls through to silence when
     * omitted.
     */
    onLog?: (message: string) => void;
}

export interface ImportProgress {
    table: string;
    rowIndex: number; // zero-based within table
    rowsInTable: number;
    success: boolean;
    error?: string;
}

export interface ImportResult {
    /** True iff at least one row imported AND no row errors were recorded. */
    ok: boolean;
    /** Total rows successfully written across all tables. */
    rowsWritten: number;
    /** Total rows in the bundle (across the imported subset of tables). */
    rowsInBundle: number;
    /** Per-table breakdown. Order follows the imported subset of tables. */
    perTable: Array<{
        table: string;
        rows: number;
        written: number;
        failed: number;
        /** First error per table (the one most likely to be a systemic issue). */
        firstError?: string;
    }>;
    /** Bundle-level info copied from the input for convenience. */
    bundleSource: Bundle['source'];
    bundleUserId: string;
    bundleExportedAt: string;
}

/**
 * Drive a worker over `items` with up to `concurrency` parallel calls.
 * Pool model: `concurrency` workers loop pulling from a shared cursor
 * until the list is exhausted. Minimal allocation, no queue.
 */
async function runWithConcurrency<T>(
    items: T[],
    concurrency: number,
    worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
    let cursor = 0;
    const pool = Array.from(
        { length: Math.min(Math.max(concurrency, 1), items.length) },
        async () => {
            while (cursor < items.length) {
                const idx = cursor++;
                await worker(items[idx], idx);
            }
        },
    );
    await Promise.all(pool);
}

export async function importBundle(
    data: DataAPI,
    bundle: Bundle,
    opts: ImportOptions = {},
): Promise<ImportResult> {
    if (bundle.version !== 1) {
        throw new Error(
            `importBundle: unsupported bundle version: ${bundle.version}. Only v1 is supported.`,
        );
    }

    // Schema-version sanity check. Informational logging — does not abort.
    if (bundle.schemaVersion === undefined) {
        opts.onLog?.(
            `bundle predates schemaVersion stamping (pre-2026-06-03 export). ` +
            `Caller should run applyLocalSchema after import to converge fields.`,
        );
    } else {
        const cmp = compareSemverLike(bundle.schemaVersion, LOCAL_SCHEMA_VERSION);
        if (cmp < 0) {
            opts.onLog?.(
                `bundle schemaVersion ${bundle.schemaVersion} < destination ${LOCAL_SCHEMA_VERSION}. ` +
                `Post-import applyLocalSchema will backfill new fields.`,
            );
        } else if (cmp > 0) {
            opts.onLog?.(
                `WARNING: bundle schemaVersion ${bundle.schemaVersion} > destination ${LOCAL_SCHEMA_VERSION}. ` +
                `Bundle may carry fields the importer doesn't know about; they'll be stored as ad-hoc ` +
                `fields on SCHEMALESS tables. Upgrade smartchats-database to read them correctly.`,
            );
        }
    }

    const wantedTables = opts.tables ?? Object.keys(bundle.tables);
    const concurrency = opts.concurrency ?? 1;
    const dryRun = opts.dryRun ?? false;
    const onProgress = opts.onProgress;

    const perTable: ImportResult['perTable'] = [];
    let rowsWritten = 0;
    let rowsInBundle = 0;

    for (const table of wantedTables) {
        const rows = bundle.tables[table];
        if (!Array.isArray(rows)) {
            // Table missing from bundle — skip silently. (Not an error: caller
            // may pass a wider table list than the bundle contains.)
            continue;
        }

        rowsInBundle += rows.length;
        let written = 0;
        let failed = 0;
        let firstError: string | undefined;

        if (rows.length === 0) {
            perTable.push({ table, rows: 0, written: 0, failed: 0 });
            continue;
        }

        if (dryRun) {
            // Don't write; treat all rows as "would write." We still report
            // per-table counts so the caller can see what would happen.
            perTable.push({ table, rows: rows.length, written: rows.length, failed: 0 });
            rowsWritten += rows.length;
            continue;
        }

        await runWithConcurrency(
            rows as Array<Record<string, unknown>>,
            concurrency,
            async (row, idx) => {
                let success = false;
                let errorMsg: string | undefined;

                try {
                    if (typeof row.id !== 'string') {
                        throw new Error('row missing string `id` field');
                    }
                    // Row id format: `tablename:key`. Some keys contain ':'
                    // themselves (rare), so split on FIRST colon only.
                    const sep = (row.id as string).indexOf(':');
                    if (sep < 0) {
                        throw new Error(`row id missing ':' separator: ${row.id}`);
                    }
                    const tableName = (row.id as string).slice(0, sep);
                    const key = (row.id as string).slice(sep + 1);

                    const built = buildImportQuery(tableName, key, row);
                    if (!built) {
                        throw new Error('row could not be built (missing in/out for relation, or malformed)');
                    }

                    const result = await data.query(built);

                    // Find any failed statement. Multi-statement (RELATE
                    // path) returns multiple — surface the first ERR.
                    const failedStmt = result.statements.find((s) => s.status !== 'OK');
                    if (failedStmt) {
                        throw new Error(`statement ERR: ${String(failedStmt.result).slice(0, 200)}`);
                    }

                    // The write statement is the LAST one (UPSERT for record
                    // tables; RELATE for relation tables — last statement in
                    // the multi-statement script). Confirm it returned a row.
                    const writeStmt = result.statements[result.statements.length - 1];
                    const wroteRow =
                        writeStmt &&
                        Array.isArray(writeStmt.result) &&
                        (writeStmt.result as unknown[]).length > 0;
                    if (!wroteRow) {
                        throw new Error('write returned empty (no row written)');
                    }

                    success = true;
                    written++;
                    rowsWritten++;
                } catch (err) {
                    failed++;
                    errorMsg = (err as Error).message;
                    if (firstError === undefined) firstError = errorMsg;
                }

                if (onProgress) {
                    onProgress({
                        table,
                        rowIndex: idx,
                        rowsInTable: rows.length,
                        success,
                        error: errorMsg,
                    });
                }
            },
        );

        perTable.push({ table, rows: rows.length, written, failed, firstError });
    }

    return {
        ok: rowsWritten > 0 && perTable.every((t) => t.failed === 0),
        rowsWritten,
        rowsInBundle,
        perTable,
        bundleSource: bundle.source,
        bundleUserId: bundle.userId,
        bundleExportedAt: bundle.exportedAt,
    };
}
