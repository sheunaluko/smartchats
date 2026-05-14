/**
 * DataAPI factories — adapt the two SmartChats data transports to the
 * shared `DataAPI` contract from `smartchats-backend`:
 *
 *   target='cloud'  → `smartchats-cloud-client.runQueryAllStatementsRaw`
 *                     (Firebase Auth → Cloud Function `surrealQuery` →
 *                     user-scoped SurrealDB with the user's JWT).
 *   target='local'  → SDK-direct WebSocket via `createClient` to
 *                     ws://localhost:8000/rpc with root creds.
 *
 * Used by both the smartchats CLI (`smartchats data ...`) and the MCP
 * server. Once a handle is constructed, the consumer is target-agnostic
 * — call `handle.data.query(...)` and the operations layer
 * (`./operations/*`) doesn't need to branch on cloud vs local.
 *
 * The handle bundles three concerns the asymmetry would otherwise force
 * every caller to reimplement: identity (`getUid`), connection lifecycle
 * (`close`), and a label for log output (`description`).
 */

import {
    runQueryAllStatementsRaw,
    getUid as cloudGetUid,
    resolveConfig,
    type CloudClientConfig,
} from 'smartchats-cloud-client';
import { createClient, type Client } from './client.js';
import type { DataAPI, DataHealthReport } from 'smartchats-backend';

export type Target = 'cloud' | 'local';

export interface CloudOptions {
    /** Optional override config; if omitted, uses cloud-client's resolveConfig() (env-var aware). */
    config?: CloudClientConfig;
}

export interface LocalOptions {
    url?: string;        // default: ws://localhost:8000/rpc
    namespace?: string;  // default: smartchats
    database?: string;   // default: main
    username?: string;   // default: root
    password?: string;   // default: root
}

export interface DataAPIHandle {
    data: DataAPI;
    /** Identifier for the authenticated principal — Firebase UID for cloud, 'local' sentinel for local. */
    getUid: () => Promise<string>;
    /** Release any underlying connection. Idempotent. */
    close: () => Promise<void>;
    /** Human-readable description of the connection target (for logs). */
    description: string;
}

/**
 * Cloud DataAPI — every query runs as the authenticated Firebase user
 * via the Cloud Function `surrealQuery`. First call triggers
 * `getIdToken` which uses a stored refresh token or falls through to
 * an interactive browser login.
 */
export function makeCloudDataAPI(opts: CloudOptions = {}): DataAPIHandle {
    const config = opts.config ?? resolveConfig();
    const data: DataAPI = {
        async query<T = unknown>(args: { query: string; variables?: Record<string, unknown> }) {
            // cloud-client's QuerySpec requires `variables`; default to {}.
            const spec = { query: args.query, variables: args.variables ?? {} };
            const statements = await runQueryAllStatementsRaw(spec, config);
            // First-statement rows surfaced as `rows` (matches DataAPI shape).
            const firstStmt = statements[0];
            const firstRows: T[] =
                firstStmt && Array.isArray(firstStmt.result)
                    ? (firstStmt.result as T[])
                    : [];
            return { rows: firstRows, statements };
        },
        async healthCheck(): Promise<DataHealthReport> {
            // Minimal probe — any per-table check would risk creating noise
            // in user-scoped tables. Caller can do more thorough probes.
            const start = Date.now();
            try {
                await data.query({ query: 'INFO FOR DB;' });
                return { ok: true, latency_ms: Date.now() - start, tables: {} };
            } catch (err) {
                return {
                    ok: false,
                    latency_ms: Date.now() - start,
                    tables: { _: { ok: false, error: (err as Error).message } },
                };
            }
        },
    };
    return {
        data,
        getUid: () => cloudGetUid(config),
        close: async () => undefined, // cloud-client is stateless per-call
        description: `cloud (${config.cloudFunctionsBase})`,
    };
}

/**
 * Local DataAPI — SDK-direct WebSocket to the local SurrealDB. Suits CLI
 * admin against a self-hosted AIO. Bypasses any local Express server
 * (which is the user-facing browser path); we want raw access for
 * import/export-style operations.
 */
export async function makeLocalDataAPI(opts: LocalOptions = {}): Promise<DataAPIHandle> {
    const url = opts.url ?? 'ws://localhost:8000/rpc';
    const namespace = opts.namespace ?? 'smartchats';
    const database = opts.database ?? 'main';
    const username = opts.username ?? 'root';
    const password = opts.password ?? 'root';

    const client: Client = createClient({
        url,
        namespace,
        database,
        auth: { username, password },
    });
    // SurrealDB SDK's connect() can hang indefinitely against a closed port
    // (no ECONNREFUSED rejection). Race it with a 10s timeout so a stopped
    // AIO surfaces as a clear error instead of a silent hang.
    await Promise.race([
        client.connect(),
        new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`connect timeout (10s) — is SurrealDB listening on ${url}? (e.g. AIO running, port exposed?)`)), 10000),
        ),
    ]);

    const data: DataAPI = {
        async query<T = unknown>(args: { query: string; variables?: Record<string, unknown> }) {
            // runRaw returns per-statement {status, result, time}. Same shape
            // as DataStatementResult — direct passthrough.
            const statements = (await client.runRaw(args.query, args.variables)) as Array<{
                status: string;
                result: unknown;
                time?: string;
            }>;
            const firstStmt = statements[0];
            const firstRows: T[] =
                firstStmt && Array.isArray(firstStmt.result)
                    ? (firstStmt.result as T[])
                    : [];
            return { rows: firstRows, statements };
        },
        async healthCheck(): Promise<DataHealthReport> {
            const start = Date.now();
            try {
                await client.runRaw('INFO FOR DB;');
                return { ok: true, latency_ms: Date.now() - start, tables: {} };
            } catch (err) {
                return {
                    ok: false,
                    latency_ms: Date.now() - start,
                    tables: { _: { ok: false, error: (err as Error).message } },
                };
            }
        },
    };
    return {
        data,
        getUid: async () => 'local',
        close: async () => { await client.close().catch(() => undefined); },
        description: `local (${url}, ${namespace}/${database})`,
    };
}

/**
 * Construct a DataAPIHandle from a `--target` flag value.
 * Throws on unknown target.
 */
export async function makeDataAPI(target: Target, opts?: { cloud?: CloudOptions; local?: LocalOptions }): Promise<DataAPIHandle> {
    if (target === 'cloud') return makeCloudDataAPI(opts?.cloud);
    if (target === 'local') return makeLocalDataAPI(opts?.local);
    throw new Error(`Unknown target: ${target} (expected 'cloud' or 'local')`);
}
