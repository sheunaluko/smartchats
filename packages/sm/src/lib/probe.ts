/**
 * HTTP probe helper.
 *
 * Lightweight `is this URL responding healthily?` check used by ship-full's
 * post-deploy steps. No dependencies — pure node:https/http + timeout.
 *
 * Phase 4 will swap in real API clients (Vercel, Firebase) for richer
 * signals; until then, a 2xx response is the bar.
 */

import * as https from 'node:https';
import * as http from 'node:http';
import { URL } from 'node:url';

export interface ProbeResult {
    ok: boolean;
    status: number | null;
    durationMs: number;
    error?: string;
}

export function probeUrl(url: string, timeoutMs = 5000): Promise<ProbeResult> {
    return new Promise(resolve => {
        const start = Date.now();
        let parsed: URL;
        try {
            parsed = new URL(url);
        } catch (e) {
            resolve({ ok: false, status: null, durationMs: 0, error: `bad url: ${(e as Error).message}` });
            return;
        }
        const mod = parsed.protocol === 'https:' ? https : http;
        const req = mod.request(
            { method: 'GET', hostname: parsed.hostname, port: parsed.port, path: parsed.pathname + parsed.search, timeout: timeoutMs },
            res => {
                const status = res.statusCode ?? 0;
                // Drain so socket can close.
                res.resume();
                res.on('end', () => {
                    resolve({ ok: status >= 200 && status < 400, status, durationMs: Date.now() - start });
                });
            },
        );
        req.on('timeout', () => {
            req.destroy(new Error('timeout'));
        });
        req.on('error', err => {
            resolve({ ok: false, status: null, durationMs: Date.now() - start, error: err.message });
        });
        req.end();
    });
}

/**
 * Poll a URL until it responds 2xx/3xx or timeout elapses.
 * Used to wait for Vercel to finish deploying after a push.
 */
export async function pollUntilHealthy(url: string, opts: {
    /** Total time budget in ms. */
    totalTimeoutMs: number;
    /** Sleep between attempts in ms. */
    intervalMs: number;
    /** Per-request timeout in ms. */
    requestTimeoutMs?: number;
    /** Called on every attempt with the latest result. */
    onAttempt?: (attempt: number, result: ProbeResult) => void;
}): Promise<{ ok: boolean; attempts: number; lastResult: ProbeResult }> {
    const start = Date.now();
    let attempt = 0;
    let last: ProbeResult = { ok: false, status: null, durationMs: 0, error: 'no attempts yet' };
    while (Date.now() - start < opts.totalTimeoutMs) {
        attempt++;
        last = await probeUrl(url, opts.requestTimeoutMs ?? 5000);
        if (opts.onAttempt) opts.onAttempt(attempt, last);
        if (last.ok) return { ok: true, attempts: attempt, lastResult: last };
        await new Promise(r => setTimeout(r, opts.intervalMs));
    }
    return { ok: false, attempts: attempt, lastResult: last };
}
