import { BackendError } from '../types.js';
import { statusToBackendErrorCode } from './errors.js';

/**
 * Retry schedule for `retryable` BackendErrors. Two retries, exponential
 * backoff — total added latency ≤ 1 s. Tuned to recover from transient
 * upstream 5xx and brief network blips without amplifying real outages.
 */
const RETRY_BACKOFF_MS = [250, 750];

/**
 * POST a JSON body and return the streaming Response. Translates transport
 * failures into `BackendError` with the correct code, and transparently
 * retries `retryable` failures (network errors + 5xx) up to 2× with
 * exponential backoff.
 *
 * Retry policy is safe because both failure paths in `postStreamOnce`
 * (catch-block network error, non-2xx response) happen *before* any
 * stream body is consumed — no caller has started reading bytes when
 * we retry.
 *
 *   - AbortError OR signal-aborted    → BackendError('aborted', ..., retryable=false)
 *   - Network error                   → BackendError('network_error', ..., retryable=true)
 *   - Non-2xx                         → BackendError(mapped-code, server-message-if-JSON, retryable=status>=500)
 *
 * On `signal?.aborted` the retry loop short-circuits even between
 * retries, honoring caller cancellation.
 */
export async function postStream(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    signal?: AbortSignal,
): Promise<Response> {
    let lastErr: BackendError | undefined;
    for (let attempt = 0; attempt <= RETRY_BACKOFF_MS.length; attempt++) {
        try {
            return await postStreamOnce(url, body, headers, signal);
        } catch (err) {
            if (!(err instanceof BackendError) || !err.retryable) throw err;
            if (signal?.aborted) throw err;
            lastErr = err;
            const delay = RETRY_BACKOFF_MS[attempt];
            if (delay === undefined) throw err;
            await new Promise((r) => setTimeout(r, delay));
        }
    }
    // Unreachable — the loop always returns or throws — but TS doesn't
    // know that without the explicit fallthrough.
    throw lastErr!;
}

/**
 * Single fetch attempt — extracted so the retry loop in `postStream`
 * can re-invoke it without duplicating the catch-and-classify logic.
 */
async function postStreamOnce(
    url: string,
    body: unknown,
    headers: Record<string, string>,
    signal?: AbortSignal,
): Promise<Response> {
    let response: Response;
    try {
        response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify(body),
            signal,
        });
    } catch (err) {
        // Safari/WebKit emits `TypeError: Load failed` (not `AbortError`)
        // when a fetch is aborted mid-stream. Check the signal itself so
        // we don't misclassify caller-cancelled requests as infrastructure
        // failures in our insights stream.
        if (signal?.aborted || (err as { name?: string }).name === 'AbortError') {
            throw new BackendError('aborted', 'stream aborted', false, err);
        }
        throw new BackendError(
            'network_error',
            `stream network error: ${(err as Error).message}`,
            true,
            err,
        );
    }
    if (!response.ok) {
        let msg = `stream failed: ${response.status}`;
        try {
            const errBody = await response.json();
            if (errBody?.error) msg = errBody.error;
        } catch { /* ignore — server returned non-JSON */ }
        throw new BackendError(
            statusToBackendErrorCode(response.status),
            msg,
            response.status >= 500,
        );
    }
    return response;
}
