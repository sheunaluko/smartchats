/**
 * Live monitor — generic polling wrapper around any analyzer.
 *
 * The eight existing analyzers (cost / slow_calls / function_calls /
 * function_args / errors / users / context_growth / issues) all expose a
 * uniform shape:
 *
 *   query<X>(client, args): Promise<{ rows: R[], ... }>
 *   format<X>(result, opts?): string
 *
 * This wrapper re-runs the analyzer on an interval, diffs the row set
 * against the previous tick (by caller-supplied key), and:
 *   - re-renders the table in place (live-table mode)
 *   - prints added/changed rows below the previous output (append mode)
 *   - stays silent and just fires callbacks (silent mode)
 *
 * Callbacks fire after the render:
 *   - onResult(result, diff)      every tick, after a successful query
 *   - onNewRow(row)               per row that appeared since last tick
 *   - onUpdate(row, prev)         per row whose key existed but content changed
 *   - alerts[i].do(row, prev?)    per matching row when alerts[i].when() is true
 *
 * Path B (true SurrealDB LIVE SELECT push, sub-second latency) is a
 * future upgrade — would slot under this same external API. For the
 * "watch production from a terminal" workload, 5–10s polling latency is
 * indistinguishable.
 */
import type { Client } from 'smartchats-database';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface MonitorAnalyzerResult<R> {
    rows: R[];
    [k: string]: unknown;
}

export type RowKeyFn<R> = (row: R) => string;

export interface LiveDiff<R> {
    added: R[];
    changed: Array<{ row: R; prev: R }>;
    removed: R[];
}

export interface AlertRule<R> {
    /** Optional human-readable label. Printed when the alert fires. */
    label?: string;
    /** Predicate. Called for every added/changed row each tick. */
    when: (row: R, prev?: R) => boolean;
    /** Side effect. Awaited before the next tick is scheduled. */
    do: (row: R, prev?: R) => void | Promise<void>;
}

export type RenderMode = 'live-table' | 'append' | 'silent';

export interface LiveMonitorOptions<R, A> {
    client: Client;
    /** Any query<X> analyzer that returns `{ rows: R[], ... }`. */
    analyzer: (client: Client, args: A) => Promise<MonitorAnalyzerResult<R>>;
    /** Optional formatter used by 'live-table' render. If omitted, JSON. */
    format?: (result: MonitorAnalyzerResult<R>) => string;
    /** Analyzer args. Anything the underlying analyzer accepts. */
    args: A;
    /** Identifies a row across ticks. Required for diff. */
    key: RowKeyFn<R>;
    /** Tick interval (ms). Default 5000. */
    intervalMs?: number;
    render?: RenderMode;
    /** Hide noise on first tick (treat all rows as pre-existing). Default true. */
    quietFirstTick?: boolean;
    onResult?: (result: MonitorAnalyzerResult<R>, diff: LiveDiff<R>) => void | Promise<void>;
    onNewRow?: (row: R) => void | Promise<void>;
    onUpdate?: (row: R, prev: R) => void | Promise<void>;
    alerts?: AlertRule<R>[];
}

export interface LiveMonitorController {
    start(): Promise<void>;
    stop(): Promise<void>;
    /** Run one tick on demand. start() calls this internally; useful for tests. */
    tick(): Promise<void>;
}

// ──────────────────────────────────────────────────────────────────────────
// Implementation
// ──────────────────────────────────────────────────────────────────────────

const ANSI_CLEAR = '\x1b[2J\x1b[H';
const ANSI_HIDE_CURSOR = '\x1b[?25l';
const ANSI_SHOW_CURSOR = '\x1b[?25h';

export function liveMonitor<R, A>(opts: LiveMonitorOptions<R, A>): LiveMonitorController {
    const intervalMs = opts.intervalMs ?? 5000;
    const render: RenderMode = opts.render ?? 'live-table';
    const quietFirstTick = opts.quietFirstTick ?? true;

    let prevByKey = new Map<string, R>();
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let tickCount = 0;

    async function runOnce(): Promise<void> {
        tickCount += 1;
        let result: MonitorAnalyzerResult<R>;
        try {
            result = await opts.analyzer(opts.client, opts.args);
        } catch (err) {
            // Don't kill the monitor on a transient query failure. Log and
            // wait for the next tick.
            process.stderr.write(`[monitor] tick ${tickCount} query failed: ${(err as Error).message}\n`);
            return;
        }

        const currByKey = new Map<string, R>();
        for (const r of result.rows) currByKey.set(opts.key(r), r);

        const isFirstTick = tickCount === 1;
        const d = isFirstTick && quietFirstTick
            ? { added: [], changed: [], removed: [] } as LiveDiff<R>
            : diffByKey(prevByKey, currByKey);

        // ── render ──
        if (render === 'live-table') {
            const body = opts.format
                ? opts.format(result)
                : JSON.stringify(result, null, 2);
            process.stdout.write(ANSI_CLEAR);
            process.stdout.write(body);
            process.stdout.write(`\n\n[monitor] tick ${tickCount} @ ${new Date().toISOString()}   added: ${d.added.length}  changed: ${d.changed.length}  removed: ${d.removed.length}\n`);
        } else if (render === 'append') {
            if (d.added.length || d.changed.length) {
                process.stdout.write(`[monitor] tick ${tickCount} @ ${new Date().toISOString()}\n`);
                for (const r of d.added) {
                    process.stdout.write(`  + ${safeJson(r)}\n`);
                }
                for (const { row, prev } of d.changed) {
                    process.stdout.write(`  ~ ${safeJson(row)}  (was ${safeJson(prev)})\n`);
                }
            }
        }

        // ── callbacks ──
        try { await opts.onResult?.(result, d); }
        catch (err) { process.stderr.write(`[monitor] onResult threw: ${(err as Error).message}\n`); }

        if (opts.onNewRow) {
            for (const r of d.added) {
                try { await opts.onNewRow(r); }
                catch (err) { process.stderr.write(`[monitor] onNewRow threw: ${(err as Error).message}\n`); }
            }
        }
        if (opts.onUpdate) {
            for (const { row, prev } of d.changed) {
                try { await opts.onUpdate(row, prev); }
                catch (err) { process.stderr.write(`[monitor] onUpdate threw: ${(err as Error).message}\n`); }
            }
        }

        if (opts.alerts && opts.alerts.length) {
            const considered: Array<{ row: R; prev?: R }> = [
                ...d.added.map((row) => ({ row, prev: undefined })),
                ...d.changed.map(({ row, prev }) => ({ row, prev })),
            ];
            for (const rule of opts.alerts) {
                for (const { row, prev } of considered) {
                    if (!rule.when(row, prev)) continue;
                    const label = rule.label ?? '(alert)';
                    process.stdout.write(`[monitor] alert ${label}: ${safeJson(row)}\n`);
                    try { await rule.do(row, prev); }
                    catch (err) { process.stderr.write(`[monitor] alert "${label}" threw: ${(err as Error).message}\n`); }
                }
            }
        }

        prevByKey = currByKey;
    }

    return {
        async start() {
            if (render === 'live-table') process.stdout.write(ANSI_HIDE_CURSOR);
            const tickLoop = async (): Promise<void> => {
                if (stopped) return;
                await runOnce();
                if (stopped) return;
                timer = setTimeout(tickLoop, intervalMs);
            };
            await tickLoop();
        },
        async stop() {
            stopped = true;
            if (timer) clearTimeout(timer);
            if (render === 'live-table') process.stdout.write(ANSI_SHOW_CURSOR + '\n');
        },
        async tick() {
            await runOnce();
        },
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function diffByKey<R>(prev: Map<string, R>, curr: Map<string, R>): LiveDiff<R> {
    const added: R[] = [];
    const changed: Array<{ row: R; prev: R }> = [];
    const removed: R[] = [];

    for (const [k, row] of curr) {
        const prevRow = prev.get(k);
        if (prevRow === undefined) {
            added.push(row);
        } else if (safeJson(row) !== safeJson(prevRow)) {
            changed.push({ row, prev: prevRow });
        }
    }
    for (const [k, prevRow] of prev) {
        if (!curr.has(k)) removed.push(prevRow);
    }
    return { added, changed, removed };
}

function safeJson(v: unknown): string {
    try { return JSON.stringify(v); } catch { return String(v); }
}
