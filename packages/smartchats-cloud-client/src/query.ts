/**
 * SurrealQL query dispatch via the cloud `surrealQuery` Cloud Function.
 *
 * The cloud function authenticates via the user's Firebase ID token and
 * scopes all queries to that user's data. This dispatcher:
 *
 *   1. Acquires (or refreshes) the ID token via `auth`.
 *   2. POSTs the query to `surrealQuery` with the token.
 *   3. Unwraps the per-statement response envelope.
 *   4. Throws on per-statement `status: 'ERR'` rather than silently
 *      returning `[]` (the bug class that masked schema-level rejections
 *      and broken queries pre-rewrite).
 *   5. Auto-retries once on 401 by forcing reauthentication.
 */

import type { QuerySpec } from './types.js';
import type { CloudClientConfig } from './config.js';
import { getIdToken, reauthenticate } from './auth.js';

/** Thrown when SurrealDB returns `status: 'ERR'` on any statement. */
export class CloudClientStatementError extends Error {
    constructor(
        message: string,
        public readonly query: string,
        public readonly statementIndex: number,
    ) {
        super(message);
        this.name = 'CloudClientStatementError';
    }
}

/** Thrown when the cloud function returns a non-2xx HTTP response. */
export class CloudClientHttpError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly body: string,
    ) {
        super(message);
        this.name = 'CloudClientHttpError';
    }
}

/**
 * Response envelope shape after stripping Firebase's outer `{ result: ... }`
 * httpsCallable wrapper. The cloud function (`surrealQuery`) returns
 * `{ success, result, metadata }` where `result` is the SurrealDB
 * JSON-RPC 2.0 response. The JSON-RPC response itself contains a
 * per-statement array under its own `result` field. So the path from
 * envelope to statements is `envelope.result.result`:
 *
 *   envelope:                 { success, result: <jsonrpc>, metadata }
 *   envelope.result:          { id, result: [stmts] }                 ← JSON-RPC
 *   envelope.result.result:   [{ status, result, time }, ...]         ← statements
 */
interface CloudFunctionEnvelope {
    success?: boolean;
    result: {
        id?: string;
        result: Array<{ status: string; result: unknown; time?: string }>;
    };
    metadata?: unknown;
}

/**
 * Firebase httpsCallable's HTTP response shape. Successful invocations
 * land the function's return value under `.result`; failures land an
 * `.error` object instead.
 */
interface FirebaseCallableHttpBody {
    result?: unknown;
    error?: { message?: string; code?: string; details?: unknown };
}

/**
 * Run a `QuerySpec` against the cloud SurrealDB. Returns the rows from
 * the first statement (most queries are single-statement). For
 * multi-statement queries use `runQueryAllStatements` instead.
 *
 * Throws `CloudClientStatementError` on per-statement ERR, or
 * `CloudClientHttpError` on non-2xx HTTP.
 */
export async function runQuery(
    spec: QuerySpec,
    config: CloudClientConfig,
): Promise<unknown[]> {
    const all = await runQueryAllStatements(spec, config);
    return all[0] ?? [];
}

/**
 * Run a `QuerySpec` and return rows for every statement in order.
 * Useful when a spec contains multiple SurrealQL statements (e.g. a
 * batch summary + recent rows).
 *
 * Throws on the FIRST per-statement ERR encountered, with the offending
 * statement index.
 */
export async function runQueryAllStatements(
    spec: QuerySpec,
    config: CloudClientConfig,
): Promise<unknown[][]> {
    const envelope = await callSurrealQuery(spec, config);
    const statements = envelope.result?.result ?? [];

    const allRows: unknown[][] = [];
    for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        if (stmt.status !== 'OK') {
            const msg = String(stmt.result).slice(0, 500);
            throw new CloudClientStatementError(
                `SurrealDB statement #${i} returned ERR: ${msg}`,
                spec.query,
                i,
            );
        }
        allRows.push(Array.isArray(stmt.result) ? stmt.result : []);
    }
    return allRows;
}

/**
 * Per-statement raw envelope shape — same form as
 * `smartchats-database/Client.runRaw` returns. Keeps consumers (MCP
 * dispatcher, import flows) decoupled from where the query was actually
 * dispatched.
 */
export interface CloudStatementResult {
    status: 'OK' | 'ERR';
    /** On OK: rows from the statement. On ERR: error message string. */
    result: unknown;
    time?: string;
}

/**
 * Like `runQueryAllStatements` but **does not throw on ERR** — returns
 * the per-statement envelopes verbatim so callers can detect failures
 * per row (the import flow's `UPSERT ... ; RELATE ...` pattern needs
 * this — one ERR shouldn't abort the whole batch).
 *
 * Mirror of `Client.runRaw(query, vars)` from smartchats-database in
 * shape so the MCP `Dispatcher.runRaw` interface unifies cleanly across
 * cloud + local targets.
 */
export async function runQueryAllStatementsRaw(
    spec: QuerySpec,
    config: CloudClientConfig,
): Promise<CloudStatementResult[]> {
    const envelope = await callSurrealQuery(spec, config);
    const statements = envelope.result?.result ?? [];
    return statements.map((s) => ({
        status: s.status === 'OK' ? 'OK' as const : 'ERR' as const,
        result: s.result,
        time: s.time,
    }));
}

/**
 * Lower-level: invoke any cloud function by name, with auth + 401 retry.
 * Used by `runQuery` and by export/import flows that need direct cloud
 * function access (e.g. `getUid` after a fresh login).
 *
 * Strips Firebase httpsCallable's outer `{ result: ... }` wrapper so the
 * returned value is the function's actual return value. If the response
 * carries `{ error: ... }` instead, throws `CloudClientHttpError`.
 */
export async function callCloudFunction<T = unknown>(
    functionName: string,
    data: unknown,
    config: CloudClientConfig,
    retried = false,
): Promise<T> {
    const idToken = await getIdToken(config);
    const url = `${config.cloudFunctionsBase}/${functionName}`;
    const res = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ data }),
    });

    if (res.status === 401 && !retried) {
        await reauthenticate(config);
        return callCloudFunction<T>(functionName, data, config, true);
    }

    if (!res.ok) {
        const text = await res.text();
        throw new CloudClientHttpError(
            `Cloud Function ${functionName} failed (${res.status})`,
            res.status,
            text,
        );
    }

    const body = (await res.json()) as FirebaseCallableHttpBody;
    if (body.error) {
        const msg = body.error.message ?? 'unknown error';
        throw new CloudClientHttpError(
            `Cloud Function ${functionName} returned error: ${msg}`,
            res.status,
            JSON.stringify(body.error),
        );
    }
    return body.result as T;
}

async function callSurrealQuery(
    spec: QuerySpec,
    config: CloudClientConfig,
): Promise<CloudFunctionEnvelope> {
    return callCloudFunction<CloudFunctionEnvelope>('surrealQuery', spec, config);
}
