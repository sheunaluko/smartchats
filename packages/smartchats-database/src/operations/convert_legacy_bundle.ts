/**
 * convertLegacyBundle — one-shot transform: pre-v1.0.0 bundle → v1.0.0 clean.
 *
 * Pre-v1.0.0 bundles (anything exported before 2026-06-03) carry the
 * legacy event-time shape:
 *   - `lts: <fake-UTC ISO>` — user-local wall-clock with a fake `Z`
 *     suffix on logs/sessions/user_entities/user_relations/user_data/metrics
 *   - `lts: <real-UTC ISO>` — real UTC on usage_records (server-stamped
 *     differently from the user-data tables, but same column name)
 *   - `timestamp: <real-UTC ISO>` — additional real-UTC field on metrics
 *   - No `ts`, no `local_date`, no `local_tz` (the v1.0.0 fields)
 *
 * v1.0.0 destinations require ts/local_date/local_tz on every
 * event-time row. This function derives them and strips the legacy
 * fields so the result imports cleanly.
 *
 * Derivation:
 *   - For metrics (was lts=fake-UTC, timestamp=real-UTC):
 *       ts          := row.timestamp ?? row.lts  (prefer real-UTC if both present)
 *       local_date  := first 10 chars of lts (which IS the YYYY-MM-DD prefix
 *                      because lts was the user's local wall-clock)
 *       local_tz    := row.local_tz ?? assumedTz
 *   - For usage_records (lts=real-UTC, server-stamped):
 *       ts          := row.lts
 *       local_date  := first 10 chars of lts (UTC date, matches the
 *                      v1.0.0 usage_records convention — buckets are
 *                      UTC days for this table)
 *       local_tz    := 'UTC'
 *   - For all other user-data tables (lts=fake-UTC):
 *       ts          := row.lts (slightly off by tz offset — best-effort
 *                      for pre-v1.0.0 data which never recorded real-UTC
 *                      separately. Wall-clock ordering is preserved.)
 *       local_date  := first 10 chars of lts
 *       local_tz    := row.local_tz ?? assumedTz
 *
 * Why `assumedTz`: pre-v1.0.0 user-data tables didn't always record
 * `local_tz`. For backfill we have to assume one; defaults to
 * "America/Chicago" (matches the original deployment's user). Caller
 * can override.
 *
 * This file is INTENTIONALLY OUTSIDE the schema migrations array. It's a
 * one-shot data transform, not a schema invariant. Once everyone has
 * migrated to v1.0.0, this can be deleted.
 */

import type { Bundle } from './types.js';

export interface ConvertLegacyBundleOptions {
    /**
     * Default IANA tz for rows missing `local_tz`. Pre-v1.0.0 user-data
     * tables only sometimes recorded the tz; we fall back to this when
     * absent. Defaults to 'America/Chicago' (the original deployment).
     */
    assumedTz?: string;
}

export interface ConvertLegacyBundleResult {
    bundle: Bundle;
    /** Per-table conversion stats. */
    perTable: Array<{
        table: string;
        rows: number;
        converted: number;
        skipped: number;
        skippedReasons: string[];
    }>;
    /** True if the input was clearly pre-v1.0.0 (had `lts` somewhere). */
    wasLegacy: boolean;
}

const EVENT_TIME_TABLES = new Set([
    'logs', 'sessions', 'user_entities', 'user_relations',
    'user_data', 'metrics', 'usage_records',
]);

/**
 * Convert a pre-v1.0.0 bundle to the v1.0.0 clean shape.
 *
 * If the bundle is ALREADY v1.0.0 (has `schemaVersion: '1.0.0'`), this
 * function returns it untouched (with wasLegacy=false). Idempotent.
 */
export function convertLegacyBundle(
    bundle: Bundle,
    opts: ConvertLegacyBundleOptions = {},
): ConvertLegacyBundleResult {
    const assumedTz = opts.assumedTz ?? 'America/Chicago';

    // Already on v1.0.0? Pass through.
    if (bundle.schemaVersion === '1.0.0') {
        return {
            bundle,
            perTable: Object.entries(bundle.tables).map(([table, rows]) => ({
                table,
                rows: Array.isArray(rows) ? rows.length : 0,
                converted: 0,
                skipped: 0,
                skippedReasons: [],
            })),
            wasLegacy: false,
        };
    }

    const converted: Bundle = {
        ...bundle,
        schemaVersion: '1.0.0',
        tables: {},
    };
    const perTable: ConvertLegacyBundleResult['perTable'] = [];
    let sawLts = false;

    for (const [tableName, rows] of Object.entries(bundle.tables)) {
        if (!Array.isArray(rows)) {
            converted.tables[tableName] = [];
            perTable.push({ table: tableName, rows: 0, converted: 0, skipped: 0, skippedReasons: [] });
            continue;
        }

        if (!EVENT_TIME_TABLES.has(tableName)) {
            // Non-event-time table — pass through unchanged.
            converted.tables[tableName] = rows;
            perTable.push({
                table: tableName, rows: rows.length, converted: rows.length, skipped: 0, skippedReasons: [],
            });
            continue;
        }

        let convertedCount = 0;
        let skippedCount = 0;
        const skipReasons: string[] = [];
        const outRows: unknown[] = [];

        for (const raw of rows) {
            if (raw === null || typeof raw !== 'object') {
                skippedCount++;
                if (skipReasons.length < 3) skipReasons.push('row not an object');
                continue;
            }
            const row = { ...(raw as Record<string, unknown>) };

            const lts = typeof row.lts === 'string' ? row.lts : undefined;
            const timestamp = typeof row.timestamp === 'string' ? row.timestamp : undefined;
            if (lts) sawLts = true;

            // Derive the v1.0.0 event-time triple.
            let ts: string | undefined;
            let local_date: string | undefined;
            let local_tz: string | undefined;

            if (tableName === 'metrics') {
                // metrics: lts was fake-UTC local, timestamp was real-UTC.
                ts = timestamp ?? lts;
                local_date = lts?.slice(0, 10);
            } else if (tableName === 'usage_records') {
                // usage_records: lts was real-UTC (server-stamped).
                ts = lts;
                local_date = lts?.slice(0, 10);
                local_tz = 'UTC';
            } else {
                // Other tables: lts was fake-UTC local wall-clock.
                ts = lts;
                local_date = lts?.slice(0, 10);
            }

            if (local_tz === undefined) {
                local_tz = typeof row.local_tz === 'string' ? row.local_tz : assumedTz;
            }

            if (!ts || !local_date || !local_tz) {
                skippedCount++;
                if (skipReasons.length < 3) {
                    skipReasons.push(`row missing event-time derivation source (id=${String(row.id ?? '?')})`);
                }
                continue;
            }

            // Strip legacy fields, set new ones.
            delete row.lts;
            delete row.timestamp;
            row.ts = ts;
            row.local_date = local_date;
            row.local_tz = local_tz;

            outRows.push(row);
            convertedCount++;
        }

        converted.tables[tableName] = outRows;
        perTable.push({
            table: tableName,
            rows: rows.length,
            converted: convertedCount,
            skipped: skippedCount,
            skippedReasons: skipReasons,
        });
    }

    return { bundle: converted, perTable, wasLegacy: sawLts };
}
