/**
 * exportBundle — produce a portable user-data bundle from a SmartChats
 * deployment, ready to be saved to disk + later restored via importBundle.
 *
 * Backend-agnostic: takes a `SmartChatsBackend` instance and reads via
 * `backend.data.query`. Per-table paginated SELECT * with ORDER BY id
 * (stable page boundaries — without ORDER BY, SurrealDB's row order
 * across pages is undefined and rows can repeat or vanish).
 *
 * The pagination is necessary for tables that carry embeddings (logs,
 * user_entities, user_relations — 1536-float vectors at ~12 KB raw per
 * row): a single SELECT * trips Firebase's httpsCallable response cap
 * (~32 MB) and the default function timeout (60s). Page size 100 keeps
 * each round-trip well below both.
 */

import type { DataAPI } from 'smartchats-backend';
import { exportTablePage } from '../queries/import_export.js';
import { LOCAL_SCHEMA_VERSION } from '../schema/local.js';
import {
    DEFAULT_EXPORT_TABLES,
    SENSITIVE_TABLES,
    NEVER_EXPORT_TABLES,
    type Bundle,
} from './types.js';

export interface ExportOptions {
    /**
     * Tables to export. Default: DEFAULT_EXPORT_TABLES.
     * Listing a NEVER_EXPORT_TABLES entry here is silently dropped.
     */
    tables?: string[];
    /**
     * Also export SENSITIVE_TABLES (byo_api_keys, usage_records) when no
     * explicit `tables` list is supplied. Ignored if `tables` is set.
     */
    includeSensitive?: boolean;
    /**
     * Page size for paginated SELECT *. Default 100. Lower if you hit
     * response-size or timeout caps; raise if profiling shows headroom.
     */
    pageSize?: number;
    /** Optional progress callback fired once per completed table. */
    onProgress?: (info: ExportProgress) => void;
    /**
     * Source label baked into the bundle. Caller decides — typically
     * 'cloud' for FirebaseBackend and 'local' for LocalBackend. Used to
     * identify the bundle's origin for cross-deployment migration audit.
     */
    source: 'cloud' | 'local';
    /**
     * Authenticated user-id at export time. Caller resolves from auth
     * (Firebase UID for cloud, 'local' sentinel for local single-user).
     * Stored in the bundle for informational purposes; the importer's
     * current auth controls actual ownership of imported rows.
     */
    userId: string;
}

export interface ExportProgress {
    table: string;
    rows: number;
    error?: string;
}

export interface ExportResult {
    /** The assembled bundle, ready to be `JSON.stringify`'d to disk. */
    bundle: Bundle;
    /** Tables silently dropped because they're in NEVER_EXPORT_TABLES. */
    blockedTables: string[];
    /** Per-table outcome (in the order they were fetched). */
    perTable: Array<{ table: string; rows: number; error?: string }>;
}

const DEFAULT_PAGE_SIZE = 100;

export async function exportBundle(
    data: DataAPI,
    opts: ExportOptions,
): Promise<ExportResult> {
    const requestedTables = opts.tables ?? [
        ...DEFAULT_EXPORT_TABLES,
        ...(opts.includeSensitive ? SENSITIVE_TABLES : []),
    ];
    const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
    const onProgress = opts.onProgress;

    const blockedTables = requestedTables.filter((t) => NEVER_EXPORT_TABLES.has(t));
    const targetTables = requestedTables.filter((t) => !NEVER_EXPORT_TABLES.has(t));

    const bundle: Bundle = {
        version: 1,
        exportedAt: new Date().toISOString(),
        source: opts.source,
        userId: opts.userId,
        // Schema version stamped at export time. Distinct from the bundle
        // wire-format `version: 1`. Lets the importer detect cross-schema
        // imports (bundle was on a different schema than the destination).
        // Note: for cloud sources, LOCAL_SCHEMA_VERSION here is the local
        // schema's constant from the exporter's process — it may diverge
        // from what the cloud DB actually has if the cloud schema is on a
        // different track. That's a future cleanup; for in-deployment
        // exports (local ↔ local) it's exact.
        schemaVersion: LOCAL_SCHEMA_VERSION,
        tables: {},
    };

    const perTable: ExportResult['perTable'] = [];

    for (const table of targetTables) {
        try {
            const rows = await fetchTablePaginated(data, table, pageSize);
            bundle.tables[table] = rows;
            perTable.push({ table, rows: rows.length });
            if (onProgress) onProgress({ table, rows: rows.length });
        } catch (err) {
            const error = (err as Error).message ?? String(err);
            // On error, store an empty array so the bundle remains structurally
            // complete (importer logic treats empty arrays as no-op for that
            // table — matches the "best-effort, partial-success" model).
            bundle.tables[table] = [];
            perTable.push({ table, rows: 0, error });
            if (onProgress) onProgress({ table, rows: 0, error });
        }
    }

    return { bundle, blockedTables, perTable };
}

/**
 * Loop SELECT * with LIMIT/START until a short page comes back (signals
 * end of table). Page builder is in `queries/import_export.ts` — this
 * function only owns the iteration.
 */
async function fetchTablePaginated(
    data: DataAPI,
    table: string,
    pageSize: number,
): Promise<unknown[]> {
    const all: unknown[] = [];
    let offset = 0;
    while (true) {
        const spec = exportTablePage({ table, limit: pageSize, offset });
        const result = await data.query(spec);
        const rows = result.rows;
        all.push(...rows);
        if (rows.length < pageSize) break;
        offset += pageSize;
    }
    return all;
}
