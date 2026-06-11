/**
 * createBackgroundLoader — fetch-once promise memoizer with auto-inject hook.
 *
 * Pattern: fire-and-forget background prefetch at page mount. The fetched
 * value optionally auto-injects somewhere on resolve (e.g. into the agent's
 * user_data_input context). If the same value is later requested by an
 * agent function while the fetch is still in flight, the function awaits
 * the SAME promise — no duplicate roundtrip.
 *
 * Three access shapes:
 *   prefetch() — fire-and-forget, idempotent
 *   get()      — returns the in-flight promise (or starts a new fetch)
 *   peek()     — synchronous read; returns undefined if not yet resolved
 *
 * Failure policy: a rejected fetch clears the cached promise so the next
 * get() retries. onResolve does NOT fire on rejection.
 */

/** Structural type — accepts the real InsightsClient or any
 *  duck-typed equivalent. Avoids importing the strict class type so
 *  the optional-chain `insights?.addEvent?.(...)` call doesn't trip on
 *  signature narrowing inside the union. */
export interface InsightsEmitter {
    addEvent(type: string, payload: Record<string, any>, options?: { tags?: string[]; duration_ms?: number }): any;
}

export interface BackgroundLoaderConfig<T> {
    /** Stable id used in bg_load_start / bg_load_complete telemetry. */
    id: string;
    /** The actual fetch. Called at most once per loader (unless reset()). */
    fetch: () => Promise<T>;
    /** Fires after the promise resolves successfully. Use to inject the
     *  value into agent context, populate store state, etc. */
    onResolve?: (value: T, opts: { fromPrefetch: boolean }) => void;
    /** Optional insights client for bg_load_* events. Telemetry is silent
     *  if unset. */
    insights?: InsightsEmitter | null;
}

export interface BackgroundLoader<T> {
    prefetch(): void;
    get(): Promise<T>;
    peek(): T | undefined;
    reset(): void;
}

export function createBackgroundLoader<T>(config: BackgroundLoaderConfig<T>): BackgroundLoader<T> {
    let promise: Promise<T> | null = null;
    let resolvedValue: T | undefined = undefined;
    let startedAt: number | null = null;

    const run = (fromPrefetch: boolean): Promise<T> => {
        if (promise) return promise;
        startedAt = performance.now();
        const source = fromPrefetch ? 'prefetch' : 'on_demand';
        config.insights?.addEvent?.('bg_load_start', { id: config.id, source }, { tags: ['boot', 'bg_load'] });
        promise = config.fetch()
            .then((value) => {
                resolvedValue = value;
                const duration_ms = Math.round(performance.now() - (startedAt ?? performance.now()));
                config.insights?.addEvent?.(
                    'bg_load_complete',
                    { id: config.id, ok: true, source, duration_ms },
                    { duration_ms, tags: ['boot', 'bg_load', 'latency'] },
                );
                try { config.onResolve?.(value, { fromPrefetch }); } catch { /* onResolve failures must not propagate */ }
                return value;
            })
            .catch((err) => {
                const duration_ms = Math.round(performance.now() - (startedAt ?? performance.now()));
                config.insights?.addEvent?.(
                    'bg_load_complete',
                    { id: config.id, ok: false, source, duration_ms, error: err?.message ?? String(err) },
                    { duration_ms, tags: ['boot', 'bg_load', 'error'] },
                );
                promise = null;
                throw err;
            });
        return promise;
    };

    return {
        prefetch: () => { run(true); },
        get: () => run(false),
        peek: () => resolvedValue,
        reset: () => { promise = null; resolvedValue = undefined; startedAt = null; },
    };
}
