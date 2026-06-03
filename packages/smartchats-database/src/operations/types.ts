/**
 * Shared types for cross-environment user-data operations
 * (`importBundle`, `exportBundle`).
 *
 * The bundle format is the wire contract between exporters and importers.
 * Bumps to `version` accompany breaking changes — importers reject older
 * unsupported versions explicitly rather than risk silent data loss.
 */

export interface Bundle {
    /**
     * Bundle wire-format version. v1 is the only currently-supported version.
     * Bump on field renames, table id-shape changes, anything that would make
     * an old importer write the wrong thing into a new schema.
     */
    version: 1;
    /** ISO 8601 timestamp when the bundle was produced. */
    exportedAt: string;
    /** Which deployment kind produced this bundle. */
    source: 'cloud' | 'local';
    /** Authenticated user-id at export time. Informational; the importer's
     *  current auth controls actual ownership of imported rows (server-side
     *  schema sets owner from $auth.id on insert). */
    userId: string;
    /**
     * Schema version the source DB was at when the export ran (e.g. "1.5.1").
     * Optional for back-compat with pre-2026-06-03 bundles that lack the
     * field. The importer uses it to:
     *   - log when bundle.schemaVersion < destination LOCAL_SCHEMA_VERSION
     *     (the importer's post-import applyLocalSchema converges the data),
     *   - warn loudly when bundle.schemaVersion > destination version
     *     (data may carry fields the importer doesn't know about — stored
     *     as ad-hoc fields on SCHEMALESS tables, not lost).
     * This is the SCHEMA version, distinct from the bundle wire-format
     * `version: 1` above.
     */
    schemaVersion?: string;
    /** Per-table arrays of row objects. Tables omitted from the bundle are
     *  skipped at import; empty arrays import to nothing (no-op). */
    tables: Record<string, unknown[]>;
}

/**
 * Default user-data tables exported when the caller doesn't pin a list.
 * These are the tables a typical user owns + cares about backing up:
 * logs/metrics, knowledge graph, app data, sessions, agent customizations.
 */
export const DEFAULT_EXPORT_TABLES = [
    'logs',
    'metrics',
    'user_entities',
    'user_relations',
    'user_data',
    'app_data',
    'sessions',
    'cortex',
    'cortex_dynamic_functions',
    'smartchats_apps',
    'smartchats_app_installs',
] as const;

/**
 * Tables only exported when `includeSensitive: true` is passed.
 * These hold material the caller should be explicit about including:
 *   - byo_api_keys: raw provider keys (treat the bundle as secret material).
 *   - usage_records: regenerable from upstream + billing-cycle dependent;
 *     usually not portable.
 */
export const SENSITIVE_TABLES = [
    'byo_api_keys',
    'usage_records',
] as const;

/**
 * Hard-blocked tables. Never exportable, even when explicitly listed in
 * the `tables` arg. These are pure telemetry that has no value across
 * deployments and would bloat the bundle.
 */
export const NEVER_EXPORT_TABLES: ReadonlySet<string> = new Set([
    'insights_events',
]);
