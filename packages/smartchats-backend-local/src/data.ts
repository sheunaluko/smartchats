import type {
    DataAPI,
    DataQueryArgs,
    DataQueryResult,
    DataHealthReport,
    DataStatementResult,
} from 'smartchats-backend';
import { BackendError } from 'smartchats-backend';
import type { LocalBackendOptions } from './backend.js';
import { jsonRequest } from './http.js';

export function createDataAPI(opts: LocalBackendOptions): DataAPI {
    async function query<T = unknown>(args: DataQueryArgs): Promise<DataQueryResult<T>> {
        const body = await jsonRequest<{ statements: DataStatementResult[] }>(opts, '/data/query', {
            method: 'POST',
            body: JSON.stringify(args),
        });
        for (const s of body.statements) {
            if (s.status === 'ERR') {
                throw new BackendError('server_error', `SurrealDB: ${String(s.result)}`);
            }
        }
        const firstRows = Array.isArray(body.statements[0]?.result)
            ? (body.statements[0].result as T[])
            : [];
        return { rows: firstRows, statements: body.statements };
    }

    async function healthCheck(): Promise<DataHealthReport> {
        return jsonRequest<DataHealthReport>(opts, '/data/health', { method: 'GET' });
    }

    return { query, healthCheck };
}
