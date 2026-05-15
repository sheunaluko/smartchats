/**
 * SDK client + lifecycle. The ONLY file in the SmartChats stack that
 * `import`s the `surrealdb` SDK. Every other consumer (local-server, cloud
 * functions, admin scripts, in-app) goes through this `Client` interface.
 *
 * Two factory functions:
 *
 *   • `createClient(config)` — construct an unconnected client. Caller
 *     owns the connect step (`await client.connect()`). Use this when you
 *     want explicit control over the connection lifecycle (the
 *     local-server boot orchestrates connect → schema apply → listen).
 *
 *   • `createLazyClient(config)` — construct a client that defers connect
 *     until the first `runQuery` / `runRaw` / `insert` call. Use this in
 *     environments where the entrypoint is per-request (Firebase Cloud
 *     Functions) and there's no startup hook that owns the connection.
 *
 * Both return the same `Client` interface.
 *
 * The `Client` interface intentionally exposes multiple call surfaces
 * because consumers use the SDK in several different ways:
 *
 *   • `runQuery(spec)`  — convenience wrapper around `db.query(query, vars)`,
 *                         used by the cloud LLM proxy for usage tracking.
 *   • `runRaw(q, vars)` — wraps `db.queryRaw(query, vars)` and returns the
 *                         per-statement `{status, result, time}` array used
 *                         by the local-server `/data/query` route.
 *   • `insert(table,p)` — passthrough for `db.insert`, used by the local
 *                         insights batch route.
 *   • `query(q, vars)`  — passthrough for `db.query`. Kept on the surface so
 *                         the schema admin functions (`applyLocalSchema`) can
 *                         take a `Client` directly without a separate adapter.
 *   • `close()`         — passthrough for `db.close`.
 */

import { Surreal, Table } from 'surrealdb';
import type { QuerySpec } from './types.js';

/**
 * Connection configuration for a root-credentialed SurrealDB client.
 *
 * Use this for system-level operations (schema apply, admin scripts,
 * the local server's `/data/query` route) — never as a façade for
 * user-scoped queries; root bypasses every PERMISSIONS clause.
 */
export interface ClientConfig {
    /** WebSocket URL, e.g. `ws://127.0.0.1:8000/rpc`. */
    url: string;
    namespace: string;
    database: string;
    auth: {
        username: string;
        password: string;
    };
}

/**
 * Connection configuration for a user-scoped SurrealDB client.
 *
 * Use this for queries that should respect record-level PERMISSIONS
 * (per-user data access). The connection authenticates with a JWT
 * token previously obtained via SIGNIN against an `ACCESS RECORD`
 * definition.
 *
 * If `token` is omitted, the client connects unauthenticated; the
 * caller is then responsible for invoking `signupAsUser` /
 * `signinAsUser` (which switches the live auth context on the
 * underlying connection).
 */
export interface UserClientConfig {
    /** WebSocket URL, e.g. `wss://prod-cloud.surreal.app/rpc`. */
    url: string;
    namespace: string;
    database: string;
    /** Optional pre-obtained JWT. If absent, caller must `signinAsUser` after construction. */
    token?: string;
}

/**
 * Args for `signupAsUser` / `signinAsUser`. Maps directly to the
 * `AccessRecordAuth` shape the SDK accepts.
 */
export interface UserAuthArgs {
    /** Name of the `DEFINE ACCESS ... TYPE RECORD` block (e.g. `'user'`). */
    access: string;
    /**
     * Variables passed to the SIGNUP / SIGNIN closure (e.g.
     * `{email, user_id, secret}` for our smartchats schema). The SDK
     * disallows `ns`, `db`, `ac` keys here — those come from connect.
     */
    variables: Record<string, unknown>;
}

/**
 * Per-statement result envelope. Mirrors SurrealDB's `MapQueryResult` shape
 * (`{status, result, time}` per statement). Vendor-neutral in name so
 * consumers can stay decoupled from the SurrealDB SDK type.
 *
 * Equivalent to `DataStatementResult` in `smartchats-backend/src/types.ts`
 * (the cloud-client wire shape) — they're structurally compatible.
 */
export interface QueryResult<T = unknown> {
    status: 'OK' | 'ERR';
    /** On `OK`: the typed result rows. On `ERR`: the error message string. */
    result: T | string;
    time?: string;
}

/**
 * Runtime client interface. Implementations encapsulate connection
 * lifecycle and query dispatch; consumers never see the underlying SDK.
 *
 * The interface satisfies the `LocalSchemaDb` shape (schema/local.ts) —
 * needs `query(...)` — so a `Client` can be passed directly to
 * `applyLocalSchema` without an adapter.
 */
export interface Client {
    /**
     * Establish the connection. Idempotent — calling twice is a no-op.
     * Required before any query method on `createClient(...)`-built
     * instances. `createLazyClient(...)`-built instances connect implicitly
     * on first query, but you can still call this explicitly.
     */
    connect(): Promise<void>;

    /**
     * Convenience wrapper for `db.query(spec.query, spec.variables)`.
     * Return type stays `unknown` to dodge generic-variance pain — the
     * caller knows the shape and narrows.
     */
    runQuery(spec: QuerySpec): Promise<unknown>;

    /**
     * Wraps `db.queryRaw(query, variables)`. Returns the per-statement
     * `{status, result, time}` array. Use this when you need to inspect
     * per-statement OK/ERR status (e.g. the local-server `/data/query`
     * dispatcher route).
     */
    runRaw<T = unknown>(
        query: string,
        variables?: Record<string, unknown>,
    ): Promise<QueryResult<T>[]>;

    /**
     * Passthrough for `db.insert(table, payload)`. Used by the local
     * insights batch endpoint.
     */
    insert<T = unknown>(table: string, payload: unknown): Promise<T>;

    /**
     * Passthrough for `db.query(query, variables)`. Lets the schema admin
     * functions (which type their `db` arg as `LocalSchemaDb`/`CloudAdminDb`)
     * accept a `Client` directly.
     */
    query(query: string, variables?: Record<string, unknown>): Promise<unknown>;

    /**
     * SIGNUP against a record-access definition. Returns the access JWT;
     * the underlying connection is also re-authenticated as the new user
     * for subsequent queries.
     *
     * Typically called on a `createUserClient`-built client (no initial
     * auth). Calling on a root-credentialed client switches the connection
     * away from root — only do that intentionally.
     */
    signupAsUser(args: UserAuthArgs): Promise<string>;

    /**
     * SIGNIN against a record-access definition. Returns the access JWT;
     * the underlying connection is also re-authenticated as the user.
     */
    signinAsUser(args: UserAuthArgs): Promise<string>;

    /** Close the underlying connection. Idempotent — no-op if not connected. */
    close(): Promise<void>;
}

// ─── Internal: shared client implementation ────────────────────────

/**
 * Internal representation of a connection's auth strategy. The same
 * SurrealClient class implements both root and user clients; the
 * `mode` discriminator decides what `connect()` actually does.
 */
type ConnectMode =
    | { kind: 'root'; auth: ClientConfig['auth'] }
    | { kind: 'user'; token?: string };

/**
 * Connection params common to both root and user clients.
 */
interface InternalConfig {
    url: string;
    namespace: string;
    database: string;
    mode: ConnectMode;
}

/**
 * Both factories share this class. Differences:
 *   - root mode: passes `authentication: {username, password}` to connect
 *   - user mode: connects without authentication, optionally calls
 *     `db.authenticate(token)` afterwards if a token is provided
 *   - signupAsUser / signinAsUser switch the live auth context on either
 */
class SurrealClient implements Client {
    private db: Surreal;
    private config: InternalConfig;
    private connectPromise: Promise<void> | null = null;
    private connected = false;
    private autoConnect: boolean;

    constructor(config: InternalConfig, opts: { autoConnect: boolean }) {
        this.config = config;
        this.db = new Surreal();
        this.autoConnect = opts.autoConnect;
    }

    async connect(): Promise<void> {
        if (this.connected) return;
        if (this.connectPromise) {
            await this.connectPromise;
            return;
        }
        this.connectPromise = (async () => {
            // SDK v2 renamed `auth` → `authentication` on ConnectOptions; the
            // accepted shape is still RootAuth ({username, password}) for
            // root-credentialed connections, or omitted for user mode (auth
            // is established later via authenticate / signin / signup).
            const opts: Record<string, unknown> = {
                namespace: this.config.namespace,
                database: this.config.database,
            };
            if (this.config.mode.kind === 'root') {
                opts.authentication = {
                    username: this.config.mode.auth.username,
                    password: this.config.mode.auth.password,
                };
            }
            await this.db.connect(this.config.url, opts);
            // For user mode with a pre-supplied token, switch auth context.
            // Without this the connection is unauthenticated and queries
            // hit the table's PERMISSIONS clause as $auth.id == NONE.
            if (this.config.mode.kind === 'user' && this.config.mode.token) {
                await this.db.authenticate(this.config.mode.token);
            }
            this.connected = true;
        })();
        try {
            await this.connectPromise;
        } finally {
            // Keep `connectPromise` set so concurrent callers all await the
            // same in-flight connect. Reset only on close().
        }
    }

    private async ensureConnected(): Promise<void> {
        if (this.connected) return;
        if (this.autoConnect) {
            await this.connect();
            return;
        }
        throw new Error(
            'SurrealDB client not connected — call client.connect() first',
        );
    }

    async runQuery(spec: QuerySpec): Promise<unknown> {
        await this.ensureConnected();
        return this.db.query(spec.query, spec.variables);
    }

    async runRaw<T = unknown>(
        query: string,
        variables?: Record<string, unknown>,
    ): Promise<QueryResult<T>[]> {
        await this.ensureConnected();
        // SDK v2: `queryRaw` was removed. The replacement is
        // `db.query(...).responses()` which returns the per-statement
        // {success, result, error} envelopes (v2's wire shape). We
        // translate to our vendor-neutral {status, result, time} shape so
        // every consumer of `runRaw` (the local server's /data/query route,
        // the dispatcher, etc.) can stay decoupled from the SDK version.
        const responses = await this.db.query(query, variables).responses();
        return responses.map((r) =>
            r.success
                ? {
                      status: 'OK' as const,
                      result: r.result as T,
                      time: r.stats?.duration?.toString(),
                  }
                : {
                      status: 'ERR' as const,
                      result: (r.error?.message ?? String(r.error)) as unknown as string,
                      time: r.stats?.duration?.toString(),
                  },
        );
    }

    async insert<T = unknown>(table: string, payload: unknown): Promise<T> {
        await this.ensureConnected();
        // SDK v2: `insert(table, data)` requires `table` to be a `Table`
        // instance, not a raw string. We wrap here so consumers can keep
        // calling with string table names (the v1-compatible shape).
        // SDK signature constrains payload generics; passthrough to
        // unknown-typed cast preserves runtime behavior without forcing
        // every caller to thread payload generics.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (await (this.db as any).insert(new Table(table), payload)) as T;
    }

    async query(
        query: string,
        variables?: Record<string, unknown>,
    ): Promise<unknown> {
        await this.ensureConnected();
        return this.db.query(query, variables);
    }

    async signupAsUser(args: UserAuthArgs): Promise<string> {
        await this.ensureConnected();
        // SDK v2: signup returns Tokens ({access, refresh?}). We expose
        // the access string only — refresh handling is out of scope for
        // the current consumers (cloud function caches the access JWT
        // and re-SIGNs IN on expiry rather than refreshing).
        const tokens = await this.db.signup({
            namespace: this.config.namespace,
            database: this.config.database,
            access: args.access,
            variables: args.variables,
        });
        return tokens.access;
    }

    async signinAsUser(args: UserAuthArgs): Promise<string> {
        await this.ensureConnected();
        const tokens = await this.db.signin({
            namespace: this.config.namespace,
            database: this.config.database,
            access: args.access,
            variables: args.variables,
        });
        return tokens.access;
    }

    async close(): Promise<void> {
        if (!this.connected) {
            this.connectPromise = null;
            return;
        }
        await this.db.close();
        this.connected = false;
        this.connectPromise = null;
    }
}

function rootInternal(config: ClientConfig): InternalConfig {
    return {
        url: config.url,
        namespace: config.namespace,
        database: config.database,
        mode: { kind: 'root', auth: config.auth },
    };
}

function userInternal(config: UserClientConfig): InternalConfig {
    return {
        url: config.url,
        namespace: config.namespace,
        database: config.database,
        mode: { kind: 'user', token: config.token },
    };
}

/**
 * Construct an unconnected root-credentialed client. Caller invokes
 * `await client.connect()` before issuing queries.
 *
 * Use this when the boot path owns the lifecycle and wants connect
 * failures surfaced eagerly (the local-server boot uses this pattern).
 */
export function createClient(config: ClientConfig): Client {
    return new SurrealClient(rootInternal(config), { autoConnect: false });
}

/**
 * Construct a root-credentialed client that defers connect until the
 * first query method is called. Concurrent first calls share a single
 * connect promise so the connection only happens once.
 *
 * Use this in environments without a clear startup hook (Firebase Cloud
 * Functions: each cold start runs from `module-load → first request`,
 * with no opportunity to await an explicit connect step in between).
 */
export function createLazyClient(config: ClientConfig): Client {
    return new SurrealClient(rootInternal(config), { autoConnect: true });
}

/**
 * Construct an unconnected user-scoped client. Caller invokes
 * `await client.connect()`; if a `token` is present in the config it's
 * automatically used to authenticate the connection. Otherwise the
 * caller must invoke `signupAsUser` or `signinAsUser` after connect to
 * establish the auth context.
 *
 * Use this for any code path that should respect record-level
 * PERMISSIONS — per-user data access from a server that has obtained
 * the user's JWT (Firebase Cloud Functions caching pattern), or a CLI /
 * admin tool that authenticates as a specific user, or tests that
 * verify owner-scoping by signing in as multiple synthesized users.
 *
 * NEVER use this for system-level operations (schema apply, admin
 * scripts) — use `createClient(rootCreds)` for those.
 */
export function createUserClient(config: UserClientConfig): Client {
    return new SurrealClient(userInternal(config), { autoConnect: false });
}
