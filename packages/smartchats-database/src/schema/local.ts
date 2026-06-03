/**
 * SurrealDB schema for self-hosted SmartChats (local single-user mode).
 *
 * Single-user trusted mode — all rows are owned by the running user.
 *
 * ─── Three-field event-time convention ────────────────────────────
 *
 *   created_at / updated_at   — physical row lifecycle in *this* database.
 *                               DB-stamped via `VALUE time::now() READONLY`.
 *                               Authoritative for audit, GC, debugging.
 *                               Never user-supplied. Never migrated across DBs.
 *
 *   ts (event timestamp)      — real UTC instant when the thing happened.
 *                               App-stamped at write time. Used for ordering
 *                               (`ORDER BY ts DESC`) and cross-system comparison.
 *                               Preserved across export/import/migration.
 *
 *   local_date (bucket key)   — YYYY-MM-DD string in the user's tz at the
 *                               moment of the event. App-computed at write time
 *                               from `(ts, local_tz)`. Used for indexed daily
 *                               aggregation (`GROUP BY local_date`). Survives
 *                               migration unchanged.
 *
 *   local_tz                  — IANA tz the user was in when the row was
 *                               written (e.g. "America/Chicago"). Lets us
 *                               re-derive `local_date` if the bucket needs
 *                               to change.
 *
 * Tables that carry the event-time triple: logs, sessions, user_entities,
 * user_relations, user_data, metrics, usage_records. All tables use the
 * same field names (`ts`, `local_date`, `local_tz`) — there is no
 * per-table column-name divergence. Pre-1.5.1 `metrics` had a legacy
 * `timestamp` column instead of `ts`; the 1.5.1 migration renames it.
 *
 * Legacy: `lts` (fake-UTC local wall-clock with a `Z` suffix) is still in
 * the schema during the 1.5.0 → 1.6.0 migration window. Dual-written by
 * the app. Dropped in 1.6.0 after readers have switched to `ts`/`local_date`.
 *
 * The MCP import tool strips created_at and updated_at unconditionally on
 * every payload; event-time fields ride through unchanged.
 *
 * Versioned: bump `LOCAL_SCHEMA_VERSION` when you change the DDL.
 * `applyLocalSchema` runs the DDL plus any cumulative `LOCAL_SCHEMA_MIGRATIONS`
 * entries on every version bump.
 */

/**
 * Minimal SurrealDB-shaped DB interface used by `applyLocalSchema`. Accepts
 * the local-server's `Surreal` instance directly (dependency injection) so
 * Phase 9.0e can land without depending on the not-yet-implemented `Client`
 * stub. When 9.0f lands, this can be retyped against the typed `Client`.
 *
 * Returns `Promise<unknown>` rather than a typed result-tuple to dodge
 * generic-variance pain when the caller passes a stricter implementation
 * (the Surreal SDK's `query<T extends unknown[]>(...)` is structurally
 * narrower than what we'd write here). Internally we narrow with
 * `Array.isArray` checks before reading elements.
 */
export interface LocalSchemaDb {
    query(query: string, variables?: Record<string, unknown>): Promise<unknown>;
}

/** Optional logger surface — defaults to no-op. */
export interface LocalSchemaLogger {
    info?: (msg: string) => void;
    success?: (msg: string) => void;
}

export const LOCAL_SCHEMA_VERSION = '1.5.1';

export const LOCAL_DDL = `
-- ─── schema version marker ────────────────────────────────────────
DEFINE TABLE IF NOT EXISTS _schema_version SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS version ON _schema_version TYPE string;
DEFINE FIELD IF NOT EXISTS applied_at ON _schema_version TYPE datetime VALUE time::now();

-- ─── logs: user journal / event stream ────────────────────────────
DEFINE TABLE IF NOT EXISTS logs SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON logs TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON logs TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS lts ON logs TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS ts ON logs TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS local_date ON logs TYPE option<string>;
DEFINE FIELD IF NOT EXISTS local_tz ON logs TYPE option<string>;
DEFINE INDEX IF NOT EXISTS logs_created_at ON logs FIELDS created_at;
DEFINE INDEX IF NOT EXISTS logs_lts ON logs FIELDS lts;
DEFINE INDEX IF NOT EXISTS logs_ts ON logs FIELDS ts;
DEFINE INDEX IF NOT EXISTS logs_local_date ON logs FIELDS local_date;
DEFINE INDEX IF NOT EXISTS logs_embedding ON logs FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

-- ─── sessions: saved conversation transcripts ─────────────────────
-- Sorted by ts (real UTC) in list/search UIs; bucketed by local_date.
-- lts kept during 1.5.0 → 1.6.0 dual-write window.
DEFINE TABLE IF NOT EXISTS sessions SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON sessions TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON sessions TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS lts ON sessions TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS ts ON sessions TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS local_date ON sessions TYPE option<string>;
DEFINE FIELD IF NOT EXISTS local_tz ON sessions TYPE option<string>;
DEFINE INDEX IF NOT EXISTS sessions_lts ON sessions FIELDS lts;
DEFINE INDEX IF NOT EXISTS sessions_ts ON sessions FIELDS ts;
DEFINE INDEX IF NOT EXISTS sessions_local_date ON sessions FIELDS local_date;

-- ─── user_entities: knowledge graph nodes ─────────────────────────
DEFINE TABLE IF NOT EXISTS user_entities SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON user_entities TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON user_entities TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS lts ON user_entities TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS ts ON user_entities TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS local_date ON user_entities TYPE option<string>;
DEFINE FIELD IF NOT EXISTS local_tz ON user_entities TYPE option<string>;
DEFINE INDEX IF NOT EXISTS user_entities_created_at ON user_entities FIELDS created_at;
DEFINE INDEX IF NOT EXISTS user_entities_lts ON user_entities FIELDS lts;
DEFINE INDEX IF NOT EXISTS user_entities_ts ON user_entities FIELDS ts;
DEFINE INDEX IF NOT EXISTS user_entities_local_date ON user_entities FIELDS local_date;
DEFINE INDEX IF NOT EXISTS user_entities_embedding ON user_entities FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

-- ─── user_relations: knowledge graph edges ────────────────────────
DEFINE TABLE IF NOT EXISTS user_relations TYPE RELATION SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON user_relations TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON user_relations TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS lts ON user_relations TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS ts ON user_relations TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS local_date ON user_relations TYPE option<string>;
DEFINE FIELD IF NOT EXISTS local_tz ON user_relations TYPE option<string>;
DEFINE INDEX IF NOT EXISTS user_relations_lts ON user_relations FIELDS lts;
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
-- Auto-created previously on v2 server, but v3 is stricter — SELECT against
-- an undefined table errors instead of returning empty. Explicit DEFINE keeps
-- behavior aligned across versions.
DEFINE TABLE IF NOT EXISTS user_data SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON user_data TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON user_data TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS lts ON user_data TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS ts ON user_data TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS local_date ON user_data TYPE option<string>;
DEFINE FIELD IF NOT EXISTS local_tz ON user_data TYPE option<string>;
DEFINE FIELD IF NOT EXISTS type ON user_data TYPE option<string>;
DEFINE FIELD IF NOT EXISTS status ON user_data TYPE option<string>;
DEFINE INDEX IF NOT EXISTS user_data_type_status ON user_data FIELDS type, status;
DEFINE INDEX IF NOT EXISTS user_data_type_lts ON user_data FIELDS type, lts;
DEFINE INDEX IF NOT EXISTS user_data_type_ts ON user_data FIELDS type, ts;
DEFINE INDEX IF NOT EXISTS user_data_type_local_date ON user_data FIELDS type, local_date;

-- ─── metrics: quantifiable activity tracking ──────────────────────
-- Uses the same event-time triple as every other user-data table.
-- Pre-1.5.1, this table had a legacy 'timestamp' column instead of 'ts';
-- the 1.5.1 migration renames it (UPDATE … SET ts = timestamp; REMOVE
-- FIELD timestamp). 'lts' kept during 1.5.0 to 1.6.0 dual-write window.
DEFINE TABLE IF NOT EXISTS metrics SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON metrics TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON metrics TYPE datetime VALUE time::now();
DEFINE FIELD IF NOT EXISTS ts ON metrics TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS metric_name ON metrics TYPE option<string>;
DEFINE FIELD IF NOT EXISTS lts ON metrics TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS local_date ON metrics TYPE option<string>;
DEFINE FIELD IF NOT EXISTS local_tz ON metrics TYPE option<string>;
DEFINE INDEX IF NOT EXISTS metrics_created_at ON metrics FIELDS created_at;
DEFINE INDEX IF NOT EXISTS metrics_name_ts ON metrics FIELDS metric_name, ts;
DEFINE INDEX IF NOT EXISTS metrics_name_lts ON metrics FIELDS metric_name, lts;
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
-- Backing table for both the 'procedural_instruction' and 'init' types
-- (queries.procedural_instructions + queries.initialization). The HNSW
-- index supports searchProceduralInstructions's KNN over the embedding field.
-- Audit fields use the standard snake_case + auto-bump convention; v1.4.0
-- migration backfills + drops the legacy camelCase createdAt/updatedAt.
DEFINE TABLE IF NOT EXISTS cortex SCHEMALESS;
DEFINE FIELD IF NOT EXISTS created_at ON cortex TYPE datetime VALUE time::now() READONLY;
DEFINE FIELD IF NOT EXISTS updated_at ON cortex TYPE datetime VALUE time::now();
DEFINE INDEX IF NOT EXISTS cortex_embedding ON cortex FIELDS embedding HNSW DIMENSION 1536 DIST COSINE;

-- ─── cortex_dynamic_functions: user-defined async functions ───────
-- Stored separately from cortex so the type=... predicate isn't needed
-- on every lookup. No HNSW yet — semantic discovery added when callers need it.
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
-- Records real tokens + USD cost; credits_charged is always 0 in this mode.
-- Server-side writes stamp 'ts = time::now()' (real UTC). 'local_tz' is
-- 'UTC' for server-stamped rows since the local server has no user-tz
-- context — daily buckets for usage_records are UTC days, documented
-- intentional. Client-side writes (if added) should pass user-tz.
-- Legacy 'lts' was server-stamped real UTC (not fake-UTC like other tables)
-- and is kept during the 1.5.0 to 1.6.0 dual-write window.
DEFINE TABLE IF NOT EXISTS usage_records SCHEMAFULL;
DEFINE FIELD IF NOT EXISTS lts ON usage_records TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS ts ON usage_records TYPE option<datetime>;
DEFINE FIELD IF NOT EXISTS local_date ON usage_records TYPE option<string>;
DEFINE FIELD IF NOT EXISTS local_tz ON usage_records TYPE option<string>;
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
DEFINE INDEX IF NOT EXISTS usage_records_lts ON usage_records FIELDS lts;
DEFINE INDEX IF NOT EXISTS usage_records_ts ON usage_records FIELDS ts;
DEFINE INDEX IF NOT EXISTS usage_records_local_date ON usage_records FIELDS local_date;
DEFINE INDEX IF NOT EXISTS usage_records_model ON usage_records FIELDS model;
DEFINE INDEX IF NOT EXISTS usage_records_provider ON usage_records FIELDS provider;
`;

/**
 * Idempotent post-DDL migration block. Backfills `lts` from legacy fields and
 * cleans up the `usage_records.timestamp` field after its data has been moved
 * to `lts`. Safe to run on fresh installs (all UPDATEs no-op when there are no
 * rows; REMOVE FIELD/INDEX no-ops when the field/index isn't defined).
 *
 * Run this AFTER LOCAL_DDL so the new `lts` field exists everywhere before
 * we attempt to populate it.
 *
 * Stored as a version-keyed list so future schema bumps can append further
 * cumulative migration blocks. `applyLocalSchema` runs every entry in order
 * on every version-bump pass.
 */
export const LOCAL_SCHEMA_MIGRATIONS: ReadonlyArray<{ version: string; statements: string }> = [
    {
        version: '1.1.0',
        statements: `
-- Backfill lts from the closest legacy timestamp on each table.
-- Idempotent via WHERE lts IS NONE — only touches rows that haven't been
-- backfilled yet.
UPDATE sessions       SET lts = updated_at WHERE lts IS NONE;
UPDATE user_entities  SET lts = created_at WHERE lts IS NONE;
UPDATE user_relations SET lts = created_at WHERE lts IS NONE;
UPDATE usage_records  SET lts = timestamp  WHERE lts IS NONE AND timestamp IS NOT NONE;

-- Drop the legacy usage_records.timestamp field/index after backfill.
-- IF EXISTS makes this a no-op on fresh installs.
REMOVE INDEX IF EXISTS usage_records_timestamp ON TABLE usage_records;
REMOVE FIELD IF EXISTS timestamp ON TABLE usage_records;
`,
    },
    {
        version: '1.4.0',
        statements: `
-- cortex / cortex_dynamic_functions: normalize legacy camelCase audit
-- fields to snake_case + auto-bump on update. Backfills any pre-existing
-- camelCase values into the new fields, then drops the camelCase columns.
-- Idempotent: WHERE created_at IS NONE only touches rows missing the new
-- field; REMOVE FIELD IF EXISTS no-ops on fresh installs.
UPDATE cortex SET created_at = createdAt WHERE created_at IS NONE AND createdAt IS NOT NONE;
UPDATE cortex SET updated_at = updatedAt WHERE updated_at IS NONE AND updatedAt IS NOT NONE;
REMOVE FIELD IF EXISTS createdAt ON TABLE cortex;
REMOVE FIELD IF EXISTS updatedAt ON TABLE cortex;

UPDATE cortex_dynamic_functions SET created_at = createdAt WHERE created_at IS NONE AND createdAt IS NOT NONE;
UPDATE cortex_dynamic_functions SET updated_at = updatedAt WHERE updated_at IS NONE AND updatedAt IS NOT NONE;
REMOVE FIELD IF EXISTS createdAt ON TABLE cortex_dynamic_functions;
REMOVE FIELD IF EXISTS updatedAt ON TABLE cortex_dynamic_functions;
`,
    },
    {
        version: '1.5.0',
        statements: `
-- Introduce the three-field event-time convention (ts, local_date, local_tz)
-- on every table that previously carried 'lts'. Additive — lts stays in the
-- schema during the 1.5.0 → 1.6.0 dual-write window. App writes all four
-- fields. PR 4 of the refactor drops lts.
--
-- Backfill derivation:
--   ts         := lts   (preserves chronological order. For tables where lts
--                        was fake-UTC local, this value is off by the user's
--                        tz offset — accepted as honest-best-effort since the
--                        original tz wasn't recorded. For usage_records, lts
--                        was server-stamped real UTC so the copy is exact.)
--
--   local_date := time::format(lts, '%Y-%m-%d')
--                       (extracts the YYYY-MM-DD prefix. For fake-UTC lts
--                        this is exactly the user-local date. For real-UTC
--                        lts on usage_records this is the UTC date, matching
--                        the documented usage_records convention.)
--
--   local_tz   := 'America/Chicago' on user-data tables (developer's tz —
--                        this is a single-user self-hosted deploy; if you
--                        fork into a multi-user product, replace with the
--                        tz captured at write time).
--                'UTC' on usage_records (server-stamped, no user-tz context).
--
-- Idempotent via WHERE local_date IS NONE — only touches unbackfilled rows.
UPDATE logs           SET ts = lts, local_date = time::format(lts, '%Y-%m-%d'), local_tz = 'America/Chicago' WHERE local_date IS NONE AND lts IS NOT NONE;
UPDATE sessions       SET ts = lts, local_date = time::format(lts, '%Y-%m-%d'), local_tz = 'America/Chicago' WHERE local_date IS NONE AND lts IS NOT NONE;
UPDATE user_entities  SET ts = lts, local_date = time::format(lts, '%Y-%m-%d'), local_tz = 'America/Chicago' WHERE local_date IS NONE AND lts IS NOT NONE;
UPDATE user_relations SET ts = lts, local_date = time::format(lts, '%Y-%m-%d'), local_tz = 'America/Chicago' WHERE local_date IS NONE AND lts IS NOT NONE;
UPDATE user_data      SET ts = lts, local_date = time::format(lts, '%Y-%m-%d'), local_tz = 'America/Chicago' WHERE local_date IS NONE AND lts IS NOT NONE;
UPDATE metrics        SET local_date = time::format(lts, '%Y-%m-%d'), local_tz = 'America/Chicago' WHERE local_date IS NONE AND lts IS NOT NONE;
UPDATE usage_records  SET ts = lts, local_date = time::format(lts, '%Y-%m-%d'), local_tz = 'UTC' WHERE local_date IS NONE AND lts IS NOT NONE;
`,
    },
    {
        version: '1.5.1',
        statements: `
-- Rename metrics.timestamp → metrics.ts so the event-time convention is
-- uniform across all tables. Backfills first (idempotent via ts IS NONE
-- guard) so no row loses its real-UTC instant; then drops the legacy
-- field and its composite index. The new metrics_name_ts index is
-- declared in LOCAL_DDL above and gets defined when the DDL re-runs.
UPDATE metrics SET ts = timestamp WHERE ts IS NONE AND timestamp IS NOT NONE;
REMOVE INDEX IF EXISTS metrics_name_timestamp ON TABLE metrics;
REMOVE FIELD IF EXISTS timestamp ON TABLE metrics;
`,
    },
];

export interface ApplyLocalSchemaOptions {
    logger?: LocalSchemaLogger;
}

export interface ApplyLocalSchemaResult {
    applied: boolean;
    previousVersion: string | null;
    currentVersion: string;
}

/**
 * Idempotent schema convergence. Always runs the full DDL and every
 * cumulative migration block on every call — they are individually
 * idempotent (DDL: `DEFINE … IF NOT EXISTS`; migrations: `WHERE X IS
 * NONE` guards), so re-runs touch only rows that need converging.
 *
 * Why no version-gate (changed 2026-06-03): previously this function
 * early-returned when the stored `_schema_version` matched the code
 * constant. That ASSUMED all writes go through builders that already
 * populate the current-shape fields. The bundle importer breaks that
 * assumption — it writes raw row payloads via UPSERT, so pre-1.5.0
 * bundles imported into a 1.5.1-stamped DB landed with empty
 * `ts`/`local_date` fields and the next applyLocalSchema call
 * skipped them. Dropping the gate makes the schema layer enforce
 * "every event-time row has the post-migration fields populated"
 * as a true invariant regardless of how data arrived.
 *
 * Cost: a few index probes per call (each migration's `WHERE X IS
 * NONE` guard hits the indexed field). On a converged DB every probe
 * returns zero matches; the UPDATE statements are essentially free.
 *
 * The `_schema_version:current` row is still maintained for
 * diagnostics ("what schema did this DB last see?") and the result's
 * `applied: true` flag still indicates "the version actually changed
 * this call" so callers can tell first-boot from steady-state.
 *
 * Accepts the runtime DB instance directly (dependency injection) — see
 * the `LocalSchemaDb` interface comment.
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
        // Table doesn't exist yet — expected on first boot. Proceed to apply DDL.
    }

    if (previousVersion === LOCAL_SCHEMA_VERSION) {
        log.info?.(`schema: converging at v${LOCAL_SCHEMA_VERSION} (idempotent re-apply)`);
    } else if (previousVersion) {
        log.info?.(`schema: upgrading from v${previousVersion} → v${LOCAL_SCHEMA_VERSION}`);
    } else {
        log.info?.(`schema: fresh install, applying v${LOCAL_SCHEMA_VERSION}`);
    }

    await db.query(LOCAL_DDL);
    // Migrations run AFTER DDL so the new fields exist before the backfill
    // writes to them. Each block is idempotent — safe on fresh installs and
    // safe on every subsequent call (the `WHERE X IS NONE` guards return
    // zero rows once the data is converged).
    for (const { statements } of LOCAL_SCHEMA_MIGRATIONS) {
        await db.query(statements);
    }
    await db.query(
        `UPSERT _schema_version:current CONTENT { version: $version, applied_at: time::now() }`,
        { version: LOCAL_SCHEMA_VERSION },
    );

    if (previousVersion === LOCAL_SCHEMA_VERSION) {
        log.success?.(`schema: v${LOCAL_SCHEMA_VERSION} converged (no version change)`);
    } else {
        log.success?.(`schema: v${LOCAL_SCHEMA_VERSION} applied`);
    }
    // `applied` retains its original meaning: TRUE iff this call actually
    // changed the stamped version. Steady-state re-applies return FALSE
    // even though the DDL + migrations DID run.
    return {
        applied: previousVersion !== LOCAL_SCHEMA_VERSION,
        previousVersion,
        currentVersion: LOCAL_SCHEMA_VERSION,
    };
}
