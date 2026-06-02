/**
 * smartchats-database — single home for everything SurrealDB-related in
 * the SmartChats stack:
 *
 *   • Query builders (DML)            → `./queries/*`
 *   • Schema definitions (DDL)        → `./schema/*` — local DDL,
 *                                       per-user cloud template, migrations.
 *   • SDK client + lifecycle          → `./client.ts` — createClient(),
 *                                       runQuery(spec), runRaw(query, vars).
 *   • Vendor-neutral wire types       → `./types.ts` — QuerySpec,
 *                                       QueryResult, ClientConfig.
 *
 * Consumers never `import "surrealdb"` directly. SurrealDB is an
 * implementation detail of this package — confined to `client.ts` and
 * the schema admin functions. If a future swap to a different DB ever
 * happens, the move surface is exactly this package; the rest of the
 * codebase doesn't change.
 *
 * License: MIT.
 */

// Wire types (vendor-neutral)
export type { QuerySpec, AuditFields, EventTimeFields } from './types.js';

// Query builders (re-exported from ./queries for direct top-level access)
export * from './queries/index.js';

// Convenience namespace import: `import { queries } from 'smartchats-database'`
export * as queries from './queries/index.js';

// Cross-environment user-data operations (importBundle, exportBundle).
// Backend-agnostic: take a SmartChatsBackend instance, work for both cloud + local.
export * as operations from './operations/index.js';
export type {
    Bundle,
    ImportOptions, ImportResult, ImportProgress,
    ExportOptions, ExportResult, ExportProgress,
} from './operations/index.js';
export {
    DEFAULT_EXPORT_TABLES,
    SENSITIVE_TABLES,
    NEVER_EXPORT_TABLES,
} from './operations/index.js';

// SDK client + lifecycle (Phase 9.0f, extended in Phase 9.1 with user-scoped auth)
export { createClient, createLazyClient, createUserClient } from './client.js';
export type {
    Client,
    ClientConfig,
    UserClientConfig,
    UserAuthArgs,
    QueryResult,
} from './client.js';

// Schema admin (Phase 9.0e)
export * as schema from './schema/index.js';

// NOTE on data_api.ts (the makeCloudDataAPI / makeLocalDataAPI factories):
// these live at the `smartchats-database/data-api` sub-path, NOT this barrel.
// Reason: data_api imports `smartchats-cloud-client`, which uses Node-only
// modules (`node:os`, `node:fs/promises`, `node:http`) for the browser-OAuth
// callback server + credential file I/O. Re-exporting from this main barrel
// pulled those Node imports into the browser bundle of any consumer that
// only wanted `queries` (e.g., the smartchats Next.js app), causing webpack
// to fail with `UnhandledSchemeError: node:buffer` etc.
//
// Node-side consumers (CLI, MCP server, admin scripts):
//   import { makeDataAPI } from 'smartchats-database/data-api'
// Browser-side consumers (smartchats app):
//   import { queries } from 'smartchats-database'  // only the safe surface
