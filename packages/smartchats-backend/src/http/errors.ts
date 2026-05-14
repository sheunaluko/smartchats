import type { BackendErrorCode } from '../types.js';

/**
 * Map an HTTP status code onto the appropriate BackendErrorCode.
 * Used by every HTTP-based adapter to turn fetch responses into the shared
 * error taxonomy.
 */
export function statusToBackendErrorCode(status: number): BackendErrorCode {
    if (status === 401) return 'invalid_request';
    if (status === 402) return 'insufficient_credits';
    if (status === 429) return 'rate_limited';
    if (status >= 500) return 'server_error';
    return 'provider_error';
}
