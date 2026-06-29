/**
 * LLM benchmark reporter. Two views:
 *
 *   per-trial table — every measurement visible, for outlier spotting
 *   per-(model, scenario) aggregate — cold + warm columns side by side
 *
 * Cold and warm are reported as SEPARATE numbers because they typically
 * differ by 5-50% on cached providers. Production behavior matches the
 * warm column for our use case (we hit cache aggressively) but the cold
 * column is the realistic worst case worth seeing.
 */

import type { TrialMeasurement } from './runner.js';

function median(xs: number[]): number {
    if (xs.length === 0) return 0;
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.floor(s.length / 2)]!;
}

function p95(xs: number[]): number {
    if (xs.length === 0) return 0;
    const s = xs.slice().sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(0.95 * (s.length - 1)))]!;
}

function fmt(n: number | null | undefined): string {
    if (n == null) return '   —';
    return String(Math.round(n));
}

export function reportTrials(trials: TrialMeasurement[]): string {
    const lines: string[] = [];
    lines.push('═'.repeat(130));
    lines.push('Per-trial measurements');
    lines.push('═'.repeat(130));
    lines.push(
        `${'model'.padEnd(40)} ${'scenario'.padEnd(13)} ${'cache'.padEnd(5)} ${'trial'.padStart(5)}  ` +
        `${'ttfb_ms'.padStart(8)}  ${'total_ms'.padStart(8)}  ${'in_tok'.padStart(6)}  ${'out_tok'.padStart(7)}  ${'cache_in'.padStart(8)}  ${'cost_usd'.padStart(10)}`,
    );
    lines.push('-'.repeat(130));
    for (const t of trials) {
        lines.push(
            `${t.modelKey.padEnd(40)} ${t.scenarioId.padEnd(13)} ${t.cacheClass.padEnd(5)} ${String(t.trialIndex).padStart(5)}  ` +
            `${fmt(t.timeToFirstByteMs).padStart(8)}  ${fmt(t.totalResponseMs).padStart(8)}  ` +
            `${String(t.inputTokens).padStart(6)}  ${String(t.outputTokens).padStart(7)}  ${String(t.cachedInputTokens).padStart(8)}  ${t.estimatedCostUsd.toFixed(6).padStart(10)}` +
            (t.error ? `  ERR: ${t.error.slice(0, 60)}` : ''),
        );
    }
    return lines.join('\n');
}

export function reportAggregate(trials: TrialMeasurement[]): string {
    const lines: string[] = [];
    lines.push('');
    lines.push('═'.repeat(140));
    lines.push('Aggregate per (model × scenario) — separate cold and warm columns');
    lines.push('═'.repeat(140));

    // Group by (modelKey, scenarioId).
    const groups = new Map<string, TrialMeasurement[]>();
    for (const t of trials) {
        const key = `${t.modelKey}::${t.scenarioId}`;
        let arr = groups.get(key);
        if (!arr) { arr = []; groups.set(key, arr); }
        arr.push(t);
    }

    lines.push(
        `${'model × scenario'.padEnd(56)} ${'tier'.padEnd(6)}  ` +
        `${'ttfb_cold'.padStart(10)} ${'ttfb_warm'.padStart(10)}  ` +
        `${'total_cold'.padStart(10)} ${'total_warm'.padStart(10)}  ` +
        `${'out_tok'.padStart(7)}  ${'cost_avg'.padStart(10)}`,
    );
    lines.push('-'.repeat(140));

    for (const [key, ts] of [...groups.entries()].sort()) {
        const ok = ts.filter((t) => !t.error);
        const cold = ok.filter((t) => t.cacheClass === 'cold');
        const warm = ok.filter((t) => t.cacheClass === 'warm');
        const ttfbCold = cold.length ? median(cold.map((t) => t.timeToFirstByteMs ?? 0)) : 0;
        const ttfbWarm = warm.length ? median(warm.map((t) => t.timeToFirstByteMs ?? 0)) : 0;
        const totalCold = cold.length ? median(cold.map((t) => t.totalResponseMs)) : 0;
        const totalWarm = warm.length ? median(warm.map((t) => t.totalResponseMs)) : 0;
        const outTok = ok.length ? median(ok.map((t) => t.outputTokens)) : 0;
        const avgCost = ok.length ? ok.reduce((a, t) => a + t.estimatedCostUsd, 0) / ok.length : 0;
        const errs = ts.length - ok.length;
        const errBadge = errs > 0 ? ` (${errs} errored)` : '';

        // pull tier off the trial's modelKey via cortex
        const tier = 'auto';

        lines.push(
            `${key.padEnd(56)} ${tier.padEnd(6)}  ` +
            `${fmt(ttfbCold).padStart(10)} ${fmt(ttfbWarm).padStart(10)}  ` +
            `${fmt(totalCold).padStart(10)} ${fmt(totalWarm).padStart(10)}  ` +
            `${String(outTok).padStart(7)}  ${avgCost.toFixed(6).padStart(10)}${errBadge}`,
        );
    }
    lines.push('');
    lines.push('All times are medians across trials. cost_avg is mean. Cold = first trial w/ unique nonce. Warm = N subsequent identical-prompt trials.');
    return lines.join('\n');
}
