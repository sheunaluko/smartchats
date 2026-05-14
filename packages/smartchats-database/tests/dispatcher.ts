/**
 * Test dispatcher abstraction — picks cloud or local based on env var.
 *
 *   SMARTCHATS_TEST_TARGET=cloud   (default) → smartchats-cloud-client
 *   SMARTCHATS_TEST_TARGET=local            → SDK direct via createClient
 *
 * Both implementations share semantics:
 *   - `run(spec)` returns rows from the first statement.
 *   - `runAll(spec)` returns rows from every statement in order.
 *   - Both throw `StatementError` on the first `status: 'ERR'`.
 *
 * The local target connects directly to the AIO container's exposed
 * SurrealDB on `ws://localhost:8000/rpc` (root creds). Override via
 * `SMARTCHATS_LOCAL_URL=...`. AIO must be running with the SurrealDB
 * port exposed (see `bin/aio --surreal-port`, default 8000) — Phase 9.1
 * symmetry decision: admin/operator tools talk to SurrealDB the same way
 * across local and cloud (SDK direct with root creds), so dispatchers,
 * exporters, importers, and ad-hoc CLIs follow one pattern.
 */

import { createClient, type Client } from '../src/index.js';
import type { QuerySpec } from '../src/index.js';

export type Target = 'cloud' | 'local';

export interface Dispatcher {
    target: Target;
    /** Run a spec, return rows from the first statement. */
    run(spec: QuerySpec): Promise<unknown[]>;
    /** Run a spec, return rows from every statement in order. */
    runAll(spec: QuerySpec): Promise<unknown[][]>;
}

export class StatementError extends Error {
    constructor(
        message: string,
        public readonly query: string,
        public readonly statementIndex: number,
    ) {
        super(message);
        this.name = 'StatementError';
    }
}

/** Shape both targets normalize to before single-statement extraction. */
interface StatementResult {
    status: string;
    result: unknown;
    time?: string;
}

function extractRows(
    statements: StatementResult[],
    spec: QuerySpec,
): unknown[][] {
    const allRows: unknown[][] = [];
    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        if (stmt.status !== 'OK') {
            const msg = String(stmt.result).slice(0, 500);
            throw new StatementError(
                `SurrealDB statement #${i} returned ERR: ${msg}`,
                spec.query,
                i,
            );
        }
        allRows.push(Array.isArray(stmt.result) ? stmt.result : []);
    }
    return allRows;
}

// ── Local dispatcher ──────────────────────────────────────────────────────

async function makeLocalDispatcher(): Promise<Dispatcher> {
    // SDK direct via WebSocket against AIO's exposed SurrealDB. Defaults
    // assume `bin/aio` was started with --surreal-port 8000 (the default).
    const url = process.env.SMARTCHATS_LOCAL_URL ?? 'ws://localhost:8000/rpc';
    // Local server's default ns/db is `smartchats/main` (see
    // smartchats-local-server/src/config.ts) — DIFFERENT from cloud's
    // `production/main`. Symmetric admin tooling has to take this into
    // account; the dispatcher matches the local-server default here.
    const namespace = process.env.SMARTCHATS_LOCAL_NS ?? 'smartchats';
    const database = process.env.SMARTCHATS_LOCAL_DB ?? 'main';
    const username = process.env.SMARTCHATS_LOCAL_USER ?? 'root';
    const password = process.env.SMARTCHATS_LOCAL_PASSWORD ?? 'root';

    const client: Client = createClient({
        url,
        namespace,
        database,
        auth: { username, password },
    });
    try {
        await client.connect();
    } catch (err) {
        throw new Error(
            `Local SurrealDB unreachable at ${url} — is AIO running with --surreal-port exposed? (${(err as Error).message})`,
        );
    }

    return {
        target: 'local',
        async run(spec) {
            const stmts = (await client.runRaw(spec.query, spec.variables)) as StatementResult[];
            const rows = extractRows(stmts, spec);
            return rows[0] ?? [];
        },
        async runAll(spec) {
            const stmts = (await client.runRaw(spec.query, spec.variables)) as StatementResult[];
            return extractRows(stmts, spec);
        },
    };
}

// ── Cloud dispatcher ──────────────────────────────────────────────────────

async function makeCloudDispatcher(): Promise<Dispatcher> {
    // Lazy-imported so local-only runs don't need cloud-client built/configured.
    const cloudClient = await import('smartchats-cloud-client');
    const config = cloudClient.resolveConfig();
    // Pre-warm auth so the first per-test call doesn't pay the auth cost.
    await cloudClient.getIdToken(config);

    return {
        target: 'cloud',
        async run(spec) {
            try {
                return await cloudClient.runQuery(spec, config);
            } catch (err) {
                if (err instanceof cloudClient.CloudClientStatementError) {
                    throw new StatementError(err.message, err.query, err.statementIndex);
                }
                throw err;
            }
        },
        async runAll(spec) {
            try {
                return await cloudClient.runQueryAllStatements(spec, config);
            } catch (err) {
                if (err instanceof cloudClient.CloudClientStatementError) {
                    throw new StatementError(err.message, err.query, err.statementIndex);
                }
                throw err;
            }
        },
    };
}

// ── Factory ───────────────────────────────────────────────────────────────

export async function getDispatcher(): Promise<Dispatcher> {
    const target = (process.env.SMARTCHATS_TEST_TARGET ?? 'cloud') as Target;
    if (target === 'local') return await makeLocalDispatcher();
    if (target === 'cloud') return await makeCloudDispatcher();
    throw new Error(
        `Unknown SMARTCHATS_TEST_TARGET: ${target} (expected 'cloud' or 'local')`,
    );
}
