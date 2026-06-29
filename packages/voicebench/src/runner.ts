/**
 * Trial runner. Given a provider + scenario + trial count, executes
 * each trial sequentially (parallelism would muddy the latency numbers)
 * and collects per-batch timing into TrialMeasurement objects.
 *
 * Connect-time measurement is done with wall-clock around the
 * provider.connect() call. Stream-time measurement uses the provider's
 * own callbacks so we capture the same numbers we'd see in production
 * (vs an outside-the-stream observer that would only see the player-
 * side arrivals).
 */

import type { TtsProvider, ConnectOpts } from './providers/_types.js';
import type { Scenario } from './scenarios/index.js';
import type { TrialMeasurement, BatchTiming } from './metrics/timing.js';

export interface RunOptions {
    provider: TtsProvider;
    scenario: Scenario;
    voice: string;
    trials: number;
    /** Delay between trials in ms — let provider connections cool slightly. */
    interTrialMs?: number;
    /** Connect options (model, batching). Defaults inherited from the provider. */
    connectOpts?: Partial<ConnectOpts>;
    /**
     * If set, the runner accumulates each batch's PCM buffer in-memory and
     * passes them to this callback after the trial completes. Used by the
     * --save-audio path in bench.ts to write per-batch raw PCM (and a
     * concatenated reference WAV) to disk so the playback simulator can
     * reconstruct the stuttered listening experience offline.
     *
     * Heads up: keeping per-batch buffers doubles peak memory during a trial,
     * so leave this undefined when running large matrices.
     */
    onTrialAudio?: (trial: TrialMeasurement, pcmBatches: Buffer[]) => Promise<void> | void;
}

export async function runScenario(opts: RunOptions): Promise<TrialMeasurement[]> {
    const results: TrialMeasurement[] = [];
    const interTrialMs = opts.interTrialMs ?? 500;

    for (let trialIndex = 0; trialIndex < opts.trials; trialIndex++) {
        if (trialIndex > 0) await sleep(interTrialMs);

        const connectStart = Date.now();
        let connection;
        try {
            connection = await opts.provider.connect({
                voice: opts.voice,
                ...(opts.connectOpts ?? {}),
            });
        } catch (err) {
            results.push({
                provider: opts.provider.name,
                scenarioId: opts.scenario.id,
                trialIndex,
                voice: opts.voice,
                setupMs: Date.now() - connectStart,
                isCold: true,
                timeToFirstByteMs: null,
                batches: [],
                totalResponseMs: 0,
                totalBytes: 0,
                totalAudioMs: 0,
                estimatedCostUsd: 0,
                error: `connect failed: ${(err as Error).message}`,
            });
            continue;
        }
        // setup_ms from the connection itself overrides the wall-clock measure —
        // some providers can give more precise numbers (e.g. WS handshake only).
        const measuredSetupMs = connection.setup_ms || (Date.now() - connectStart);

        const streamStart = Date.now();
        let firstByteMs: number | null = null;
        const batches: BatchTiming[] = [];
        let totalBytes = 0;
        const captureAudio = !!opts.onTrialAudio;
        const pcmBatches: Buffer[] = [];

        try {
            for await (const pcm of connection.stream({
                text: opts.scenario.text,
                onFirstByte: (ms) => { firstByteMs = ms; },
                onBatchYield: (e) => { batches.push(e); },
            })) {
                totalBytes += pcm.length;
                if (captureAudio) pcmBatches.push(pcm);
            }
            const totalResponseMs = Date.now() - streamStart;
            // PCM16 24kHz mono = 48,000 bytes per second of audio.
            const totalAudioMs = Math.round((totalBytes / 48000) * 1000);
            const cost = opts.provider.estimateCost({
                text: opts.scenario.text,
                outputBytes: totalBytes,
                voice: opts.voice,
                ...(opts.connectOpts?.model ? { model: opts.connectOpts.model } : {}),
            });
            const trial: TrialMeasurement = {
                provider: opts.provider.name,
                scenarioId: opts.scenario.id,
                trialIndex,
                voice: opts.voice,
                setupMs: Math.round(measuredSetupMs),
                isCold: connection.is_cold,
                timeToFirstByteMs: firstByteMs,
                batches,
                totalResponseMs,
                totalBytes,
                totalAudioMs,
                estimatedCostUsd: cost.usd,
            };
            if (captureAudio) await opts.onTrialAudio!(trial, pcmBatches);
            results.push(trial);
        } catch (err) {
            results.push({
                provider: opts.provider.name,
                scenarioId: opts.scenario.id,
                trialIndex,
                voice: opts.voice,
                setupMs: Math.round(measuredSetupMs),
                isCold: connection.is_cold,
                timeToFirstByteMs: firstByteMs,
                batches,
                totalResponseMs: Date.now() - streamStart,
                totalBytes,
                totalAudioMs: Math.round((totalBytes / 48000) * 1000),
                estimatedCostUsd: 0,
                error: `stream failed: ${(err as Error).message}`,
            });
        } finally {
            await connection.close().catch(() => {});
        }
    }

    return results;
}

function sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
}
