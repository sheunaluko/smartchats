/**
 * SurrealDB connection + schema init for the self-hosted server.
 *
 * `connectSurreal` is called once at boot, establishes a long-lived connection
 * via `smartchats-database`'s `createClient` factory, and caches the typed
 * `Client`. `initSchema` runs the DDL on first launch, or on version bumps —
 * subsequent boots short-circuit in ~1 query.
 *
 * The DDL strings + version-stamping orchestration live in
 * `smartchats-database/schema` (see `packages/smartchats-database/src/schema/local.ts`).
 * The SurrealDB SDK lives behind `smartchats-database/client.ts` — this file
 * imports zero `surrealdb` symbols.
 */

import { createClient, schema, type Client } from 'smartchats-database';
import type { ServerConfig } from './config.js';
import { log } from './logger.js';

let _client: Client | null = null;

export async function connectSurreal(cfg: ServerConfig['surreal']): Promise<Client> {
    if (_client) return _client;
    const client = createClient({
        url: cfg.url,
        namespace: cfg.namespace,
        database: cfg.database,
        auth: { username: cfg.user, password: cfg.password },
    });
    await client.connect();
    _client = client;
    return client;
}

export function getDb(): Client {
    if (!_client) throw new Error('SurrealDB not connected — call connectSurreal first');
    return _client;
}

export async function disconnectSurreal(): Promise<void> {
    if (_client) {
        await _client.close();
        _client = null;
    }
}

export type InitSchemaResult = schema.ApplyLocalSchemaResult;

/**
 * Idempotent schema init. Delegates to `schema.applyLocalSchema` from
 * `smartchats-database` — see that function for orchestration details.
 */
export async function initSchema(db: Client): Promise<InitSchemaResult> {
    return schema.applyLocalSchema(db, {
        logger: {
            info: (msg) => log.info(msg),
            success: (msg) => log.success(msg),
        },
    });
}
