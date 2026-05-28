'use client';

/**
 * ExperimentRunner — /sail panel that runs a sequence of voice turns with
 * varying experiment params, collects timing telemetry, and displays a
 * comparative results matrix.
 *
 * Architecture: piggybacks on the simi runner. For each config × replicate:
 *   1. setExperimentParams(...) — registers params for the next LLM call
 *   2. window.__smartchats__.simi.workflows.basic_chat_flow() — fires a chat
 *   3. Wait a buffer period for TTS scheduling to flush
 *   4. Filter cortexInsights events by time window → bucket per config
 *   5. Aggregate p50/p95 metrics per config
 *
 * Each run is also tagged via session_tags so `bin/find-sessions --tag
 * exp:<name>` can isolate runs post-hoc for deeper offline analysis.
 *
 * Cost: each replicate = ~$0.003 of OpenAI TTS + ~$0.005 LLM. A typical
 * 5-config × 3-replicate suite = ~$0.12. Warning surfaced in the UI.
 */

import React, { useEffect, useRef, useState } from 'react';
import { setExperimentParams, type ExperimentParams } from '@/lib/llm_caller';
import { useInsights } from '@/context/InsightsContext';

interface ExperimentConfig {
    name: string;
    description: string;
    params: Partial<ExperimentParams>;
}

interface SuiteDef {
    id: string;
    label: string;
    description: string;
    /** Default replicates when this suite is selected. Sweeps use higher
     *  counts because per-config noise is what they're measuring through. */
    defaultReplicates: number;
    configs: ExperimentConfig[];
}

const SUITES: SuiteDef[] = [
    {
        id: 'mixed',
        label: 'mixed (covers lookahead + server tuning)',
        description: 'broad sweep across multiple knobs at once — good for first-pass scouting',
        defaultReplicates: 3,
        configs: [
            { name: 'baseline',           description: 'production defaults (init=300/snap=150) — Phase C',            params: {} },
            { name: 'no_lookahead',       description: 'pre-Phase-C: init=10/snap=10 — should reproduce glitch',       params: { initial_lookahead_ms: 10,   snap_lookahead_ms: 10 } },
            { name: 'tiny_lookahead',     description: 'init=50/snap=20 — minimal scheduling margin',                  params: { initial_lookahead_ms: 50,   snap_lookahead_ms: 20 } },
            { name: 'huge_lookahead',     description: 'init=1000/snap=500 — bulletproof but latent',                  params: { initial_lookahead_ms: 1000, snap_lookahead_ms: 500 } },
            { name: 'small_first_batch',  description: 'fast chunk 0, normal rest',                                    params: { tts_first_batch_bytes: 1600 } },
            { name: 'tts1_model',         description: 'tts-1 instead of gpt-4o-mini-tts',                             params: { tts_model_id: 'tts-1' } },
        ],
    },
    {
        id: 'init_sweep',
        label: 'init sweep (snap held at 150ms)',
        description: 'isolate initial_lookahead_ms — varies init across 5 values, snap fixed at 150ms (Phase C default). Many replicates per config for chunk-0-snap signal.',
        defaultReplicates: 5,
        configs: [
            { name: 'init_50',   description: 'init=50, snap=150',   params: { initial_lookahead_ms: 50,   snap_lookahead_ms: 150 } },
            { name: 'init_150',  description: 'init=150, snap=150',  params: { initial_lookahead_ms: 150,  snap_lookahead_ms: 150 } },
            { name: 'init_300',  description: 'init=300, snap=150 (Phase C default)', params: { initial_lookahead_ms: 300,  snap_lookahead_ms: 150 } },
            { name: 'init_600',  description: 'init=600, snap=150',  params: { initial_lookahead_ms: 600,  snap_lookahead_ms: 150 } },
            { name: 'init_1000', description: 'init=1000, snap=150', params: { initial_lookahead_ms: 1000, snap_lookahead_ms: 150 } },
        ],
    },
    {
        id: 'snap_sweep',
        label: 'snap sweep (init held at 300ms)',
        description: 'isolate snap_lookahead_ms — varies snap across 5 values, init fixed at 300ms (Phase C default). Many replicates to characterize chunk-1+ snap-cascade behavior.',
        defaultReplicates: 5,
        configs: [
            { name: 'snap_10',  description: 'init=300, snap=10',  params: { initial_lookahead_ms: 300, snap_lookahead_ms: 10 } },
            { name: 'snap_50',  description: 'init=300, snap=50',  params: { initial_lookahead_ms: 300, snap_lookahead_ms: 50 } },
            { name: 'snap_150', description: 'init=300, snap=150 (Phase C default)', params: { initial_lookahead_ms: 300, snap_lookahead_ms: 150 } },
            { name: 'snap_300', description: 'init=300, snap=300', params: { initial_lookahead_ms: 300, snap_lookahead_ms: 300 } },
            { name: 'snap_500', description: 'init=300, snap=500', params: { initial_lookahead_ms: 300, snap_lookahead_ms: 500 } },
        ],
    },
];
type SuiteId = typeof SUITES[number]['id'];

const DEFAULT_SUITE_ID: SuiteId = 'mixed';
const RESET_BETWEEN_RUNS_MS = 1500; // cool-down so OpenAI encoder doesn't carry state

// Available simi workflows for experiment runs. Add new ones here as they're
// authored. basic_chat_flow is fast (~12s) but produces short responses; the
// chunk-0 audio glitch only reproduces with longer responses because of
// server-side HTTP flush cadence (see long_response_flow comments).
const WORKFLOWS = [
    { id: 'basic_chat_flow',     label: 'basic_chat (short response, ~12s/run)',                wait_ms: 5_000 },
    { id: 'long_response_flow',  label: 'long_response (~60s audio)',                            wait_ms: 90_000 },
    { id: 'splitter_repro_flow', label: 'splitter_repro (2 sentences, forces early TTS call)',  wait_ms: 60_000 },
] as const;
type WorkflowId = typeof WORKFLOWS[number]['id'];

interface RunSample {
    config_name: string;
    replicate: number;
    experiment_id: string;
    start_ts: number;
    end_ts: number;
    success: boolean;
    error?: string;
    tts_playback_events: any[];
    tts_server_events: any[];
}

interface ConfigSummary {
    config_name: string;
    description: string;
    n_runs: number;
    n_success: number;
    n_failed: number;
    first_chunk_arrival_ms: { p50: number; p95: number; min: number; max: number } | null;
    /** Chunk-0 snap rate — driven by `initial_lookahead_ms` ALONE (no dependency on snap_lookahead).
     *  This is the clean metric for isolating initial's effect. */
    chunk0_snap_rate: number | null;
    /** Chunk-1+ snap rate — driven jointly by snap_lookahead and prior-chunk durations.
     *  Compared with chunk0_snap_rate to see snap_lookahead's marginal contribution. */
    chunk1_snap_rate: number | null;
    chunk0_1_gap_ms: { p50: number; p95: number } | null;
    server_first_byte_ms: { p50: number; p95: number } | null;
}

export function ExperimentRunner() {
    const { client: insightsClient } = useInsights();
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<{ config: string; replicate: number; configIdx: number; totalConfigs: number } | null>(null);
    const [samples, setSamples] = useState<RunSample[]>([]);
    const [suiteId, setSuiteId] = useState<SuiteId>(DEFAULT_SUITE_ID);
    const selectedSuite = SUITES.find(s => s.id === suiteId) ?? SUITES[0];
    const [replicates, setReplicates] = useState(selectedSuite.defaultReplicates);
    const [workflowId, setWorkflowId] = useState<WorkflowId>('basic_chat_flow');
    const stopRequestedRef = useRef(false);

    const selectedWorkflow = WORKFLOWS.find(w => w.id === workflowId) ?? WORKFLOWS[0];
    const suiteConfigs = selectedSuite.configs;

    // When the user picks a new suite, reset replicates + clear stale samples
    // (rows wouldn't line up with the new configs anyway).
    function changeSuite(newId: SuiteId) {
        const next = SUITES.find(s => s.id === newId) ?? SUITES[0];
        setSuiteId(newId);
        setReplicates(next.defaultReplicates);
        setSamples([]);
    }

    async function runSuite() {
        setRunning(true);
        setSamples([]);
        stopRequestedRef.current = false;

        try {
            for (let i = 0; i < suiteConfigs.length; i++) {
                const cfg = suiteConfigs[i];
                for (let r = 0; r < replicates; r++) {
                    if (stopRequestedRef.current) return;
                    setProgress({ config: cfg.name, replicate: r, configIdx: i, totalConfigs: suiteConfigs.length });
                    const sample = await runOne(cfg, r);
                    setSamples(prev => [...prev, sample]);
                    if (stopRequestedRef.current) return;
                    if (i < suiteConfigs.length - 1 || r < replicates - 1) {
                        await new Promise(res => setTimeout(res, RESET_BETWEEN_RUNS_MS));
                    }
                }
            }
        } finally {
            setExperimentParams(null);
            setProgress(null);
            setRunning(false);
        }
    }

    async function runOne(cfg: ExperimentConfig, replicateIdx: number): Promise<RunSample> {
        const experiment_id = `exp:${cfg.name}_r${replicateIdx}_${Date.now().toString(36)}`;
        const start_ts = Date.now();

        // Set params + session tag
        setExperimentParams({ ...cfg.params, experiment_id });
        try { insightsClient?.addSessionTags?.([experiment_id]); } catch { /* best-effort */ }

        let success = false;
        let error: string | undefined;
        try {
            const flow = (window as any).__smartchats__?.simi?.workflows?.[selectedWorkflow.id];
            if (!flow) throw new Error(`${selectedWorkflow.id} workflow not available (is voice mode on?)`);
            const result = await flow();
            success = !!result?.completed;
            if (!success) {
                const failedStep = result?.steps?.find((s: any) => s.status === 'error');
                error = result?.error || failedStep?.error || 'workflow did not complete';
            }
        } catch (err) {
            error = (err as Error)?.message ?? String(err);
        }

        // Let TTS playback finish + insights batch flush. Long workflows
        // produce 30-60s of TTS audio, so the wait scales per workflow.
        await new Promise(res => setTimeout(res, selectedWorkflow.wait_ms));
        const end_ts = Date.now();

        // Pull events for this run by time-window
        const allEvents = (insightsClient as any)?.exportSession?.()?.events ?? [];
        const windowed = allEvents.filter((e: any) => e.timestamp >= start_ts && e.timestamp <= end_ts);
        const tts_playback_events = windowed.filter((e: any) => e.event_type === 'tts_playback_timing');
        const tts_server_events = windowed.filter((e: any) => e.event_type === 'tts_server_timing');

        return { config_name: cfg.name, replicate: replicateIdx, experiment_id, start_ts, end_ts, success, error, tts_playback_events, tts_server_events };
    }

    // Aggregate samples → per-config summary
    const summaries: ConfigSummary[] = suiteConfigs.map(cfg => {
        const cfgSamples = samples.filter(s => s.config_name === cfg.name);
        const n_runs = cfgSamples.length;
        const n_success = cfgSamples.filter(s => s.success).length;
        const n_failed = n_runs - n_success;

        // first_chunk_arrival across all utterances in successful runs
        const firstChunkArrivals = cfgSamples
            .flatMap(s => s.tts_playback_events.map(e => e.payload?.first_chunk?.arrival_ms))
            .filter((v): v is number => typeof v === 'number');

        // Chunk-0 snap — depends on initial_lookahead only (see tts_queue.ts:489-516).
        const chunk0Flags = cfgSamples
            .flatMap(s => s.tts_playback_events.map(e => e.payload?.first_chunk?.snapped_forward))
            .filter(v => v !== undefined);

        // Chunk-1 snap — depends on snap_lookahead (when chunk 0 snapped) + chunk 0 duration.
        const chunk1Flags = cfgSamples
            .flatMap(s => s.tts_playback_events.map(e => e.payload?.chunks?.[1]?.snapped_forward))
            .filter(v => v !== undefined);

        // chunk0 → chunk1 gaps
        const chunk01Gaps = cfgSamples
            .flatMap(s => s.tts_playback_events.map(e => {
                const chunks = e.payload?.chunks ?? [];
                if (chunks.length < 2) return null;
                return chunks[1].arrival_ms - chunks[0].arrival_ms;
            }))
            .filter((v): v is number => typeof v === 'number');

        // Server-side first_byte latency (when experiment_id was set)
        const serverFirstByte = cfgSamples
            .flatMap(s => s.tts_server_events
                .filter(e => e.payload?.phase === 'tts_first_byte')
                .map(e => e.payload?.ts))
            .filter((v): v is number => typeof v === 'number');

        return {
            config_name: cfg.name,
            description: cfg.description,
            n_runs,
            n_success,
            n_failed,
            first_chunk_arrival_ms: firstChunkArrivals.length > 0 ? percentiles(firstChunkArrivals) : null,
            chunk0_snap_rate: chunk0Flags.length > 0 ? chunk0Flags.filter(Boolean).length / chunk0Flags.length : null,
            chunk1_snap_rate: chunk1Flags.length > 0 ? chunk1Flags.filter(Boolean).length / chunk1Flags.length : null,
            chunk0_1_gap_ms: chunk01Gaps.length > 0 ? percentiles(chunk01Gaps) : null,
            server_first_byte_ms: serverFirstByte.length > 0 ? percentiles(serverFirstByte) : null,
        };
    });

    return (
        <div
            style={{
                color: '#dcdcdc', fontFamily: 'ui-monospace, monospace', fontSize: 11,
                background: '#11111a', border: '1px solid #2a2a3a',
                borderRadius: 8, padding: '10px 12px',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, flexWrap: 'wrap', gap: 6 }}>
                <span style={{ color: '#a0a0c0' }}>experiment runner</span>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                        value={suiteId}
                        onChange={e => changeSuite(e.target.value as SuiteId)}
                        disabled={running}
                        style={inputStyle as any}
                        title={selectedSuite.description}
                    >
                        {SUITES.map(s => <option key={s.id} value={s.id} title={s.description}>{s.label}</option>)}
                    </select>
                    <select
                        value={workflowId}
                        onChange={e => setWorkflowId(e.target.value as WorkflowId)}
                        disabled={running}
                        style={inputStyle as any}
                        title="simi workflow run per replicate"
                    >
                        {WORKFLOWS.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
                    </select>
                    <span style={{ color: '#666' }}>×</span>
                    <input
                        type="number"
                        min={1}
                        max={20}
                        value={replicates}
                        onChange={e => setReplicates(Math.max(1, parseInt(e.target.value, 10) || 1))}
                        disabled={running}
                        style={{ ...inputStyle, width: 50 }}
                        title="replicates per config (more = better statistical signal, less noise)"
                    />
                    {running ? (
                        <button onClick={() => { stopRequestedRef.current = true; }} style={dangerBtn}>stop suite</button>
                    ) : (
                        <button
                            onClick={runSuite}
                            style={primaryBtn}
                            title={`${suiteConfigs.length} configs × ${replicates} replicates each = ${suiteConfigs.length * replicates} total runs`}
                        >
                            run suite ({suiteConfigs.length}×{replicates} = {suiteConfigs.length * replicates} runs)
                        </button>
                    )}
                </div>
            </div>

            <div style={{ color: '#666', fontSize: 10, marginBottom: 8 }}>
                {selectedSuite.description} · requires voice mode active. each run dispatches the
                selected workflow, waits {(selectedWorkflow.wait_ms / 1000).toFixed(0)}s for TTS to flush, then captures
                tts_playback_timing + tts_server_timing events.
                {workflowId === 'long_response_flow' && (
                    <span style={{ color: '#ffcc66' }}> ⚠ long_response: ~{Math.ceil(suiteConfigs.length * replicates * (selectedWorkflow.wait_ms / 1000) / 60)} min runtime, ~${(suiteConfigs.length * replicates * 0.05).toFixed(2)} OpenAI total.</span>
                )}
                {workflowId === 'basic_chat_flow' && (
                    <span> ~${(suiteConfigs.length * replicates * 0.008).toFixed(2)} OpenAI total.</span>
                )}
            </div>

            {progress && (
                <div style={{ padding: '4px 8px', background: '#1a2a1a', borderRadius: 4, marginBottom: 8 }}>
                    running <strong>{progress.config}</strong> replicate {progress.replicate + 1}/{replicates}
                    {' '}({progress.configIdx + 1}/{progress.totalConfigs} configs · {samples.length} samples collected)
                </div>
            )}

            {summaries.some(s => s.n_runs > 0) && (
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                        <thead>
                            <tr style={{ borderBottom: '1px solid #2a2a3a', color: '#666' }}>
                                <th style={cell}>config</th>
                                <th style={cell}>runs</th>
                                <th style={cell}>first_chunk_arrival (p50/p95)</th>
                                <th style={cell}>chunk0→1 gap (p50/p95)</th>
                                <th style={cell} title="Chunk-0 snap rate — depends on initial_lookahead ONLY">chunk0 snap (init)</th>
                                <th style={cell} title="Chunk-1 snap rate — depends on snap_lookahead + chunk0 duration">chunk1 snap (snap)</th>
                                <th style={cell}>server first_byte (p50/p95)</th>
                            </tr>
                        </thead>
                        <tbody>
                            {summaries.map(s => (
                                <tr key={s.config_name} style={{ borderBottom: '1px solid #1a1a28' }}>
                                    <td style={{ ...cell, color: '#c0c0e0' }} title={s.description}>{s.config_name}</td>
                                    <td style={cell}>{s.n_success}/{s.n_runs}{s.n_failed > 0 ? ` (${s.n_failed} fail)` : ''}</td>
                                    <td style={cell}>{fmtRange(s.first_chunk_arrival_ms, 'ms')}</td>
                                    <td style={cell}>{fmtRange(s.chunk0_1_gap_ms, 'ms')}</td>
                                    <td style={{ ...cell, color: snapColor(s.chunk0_snap_rate) }}>{s.chunk0_snap_rate !== null ? `${(s.chunk0_snap_rate * 100).toFixed(0)}%` : '—'}</td>
                                    <td style={{ ...cell, color: snapColor(s.chunk1_snap_rate) }}>{s.chunk1_snap_rate !== null ? `${(s.chunk1_snap_rate * 100).toFixed(0)}%` : '—'}</td>
                                    <td style={cell}>{fmtRange(s.server_first_byte_ms, 'ms')}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

function percentiles(values: number[]): { p50: number; p95: number; min: number; max: number } {
    const sorted = [...values].sort((a, b) => a - b);
    const at = (frac: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * frac))];
    return { p50: at(0.5), p95: at(0.95), min: sorted[0], max: sorted[sorted.length - 1] };
}

function fmtRange(r: { p50: number; p95: number } | null, unit: string): string {
    if (!r) return '—';
    return `${r.p50.toFixed(0)}/${r.p95.toFixed(0)}${unit}`;
}

function snapColor(rate: number | null): string {
    if (rate === null) return '#666';
    if (rate < 0.2) return '#88dd88';
    if (rate < 0.7) return '#ffcc66';
    return '#ff7070';
}

const cell: React.CSSProperties = { padding: '4px 6px', textAlign: 'left', verticalAlign: 'top' };

const primaryBtn: React.CSSProperties = {
    background: '#3a5dff', color: '#fff',
    border: 'none', borderRadius: 4,
    padding: '4px 10px', fontSize: 11, fontWeight: 500, cursor: 'pointer',
    fontFamily: 'ui-monospace, monospace',
};

const dangerBtn: React.CSSProperties = {
    background: '#aa3344', color: '#fff',
    border: 'none', borderRadius: 4,
    padding: '4px 10px', fontSize: 11, fontWeight: 500, cursor: 'pointer',
    fontFamily: 'ui-monospace, monospace',
};

const inputStyle: React.CSSProperties = {
    background: '#0a0a14', color: '#dcdcdc',
    border: '1px solid #2a2a3a', borderRadius: 4,
    padding: '3px 6px', fontSize: 11,
    fontFamily: 'ui-monospace, monospace',
};
