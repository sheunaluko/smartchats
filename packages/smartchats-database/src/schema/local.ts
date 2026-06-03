/**
 * SurrealDB schema for self-hosted SmartChats (local single-user mode).
 *
 * Single-user trusted mode — all rows are owned by the running user.
 *
 * ─── Event-time convention (v1.0.0 baseline) ──────────────────────
 *
 *   created_at / updated_at   — physical row lifecycle in *this* database.
 *                               DB-stamped via `VALUE time::now() READONLY`.
 *                               Authoritative for audit / GC / debugging.
 *                               Never user-supplied. Never migrated across DBs.
 *
 *   ts                        — real-UTC instant the event happened. App-
 *                               stamped at write time. Used for ordering
 *                               (`ORDER BY ts DESC`) and cross-system
 *                               comparison. Preserved across export/import.
 *
 *   local_date                — YYYY-MM-DD string in the user's tz at the
 *                               event moment. App-computed at write time
 *                               from `(ts, local_tz)`. Indexed bucket key
 *                               for daily aggregation (`GROUP BY local_date`).
 *
 *   local_tz                  — IANA tz the user was in (e.g.
 *                               "America/Chicago"). Lets us re-derive
 *                               `local_date` if buckets ever need to change.
 *
 * Tables that carry the event-time triple: logs, sessions, user_entities,
 * user_relations, user_data, metrics, usage_records. All use the same
 * field names — no per-table column-name divergence.
 *
 * ─── Migration policy ─────────────────────────────────────────────
 *
 * v1.0.0 is the baseline. `LOCAL_SCHEMA_MIGRATIONS` is intentionally
 * EMPTY. Future versions add entries here when external users have data
 * in a previous version that needs converging. Until then, the DDL
 * itself is the contract — `applyLocalSchema` just applies it.
 *
 * For one-off conversions of legacy bundles (e.g. data exported from
 * smartchats-cloud before the event-time refactor), use
 * `operations/convert_legacy_bundle.ts` — a pure transform that runs
 * outside the schema layer.
 *
 * `LOCAL_SCHEMA_VERSION` is still maintained for diagnostics. Bump it
 * when DDL changes; the `_schema_version:current` row gets stamped on
 * every apply.
 */

/**
 * Minimal SurrealDB-shaped DB interface used by `applyLocalSchema`.
 * Accepts the local-server's `Surreal` instance directly. Implementations
 * also live in `data_api.ts` (cloud + local DataAPI adapters).
 */
export interface LocalSchemaDb {
    query(query: string, variables?: Record<string, unknown>): Promise<unknown>;
}

/** Optional logger surface — defaults to no-op. */
export interface LocalSchemaLogger {
    info?: (msg: string) => void;
    success?: (msg: string) => void;
}

export const LOCAL_SCHEMA_VERSION = '1.0.0';

export const LOCAL_DDL = `
-- ─── schema version marker ────────────────────────────────────────
DEFINE TABLE IF NOT EXISTS _schema_version SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS version ON _schema_version TYPE string;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_version TYPE datetime VALUE time::now();

-- ─── logs: user journal / event stream ────────────────────────────
DEFINE TABLE IF NOT EXISTS logs SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON logs TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON logs TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS ts ON logs TYPE datetime;
DEFINE FIELD IF NOT EXISTS local_date ON logs TYPE string;
DEFINE FIELD IF NOT EXISTS local_tz ON logs TYPE string;
DEFINE INDEX IF NOT EXISTS logs_created_at ON logs FIELDS created_at;
DEFINE INDEX IF NOT EXISTS logs_ts ON logs FIELDS ts;
DEFINE INDEX IF NOT EXISTS logs_local_date ON logs FIELDS local_date;
DEFINE INDEX IF NOT EXISTS logs_embedding ON logs FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

-- ─── sessions: saved conversation transcripts ─────────────────────
DEFINE TABLE IF NOT EXISTS sessions SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON sessions TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON sessions TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS ts ON sessions TYPE datetime;
DEFINE FIELD IF NOT EXISTS local_date ON sessions TYPE string;
DEFINE FIELD IF NOT EXISTS local_tz ON sessions TYPE string;
DEFINE INDEX IF NOT EXISTS sessions_ts ON sessions FIELDS ts;
DEFINE INDEX IF NOT EXISTS sessions_local_date ON sessions FIELDS local_date;

-- ─── user_entities: knowledge graph nodes ─────────────────────────
DEFINE TABLE IF NOT EXISTS user_entities SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON user_entities TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON user_entities TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS ts ON user_entities TYPE datetime;
DEFINE FIELD IF NOT EXISTS local_date ON user_entities TYPE string;
DEFINE FIELD IF NOT EXISTS local_tz ON user_entities TYPE string;
DEFINE INDEX IF NOT EXISTS user_entities_created_at ON user_entities FIELDS created_at;
DEFINE INDEX IF NOT EXISTS user_entities_ts ON user_entities FIELDS ts;
DEFINE INDEX IF NOT EXISTS user_entities_local_date ON user_entities FIELDS local_date;
DEFINE INDEX IF NOT EXISTS user_entities_embedding ON user_entities FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

-- ─── user_relations: knowledge graph edges ────────────────────────
DEFINE TABLE IF NOT EXISTS user_relations TYPE RELATION SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON user_relations TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON user_relations TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS ts ON user_relations TYPE datetime;
DEFINE FIELD IF NOT EXISTS local_date ON user_relations TYPE string;
DEFINE FIELD IF NOT EXISTS local_tz ON user_relations TYPE string;
DEFINE INDEX IF NOT EXISTS user_relations_ts ON user_relations FIELDS ts;
DEFINE INDEX IF NOT EXISTS user_relations_local_date ON user_relations FIELDS local_date;
DEFINE INDEX IF NOT EXISTS user_relations_embedding ON user_relations FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;
DEFINE INDEX IF NOT EXISTS user_relations_name ON user_relations FIELDS name;

-- ─── app_data: settings, widget layouts, session data ─────────────
DEFINE TABLE IF NOT EXISTS app_data SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON app_data TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON app_data TYPE datetime VALUE time::now();
DEFINE INDEX IF NOT EXISTS app_data_created_at ON app_data FIELDS created_at;

-- ─── user_data: todos, prepared metric defs, prepared log categories ──
-- Type-tagged via the type field; queries always filter WHERE type = '...'.
DEFINE TABLE IF NOT EXISTS user_data SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON user_data TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON user_data TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS ts ON user_data TYPE datetime;
DEFINE FIELD IF NOT EXISTS local_date ON user_data TYPE string;
DEFINE FIELD IF NOT EXISTS local_tz ON user_data TYPE string;
DEFINE FIELD IF NOT EXISTS type ON user_data TYPE option<string>;
DEFINE FIELD IF NOT EXISTS status ON user_data TYPE option<string>;
DEFINE INDEX IF NOT EXISTS user_data_type_status ON user_data FIELDS type, status;
DEFINE INDEX IF NOT EXISTS user_data_type_ts ON user_data FIELDS type, ts;
DEFINE INDEX IF NOT EXISTS user_data_type_local_date ON user_data FIELDS type, local_date;

-- ─── metrics: quantifiable activity tracking ──────────────────────
DEFINE TABLE IF NOT EXISTS metrics SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON metrics TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON metrics TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS ts ON metrics TYPE datetime;
DEFINE FIELD IF NOT EXISTS metric_name ON metrics TYPE option<string>;
DEFINE FIELD IF NOT EXISTS local_date ON metrics TYPE string;
DEFINE FIELD IF NOT EXISTS local_tz ON metrics TYPE string;
DEFINE INDEX IF NOT EXISTS metrics_created_at ON metrics FIELDS created_at;
DEFINE INDEX IF NOT EXISTS metrics_name_ts ON metrics FIELDS metric_name, ts;
DEFINE INDEX IF NOT EXISTS metrics_name_local_date ON metrics FIELDS metric_name, local_date;

-- ─── smartchats_apps: installed "mini-apps" catalog ───────────────
DEFINE TABLE IF NOT EXISTS smartchats_apps SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON smartchats_apps TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON smartchats_apps TYPE datetime VALUE time::now();
DEFINE INDEX IF NOT EXISTS smartchats_apps_app_id ON smartchats_apps FIELDS app_id UNIQUE;
DEFINE INDEX IF NOT EXISTS smartchats_apps_source ON smartchats_apps FIELDS source;

-- ─── smartchats_app_installs: install records ─────────────────────
DEFINE TABLE IF NOT EXISTS smartchats_app_installs SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON smartchats_app_installs TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON smartchats_app_installs TYPE datetime VALUE time::now();
DEFINE INDEX IF NOT EXISTS smartchats_app_installs_app_id ON smartchats_app_installs FIELDS app_id UNIQUE;

-- ─── insights_events: telemetry (OTel-shaped) ─────────────────────
DEFINE TABLE IF NOT EXISTS insights_events SCHEMALESS;
DEFINE FIELD IF NOT EXISTS event_id ON insights_events TYPE string;
DEFINE FIELD IF NOT EXISTS event_type ON insights_events TYPE string;
DEFINE FIELD IF NOT EXISTS session_id ON insights_events TYPE option<string>;
DEFINE FIELD IF NOT EXISTS trace_id ON insights_events TYPE option<string>;
DEFINE FIELD IF NOT EXISTS timestamp ON insights_events TYPE option<datetime>;
DEFINE INDEX IF NOT EXISTS insights_events_timestamp ON insights_events FIELDS timestamp;
DEFINE INDEX IF NOT EXISTS insights_events_session_id ON insights_events FIELDS session_id;
DEFINE INDEX IF NOT EXISTS insights_events_event_type ON insights_events FIELDS event_type;

-- ─── cortex: procedural instructions + init instructions ─────────
DEFINE TABLE IF NOT EXISTS cortex SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON cortex TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON cortex TYPE datetime VALUE time::now();
DEFINE INDEX IF NOT EXISTS cortex_embedding ON cortex FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

-- ─── cortex_dynamic_functions: user-defined async functions ───────
DEFINE TABLE IF NOT EXISTS cortex_dynamic_functions SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON cortex_dynamic_functions TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON cortex_dynamic_functions TYPE datetime VALUE time::now();

-- ─── byo_api_keys: plaintext fallback when env vars unset ─────────
DEFINE TABLE IF NOT EXISTS byo_api_keys SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS provider ON byo_api_keys TYPE string;
DEFINE FIELD IF NOT EXISTS api_key ON byo_api_keys TYPE string;
DEFINE FIELD IF NOT EXISTS created_at ON byo_api_keys TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON byo_api_keys TYPE datetime VALUE time::now();
DEFINE INDEX IF NOT EXISTS byo_api_keys_provider ON byo_api_keys FIELDS provider UNIQUE;

-- ─── usage_records: per-call LLM/TTS/tool tracking ────────────────
-- Server-stamped: ts = time::now() (real UTC), local_tz = 'UTC' (the
-- local server has no user-tz context — daily buckets are UTC days
-- intentionally). Client-side writes (if added later) should pass
-- user-tz.
DEFINE TABLE IF NOT EXISTS usage_records SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS ts ON usage_records TYPE datetime;
DEFINE FIELD IF NOT EXISTS local_date ON usage_records TYPE string;
DEFINE FIELD IF NOT EXISTS local_tz ON usage_records TYPE string;
DEFINE FIELD IF NOT EXISTS model ON usage_records TYPE string;
DEFINE FIELD IF NOT EXISTS provider ON usage_records TYPE string;
DEFINE FIELD IF NOT EXISTS input_tokens ON usage_records TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS output_tokens ON usage_records TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS cached_input_tokens ON usage_records TYPE int DEFAULT 0;
DEFINE FIELD IF NOT EXISTS cost_usd ON usage_records TYPE float DEFAULT 0.0;
DEFINE FIELD IF NOT EXISTS credits_charged ON usage_records TYPE float DEFAULT 0.0;
DEFINE FIELD IF NOT EXISTS charged_from ON usage_records TYPE string;
DEFINE FIELD IF NOT EXISTS session_id ON usage_records TYPE option<string>;
DEFINE FIELD IF NOT EXISTS request_type ON usage_records TYPE option<string>;
DEFINE INDEX IF NOT EXISTS usage_records_ts ON usage_records FIELDS ts;
DEFINE INDEX IF NOT EXISTS usage_records_local_date ON usage_records FIELDS local_date;
DEFINE INDEX IF NOT EXISTS usage_records_model ON usage_records FIELDS model;
DEFINE INDEX IF NOT EXISTS usage_records_provider ON usage_records FIELDS provider;
`;

/**
 * Cumulative migration blocks. EMPTY at v1.0.0 baseline.
 *
 * New entries get added here when a future schema bump needs to converge
 * data that's already in the wild (i.e. external users have data on the
 * previous version). Until then, the DDL above IS the schema — no
 * backfill logic to inherit.
 *
 * When adding a future block: it must be idempotent (`WHERE X IS NONE`
 * guards on UPDATEs, `IF EXISTS` on REMOVE FIELD / REMOVE INDEX) so
 * re-running on a converged DB no-ops cleanly.
 */
export const LOCAL_SCHEMA_MIGRATIONS: ReadonlyArray<{ version: string; statements: string }> = [];

export interface ApplyLocalSchemaOptions {
    logger?: LocalSchemaLogger;
}

export interface ApplyLocalSchemaResult {
    applied: boolean;
    previousVersion: string | null;
    currentVersion: string;
}

/**
 * Apply the schema to the DB. Idempotent — DDL uses `DEFINE … IF NOT
 * EXISTS` everywhere, and the migration array is empty at v1.0.0 so
 * there's nothing else to do. Safe to call on every boot and after every
 * bundle import — cost is a handful of "does this exist?" probes.
 *
 * The `_schema_version:current` row is maintained for diagnostics and
 * for `applied` returning TRUE iff this call changed the stamped
 * version (first boot, schema bump). Steady-state re-applies return
 * FALSE even though the DDL did run.
 */
export async function applyLocalSchema(
    db: LocalSchemaDb,
    opts: ApplyLocalSchemaOptions = {},
): Promise<ApplyLocalSchemaResult> {
    const log = opts.logger ?? {};

    let previousVersion: string | null = null;
    try {
        const result = await db.query(
            'SELECT version FROM _schema_version:current',
        );
        const rows = Array.isArray(result) ? (result as unknown[])[0] : null;
        if (Array.isArray(rows) && rows.length > 0) {
            const row = rows[0] as { version?: string };
            if (row?.version) {
                previousVersion = row.version;
            }
        }
    } catch {
        // Table doesn't exist yet — expected on first boot.
    }

    if (previousVersion === LOCAL_SCHEMA_VERSION) {
        log.info?.(`schema: converging at v${LOCAL_SCHEMA_VERSION} (idempotent re-apply)`);
    } else if (previousVersion) {
        log.info?.(`schema: upgrading from v${previousVersion} → v${LOCAL_SCHEMA_VERSION}`);
    } else {
        log.info?.(`schema: fresh install, applying v${LOCAL_SCHEMA_VERSION}`);
    }

    await db.query(LOCAL_DDL);
    for (const { statements } of LOCAL_SCHEMA_MIGRATIONS) {
        await db.query(statements);
    }
    await db.query(
        `UPSERT _schema_version:current CONTENT { version: $version, applied_at: time::now() }`,
        { version: LOCAL_SCHEMA_VERSION },
    );

    log.success?.(`schema: v${LOCAL_SCHEMA_VERSION} applied`);
    return {
        applied: previousVersion !== LOCAL_SCHEMA_VERSION,
        previousVersion,
        currentVersion: LOCAL_SCHEMA_VERSION,
    };
}
