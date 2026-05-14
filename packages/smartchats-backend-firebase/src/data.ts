import type {
    DataAPI,
    DataQueryArgs,
    DataQueryResult,
    DataHealthReport,
    DataStatementResult,
} from 'smartchats-backend';
import { BackendError, SMARTCHATS_REQUIRED_TABLES } from 'smartchats-backend';
import { httpsCallable } from 'firebase/functions';
import type { FirebaseBackendOptions } from './backend.js';

/**
 * Cloud `surrealQuery` envelope:
 *   { success: true, result: { id, result: [{status, result, time}, ...] }, metadata }
 * or on failure:
 *   { success: false, error }
 */
interface SurrealCallResponse {
    success: boolean;
    error?: string;
    result?: {
        id?: string;
        result?: Array<{ status: string; result: unknown; time?: string }>;
    };
}

function wrapCallableError(fn: string, err: unknown): never {
    const message = (err as { message?: string })?.message || 'unknown error';
    throw new BackendError('server_error', `${fn} failed: ${message}`, true, err);
}

function unwrapStatements(envelope: SurrealCallResponse): DataStatementResult[] {
    if (!envelope.success) {
        throw new BackendError('server_error', `surrealQuery failed: ${envelope.error ?? 'unknown'}`);
    }
    const stmts = envelope.result?.result;
    if (!Array.isArray(stmts)) return [];
    for (const s of stmts) {
        if (s.status === 'ERR') {
            throw new BackendError('server_error', `SurrealDB: ${String(s.result)}`);
        }
    }
    return stmts;
}

export function createDataAPI(opts: FirebaseBackendOptions): DataAPI {
    const surrealQuery_fn = httpsCallable<
        { query: string; variables?: Record<string, unknown> },
        SurrealCallResponse
    >(opts.functions, 'surrealQuery');

    async function query<T = unknown>(args: DataQueryArgs): Promise<DataQueryResult<T>> {
        try {
            const result = await surrealQuery_fn(args);
            const statements = unwrapStatements(result.data);
            const firstRows = Array.isArray(statements[0]?.result) ? statements[0].result as T[] : [];
            return { rows: firstRows, statements };
        } catch (err) {
            if (err instanceof BackendError) throw err;
            wrapCallableError('data.query', err);
        }
    }

    return {
        query,

        async healthCheck(): Promise<DataHealthReport> {
            const start = Date.now();
            const tables: DataHealthReport['tables'] = {};
            let ok = true;

            // Probe each required table with a cheap query. User-scoped permissions mean
            // we'll only see our own rows — the query succeeds iff the table exists + auth works.
            for (const name of SMARTCHATS_REQUIRED_TABLES) {
                try {
                    await query({ query: `SELECT * FROM ${name} LIMIT 1` });
                    tables[name] = { ok: true };
                } catch (err) {
                    ok = false;
                    tables[name] = { ok: false, error: (err as Error).message };
                }
            }

            return { ok, latency_ms: Date.now() - start, tables };
        },
    };
}
