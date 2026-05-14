/**
 * SmartChats cloud client — auth + dispatch.
 *
 * Used by the MCP server (and future CLI data subcommands) to run
 * `QuerySpec`s built by `smartchats-database` against the smartchats.ai
 * cloud SurrealDB. Defaults are baked-in for the SaaS; env vars allow
 * staging/dev override.
 */

export type { CloudClientConfig } from './config.js';
export { resolveConfig } from './config.js';

export type { QuerySpec } from './types.js';

export { getIdToken, getUid, reauthenticate, logout } from './auth.js';

export {
    runQuery,
    runQueryAllStatements,
    runQueryAllStatementsRaw,
    callCloudFunction,
    CloudClientStatementError,
    CloudClientHttpError,
} from './query.js';
export type { CloudStatementResult } from './query.js';
