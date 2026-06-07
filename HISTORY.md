# History

Single source of truth for schema, contract, and infrastructure changes worth remembering. Most recent first. Keep entries terse — the *what* and the *why*; the *how* belongs in the code's current state.

## 2026-06-04 — Prod incident: SurrealDB v3 HTTP-RPC datetime auto-coercion

Every `save_log` / `save_todo` / `insert_metric` against cloud failed with `Expected 'string' but found d'2026-06-04T00:00:00Z'` for `local_date`. Root cause: SurrealDB v3's HTTP-RPC JSON deserializer auto-promotes ISO-date-shaped strings (`"2026-06-04"`) into datetime values; the schema's `local_date TYPE string` rejected the coerced value. Local AIO uses WebSocket + CBOR which preserves the string type, so unit tests + e2e all passed.

Fix: explicit `<string>` cast at every `$local_date` / `$local_tz` parameter binding. Regression guarded by `packages/smartchats-database/tests/unit/event_time_binding_casts.test.ts`. Follow-up infra todo (cloud write-path CI coverage) lives at the top of the cloud repo's `STATUS.txt`.

## 2026-06-03 — Event-time convention reset; open ↔ cloud lockstep at v1.0.0

Retired the single `lts` field (fake-UTC = local wall-clock with a `Z` suffix, broke any code that treated it as a real instant) in favor of a three-field event-time triple:

- `ts: datetime` — real-UTC instant
- `local_date: string` — `YYYY-MM-DD` the user perceived in their tz (indexed bucket key for `GROUP BY local_date`)
- `local_tz: string` — IANA zone the user was in

Strict (REQUIRED) on: `logs`, `sessions`, `metrics`, `user_entities`, `user_relations`, `events`. Optional on `user_data` (mixed-shape table: config rows like `metric_definition` have no event-time concept). Added `events` table for formal life-event storage. Set via `nowEventTime()` in `apps/smartchats/app/modules/system.ts`.

Open repo got a clean v1.0.0 baseline (`LOCAL_SCHEMA_VERSION = '1.0.0'`, empty `LOCAL_SCHEMA_MIGRATIONS`). Cloud migrated in-place through 1.3.0 → 1.3.1 → re-stamped to 1.0.0 to share a versioning timeline with open. From this point forward, schema-shape bumps land in both `packages/smartchats-database/src/schema/local.ts` and the cloud `schema/version.ts` together.

Convergence proof is a string compare:

```surql
SELECT version FROM _schema_version:current  -- must equal LOCAL_SCHEMA_VERSION
```

Audited 1316 rows on cloud post-migration: every strict event-time row has `ts` + `local_date` + `local_tz` populated, zero residual `lts` / `timestamp` keys in payloads.

## Cloud-side history pre-2026-06-03 (pre-lockstep)

Independent versioning timeline before open and cloud joined at v1.0.0. Kept for one purpose: if a brand-new pre-1.3.x cloud instance ever needs to migrate, the original migration blocks can be restored from git history at the listed commits.

- **1.3.1** (commit `629f4a1` in cloud) — payload `UNSET` follow-on to 1.3.0. SCHEMALESS `REMOVE FIELD` only drops the field *definition*; row payloads retained the legacy values until explicitly unset.
- **1.3.0** (commit `244df3b` in cloud) — event-time convention migration: backfill `ts` / `local_date` / `local_tz` from `lts` (+ `metrics.timestamp`); rename `user_data.timestamp` → `due_at`; drop legacy fields + indexes; add `events` table.
- **1.2.0** — cortex / cortex_dynamic_functions: rename camelCase `createdAt` / `updatedAt` → snake_case + switch from DEFAULT to VALUE semantics so `updated_at` auto-bumps on every write.
- **1.1.0** — `insights_events` table moved from a standalone `production/insights_events` database into `production/main` (single-DB policy); SIGNUP secret gating on DEFINE ACCESS user.
- **1.0.0** (Phase 9.1) — v3 init: full canonical schema, owner-scoped tables, JWT-secured user access, COSINE HNSW indexes.
