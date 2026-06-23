/**
 * Per-trial measurement + aggregation.
 *
 * A trial = one stream() call. We measure setup, first-byte, every
 * batch arrival, total bytes, and derive p50/p95 statistics across
 * trials. The headline metric for our chunk-0→1 stutter investigation
 * is `interBatch01Ms` — the gap between batch 0 and batch 1, which
 * directly causes audible stutter when it exceeds the player's snap
 * budget (333 ms post-2026-05-28).
 */

export interface BatchTiming {
    batchIndex: number;
    msFromStreamCall: number;
    bytes: number;
    providerBytesCumulative: number;
}

export interface TrialMeasurement {
    provider: string;
    scenarioId: string;
    trialIndex: number;
    voice: string;
    /** ms from provider.connect() call → resolution. */
    setupMs: number;
    /** True if this trial actually opened a new connection (vs reused). */
    isCold: boolean;
    /** ms from stream() call → first byte callback. */
    timeToFirstByteMs: number | null;
    /** Every batch the stream yielded, in order. */
    batches: BatchTiming[];
    /** ms from stream() call → last batch yielded. */
    totalResponseMs: number;
    /** Total PCM bytes output. */
    totalBytes: number;
    /** Same as totalBytes ÷ 48000 sec for 24kHz mono PCM16, rounded to ms. */
    totalAudioMs: number;
    /** Estimated cost in USD. */
    estimatedCostUsd: number;
    /** Set when the trial errored. Other fields may be undefined. */
    error?: string;
}

export function deriveStatsFromBatches(batches: BatchTiming[]): {
    interBatch01Ms: number | null;        // headline stutter signal
    interBatchP50Ms: number | null;
    interBatchP95Ms: number | null;
    interBatchMaxMs: number | null;
} {
    if (batches.length < 2) {
        return { interBatch01Ms: null, interBatchP50Ms: null, interBatchP95Ms: null, interBatchMaxMs: null };
    }
    const gaps: number[] = [];
    for (let i = 0; i < batches.length - 1; i++) {
        gaps.push(batches[i + 1]!.msFromStreamCall - batches[i]!.msFromStreamCall);
    }
    const sorted = gaps.slice().sort((a, b) => a - b);
    const pct = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(p * (sorted.length - 1)))]!;
    return {
        interBatch01Ms: gaps[0]!,
        interBatchP50Ms: pct(0.5),
        interBatchP95Ms: pct(0.95),
        interBatchMaxMs: pct(1.0),
    };
}

export interface AggregateStats {
    n: number;
    median: number;
    mean: number;
    p95: number;
    min: number;
    max: number;
}

export function aggregate(values: (number | null | undefined)[]): AggregateStats | null {
    const xs = values.filter((v): v is number => typeof v === 'number');
    if (xs.length === 0) return null;
    const sorted = xs.slice().sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)]!;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(0.95 * (sorted.length - 1)))]!;
    return {
        n: xs.length,
        median: Math.round(median),
        mean: Math.round(mean),
        p95: Math.round(p95),
        min: Math.round(sorted[0]!),
        max: Math.round(sorted[sorted.length - 1]!),
    };
}
