/**
 * Local schema definitions + admin operations.
 *
 *   • `local.ts` — local self-hosted DDL + version constant +
 *                  `applyLocalSchema(db)` orchestration.
 *
 * Consumers:
 *   import { schema } from 'smartchats-database';
 *   await schema.applyLocalSchema(db);
 *
 * Per-table fragment exports + the event-time convention
 * (`created_at`/`updated_at` physical, `ts`/`local_date`/`local_tz`
 * logical event-time triple) live alongside the DDL strings.
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
