/**
 * Shared HTTP helper for the local backend client adapter.
 * Centralizes auth header + error wrapping so every per-concern file
 * is a thin wrapper around REST calls to the self-hosted server.
 */

import { BackendError, type BackendErrorCode } from 'smartchats-backend';
import type { LocalBackendOptions } from './backend.js';

export function authHeaders(opts: LocalBackendOptions): Record<string, string> {
    return opts.apiKey ? { Authorization: `Bearer ${opts.apiKey}` } : {};
}

export async function jsonRequest<T>(
    opts: LocalBackendOptions,
    path: string,
    init: RequestInit = {},
): Promise<T> {
    const url = `${opts.baseUrl}${path}`;
    let response: Response;
    try {
        response = await fetch(url, {
            ...init,
            headers: {
                'Content-Type': 'application/json',
                ...authHeaders(opts),
                ...(init.headers ?? {}),
            },
        });
    } catch (err) {
        throw new BackendError('network_error', `${path} network error: ${(err as Error).message}`, true, err);
    }

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const code: BackendErrorCode =
            response.status === 401 ? 'invalid_request' :
            response.status === 402 ? 'insufficient_credits' :
            response.status === 429 ? 'rate_limited' :
            response.status >= 500 ? 'server_error' :
            'provider_error';
        throw new BackendError(code, `${path} failed: ${response.status} ${text}`, response.status >= 500);
    }

    return response.json() as Promise<T>;
}
