/**
 * Report formatter. Two views:
 *  - per-trial table (every trial visible, for spotting outliers)
 *  - per-(provider, scenario) aggregate (median/p95/min/max), for ranking
 *
 * Output is plain text optimized for terminal width. JSON-format
 * persistence is the runner's responsibility; this only produces the
 * console-readable summary.
 */

import { aggregate, deriveStatsFromBatches, type TrialMeasurement } from './metrics/timing.js';

export function reportTrials(trials: TrialMeasurement[]): string {
    const lines: string[] = [];

    lines.push('═'.repeat(110));
    lines.push('Per-trial measurements');
    lines.push('═'.repeat(110));
    lines.push(
        `${'provider'.padEnd(14)} ${'scenario'.padEnd(10)} ${'trial'.padStart(5)}  ` +
        `${'setup_ms'.padStart(8)}  ${'ttfb_ms'.padStart(7)}  ${'01_gap_ms'.padStart(9)}  ` +
        `${'p95_gap'.padStart(7)}  ${'total_resp'.padStart(10)}  ${'total_audio'.padStart(11)}  ` +
        `${'bytes'.padStart(7)}  ${'cost_usd'.padStart(9)}`
    );
    lines.push('-'.repeat(110));
    for (const t of trials) {
        const derived = deriveStatsFromBatches(t.batches);
        const fmt = (n: number | null | undefined): string => n == null ? '   —' : String(Math.round(n));
        lines.push(
            `${t.provider.padEnd(14)} ${t.scenarioId.padEnd(10)} ${String(t.trialIndex).padStart(5)}  ` +
            `${fmt(t.setupMs).padStart(8)}  ${fmt(t.timeToFirstByteMs).padStart(7)}  ${fmt(derived.interBatch01Ms).padStart(9)}  ` +
            `${fmt(derived.interBatchP95Ms).padStart(7)}  ${fmt(t.totalResponseMs).padStart(10)}  ${fmt(t.totalAudioMs).padStart(11)}  ` +
            `${String(t.totalBytes).padStart(7)}  ${t.estimatedCostUsd.toFixed(6).padStart(9)}` +
            (t.error ? `  ERR: ${t.error}` : '')
        );
    }
    return lines.join('\n');
}

export function reportAggregate(trials: TrialMeasurement[]): string {
    const lines: string[] = [];
    lines.push('');
    lines.push('═'.repeat(110));
    lines.push('Aggregate (per provider × scenario)');
    lines.push('═'.repeat(110));

    // Group by (provider, scenarioId).
    const groups = new Map<string, TrialMeasurement[]>();
    for (const t of trials) {
        const key = `${t.provider}::${t.scenarioId}`;
        let arr = groups.get(key);
        if (!arr) { arr = []; groups.set(key, arr); }
        arr.push(t);
    }

    lines.push(
        `${'provider × scenario'.padEnd(28)}  n  ` +
        `${'setup'.padStart(10)}  ${'ttfb'.padStart(10)}  ${'01_gap'.padStart(10)}  ${'p95_gap'.padStart(10)}  ` +
        `${'total_resp'.padStart(12)}  ${'cost_usd_avg'.padStart(13)}`
    );
    lines.push('-'.repeat(110));

    for (const [key, ts] of groups) {
        const okTrials = ts.filter((t) => !t.error);
        const setup = aggregate(okTrials.map((t) => t.setupMs));
        const ttfb = aggregate(okTrials.map((t) => t.timeToFirstByteMs));
        const gap01 = aggregate(okTrials.map((t) => deriveStatsFromBatches(t.batches).interBatch01Ms));
        const gapP95 = aggregate(okTrials.map((t) => deriveStatsFromBatches(t.batches).interBatchP95Ms));
        const totalResp = aggregate(okTrials.map((t) => t.totalResponseMs));
        const avgCost = okTrials.length === 0
            ? 0
            : okTrials.reduce((a, t) => a + t.estimatedCostUsd, 0) / okTrials.length;
        const errs = ts.length - okTrials.length;
        const errBadge = errs > 0 ? ` (${errs} errored)` : '';
        const triple = (s: ReturnType<typeof aggregate>): string =>
            s == null ? '—' : `${s.median}/${s.p95}/${s.max}`;
        lines.push(
            `${key.padEnd(28)}  ${String(ts.length).padStart(1)}  ` +
            `${triple(setup).padStart(10)}  ${triple(ttfb).padStart(10)}  ${triple(gap01).padStart(10)}  ${triple(gapP95).padStart(10)}  ` +
            `${triple(totalResp).padStart(12)}  ${avgCost.toFixed(6).padStart(13)}${errBadge}`
        );
    }
    lines.push('');
    lines.push('Format: median/p95/max for timing columns. cost_usd_avg = mean of trial estimates.');
    return lines.join('\n');
}
