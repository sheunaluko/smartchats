/**
 * Local schema definitions + admin operations.
 *
 *   • `local.ts` — local self-hosted DDL + version constant +
 *                  `applyLocalSchema(db)` orchestration.
 *
 * Cloud schema (per-user templates, ACCESS rules, migrations) lives in
 * the closed-source `smartchats-cloud` package — see
 * `packages/smartchats-cloud/schema/`. This split keeps cloud-permissions
 * logic out of the open-core surface.
 *
 * Consumers:
 *   import { schema } from 'smartchats-database';
 *   await schema.applyLocalSchema(db);
 *
 * Per-table fragment exports + the dual-field timestamp invariant
 * (`created_at`/`updated_at` physical, `lts` logical) live alongside the
 * DDL strings.
 */

export {
    LOCAL_SCHEMA_VERSION,
    LOCAL_DDL,
    LOCAL_SCHEMA_MIGRATIONS,
    applyLocalSchema,
} from './local.js';
export type {
    LocalSchemaDb,
    LocalSchemaLogger,
    ApplyLocalSchemaOptions,
    ApplyLocalSchemaResult,
} from './local.js';
