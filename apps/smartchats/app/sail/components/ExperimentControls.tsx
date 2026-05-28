'use client';

/**
 * ExperimentControls — /sail panel for tweaking server- and client-side
 * audio pipeline parameters per voice turn.
 *
 * When "Experiment Mode" is on, each LLM+TTS call passes the configured
 * params as request-body fields. The server gates server_timing event
 * emission on `experiment_id` being present, so production sessions are
 * unaffected unless someone toggles this on.
 *
 * Server-side params (passed to llmTtsStreamHttp):
 *   tts_target_bytes        — steady-state TTS batch size in bytes
 *   tts_first_batch_bytes   — first batch size (smaller = faster chunk 0)
 *   first_chunk_word_threshold — words before TTS fires
 *   tts_model_id            — gpt-4o-mini-tts | tts-1 | tts-1-hd
 *
 * Client-side params (read by tts_queue + llm_caller):
 *   (none directly tunable in v1 — those are constants in tts_queue.ts;
 *    will add a setter pattern in a follow-on phase)
 *
 * On Experiment Mode toggle, also adds an `experiment_id` session tag so
 * `bin/find-sessions --tag exp:<name>` can isolate runs for analysis.
 */

import React, { useEffect, useState } from 'react';
import { setExperimentParams, getExperimentParams, type ExperimentParams } from '@/lib/llm_caller';
import { useInsights } from '@/context/InsightsContext';

const TTS_MODELS = ['gpt-4o-mini-tts', 'tts-1', 'tts-1-hd'] as const;

// Common presets — quick-pick configurations for ad-hoc experimentation.
const PRESETS: Array<{ name: string; description: string; params: Partial<ExperimentParams> }> = [
    { name: 'default', description: 'production defaults', params: {} },
    { name: 'small_first_batch', description: 'fast chunk 0, normal rest', params: { tts_first_batch_bytes: 1600 } },
    { name: 'tiny_batches', description: 'all batches small', params: { tts_target_bytes: 3200, tts_first_batch_bytes: 1600 } },
    { name: 'large_batches', description: 'fewer, larger batches', params: { tts_target_bytes: 12800 } },
    { name: 'tts1_model', description: 'use tts-1 instead of mini', params: { tts_model_id: 'tts-1' } },
    { name: 'eager_first_word', description: 'fire TTS after 3 words', params: { first_chunk_word_threshold: 3 } },
    { name: 'tiny_lookahead',   description: 'pre-Phase-C scheduling (init=50ms, snap=10ms) — reproduces glitch', params: { initial_lookahead_ms: 50,   snap_lookahead_ms: 10 } },
    { name: 'huge_lookahead',   description: 'init=1000ms, snap=500ms — bulletproof but latent',                  params: { initial_lookahead_ms: 1000, snap_lookahead_ms: 500 } },
    { name: 'init_only_high',   description: 'asymmetric: init=1000ms / snap=150ms (default) — isolates init',    params: { initial_lookahead_ms: 1000, snap_lookahead_ms: 150 } },
    { name: 'snap_only_high',   description: 'asymmetric: init=300ms (default) / snap=500ms — isolates snap',     params: { initial_lookahead_ms: 300,  snap_lookahead_ms: 500 } },
];

export function ExperimentControls() {
    const { client: insightsClient } = useInsights();
    const [enabled, setEnabled] = useState(false);
    const [experimentName, setExperimentName] = useState('manual');
    const [targetBytes, setTargetBytes] = useState<string>('');
    const [firstBatchBytes, setFirstBatchBytes] = useState<string>('');
    const [firstChunkWords, setFirstChunkWords] = useState<string>('');
    const [ttsModel, setTtsModel] = useState<string>('');
    const [initialLookaheadMs, setInitialLookaheadMs] = useState<string>('');
    const [snapLookaheadMs, setSnapLookaheadMs] = useState<string>('');

    // Sync the module-level state with the form state. When enabled is true,
    // any LLM+TTS call picks up these params. When false, params are cleared.
    useEffect(() => {
        if (!enabled) {
            setExperimentParams(null);
            return;
        }
        const params: ExperimentParams = {
            experiment_id: `exp:${experimentName}_${Date.now().toString(36)}`,
        };
        if (targetBytes.trim()) params.tts_target_bytes = parseInt(targetBytes, 10);
        if (firstBatchBytes.trim()) params.tts_first_batch_bytes = parseInt(firstBatchBytes, 10);
        if (firstChunkWords.trim()) params.first_chunk_word_threshold = parseInt(firstChunkWords, 10);
        if (ttsModel.trim()) params.tts_model_id = ttsModel;
        if (initialLookaheadMs.trim()) params.initial_lookahead_ms = parseInt(initialLookaheadMs, 10);
        if (snapLookaheadMs.trim()) params.snap_lookahead_ms = parseInt(snapLookaheadMs, 10);
        setExperimentParams(params);
        // Also tag the session so bin/find-sessions --tag <name> isolates it.
        try {
            insightsClient?.addSessionTags?.([params.experiment_id!]);
        } catch { /* tagging is best-effort */ }
    }, [enabled, experimentName, targetBytes, firstBatchBytes, firstChunkWords, ttsModel, initialLookaheadMs, snapLookaheadMs, insightsClient]);

    // Clear on unmount.
    useEffect(() => () => setExperimentParams(null), []);

    const currentParams = getExperimentParams();

    const applyPreset = (preset: typeof PRESETS[0]) => {
        setExperimentName(preset.name);
        setTargetBytes(preset.params.tts_target_bytes?.toString() ?? '');
        setFirstBatchBytes(preset.params.tts_first_batch_bytes?.toString() ?? '');
        setFirstChunkWords(preset.params.first_chunk_word_threshold?.toString() ?? '');
        setTtsModel(preset.params.tts_model_id ?? '');
        setInitialLookaheadMs(preset.params.initial_lookahead_ms?.toString() ?? '');
        setSnapLookaheadMs(preset.params.snap_lookahead_ms?.toString() ?? '');
    };

    return (
        <div
            style={{
                color: '#dcdcdc', fontFamily: 'ui-monospace, monospace', fontSize: 11,
                background: '#11111a', border: '1px solid #2a2a3a',
                borderRadius: 8, padding: '10px 12px',
            }}
        >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <span style={{ color: '#a0a0c0' }}>experiment controls</span>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={enabled}
                        onChange={(e) => setEnabled(e.target.checked)}
                    />
                    <span style={{ color: enabled ? '#88dd88' : '#888' }}>
                        {enabled ? '● experiment mode' : '○ off (production defaults)'}
                    </span>
                </label>
            </div>

            {enabled && (
                <>
                    <div style={{ marginBottom: 6, color: '#666', fontSize: 10 }}>presets</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                        {PRESETS.map((p) => (
                            <button
                                key={p.name}
                                onClick={() => applyPreset(p)}
                                title={p.description}
                                style={presetBtn}
                            >
                                {p.name}
                            </button>
                        ))}
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 6, alignItems: 'center' }}>
                        <span style={{ color: '#666' }}>name</span>
                        <input type="text" value={experimentName} onChange={(e) => setExperimentName(e.target.value)} style={inputStyle} />
                        <span style={{ color: '#666' }}>tts_target_bytes</span>
                        <input type="text" placeholder="6400 (default)" value={targetBytes} onChange={(e) => setTargetBytes(e.target.value)} style={inputStyle} />
                        <span style={{ color: '#666' }}>tts_first_batch_bytes</span>
                        <input type="text" placeholder={`= target_bytes`} value={firstBatchBytes} onChange={(e) => setFirstBatchBytes(e.target.value)} style={inputStyle} />
                        <span style={{ color: '#666' }}>first_chunk_word_threshold</span>
                        <input type="text" placeholder="8 (default)" value={firstChunkWords} onChange={(e) => setFirstChunkWords(e.target.value)} style={inputStyle} />
                        <span style={{ color: '#666' }}>tts_model_id</span>
                        <select value={ttsModel} onChange={(e) => setTtsModel(e.target.value)} style={inputStyle as any}>
                            <option value="">default (gpt-4o-mini-tts)</option>
                            {TTS_MODELS.map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <span style={{ color: '#666' }}>initial_lookahead_ms</span>
                        <input type="text" placeholder="300 (default)" value={initialLookaheadMs} onChange={(e) => setInitialLookaheadMs(e.target.value)} style={inputStyle} />
                        <span style={{ color: '#666' }}>snap_lookahead_ms</span>
                        <input type="text" placeholder="150 (default)" value={snapLookaheadMs} onChange={(e) => setSnapLookaheadMs(e.target.value)} style={inputStyle} />
                    </div>

                    {currentParams && (
                        <div style={{ marginTop: 10, padding: '6px 8px', background: '#0a0a14', borderRadius: 4, fontSize: 10, color: '#a0c0e0' }}>
                            active: {JSON.stringify(currentParams)}
                        </div>
                    )}
                </>
            )}
        </div>
    );
}

const presetBtn: React.CSSProperties = {
    background: '#222236', color: '#c0c0e0',
    border: '1px solid #2a2a3a', borderRadius: 4,
    padding: '2px 8px', fontSize: 10, cursor: 'pointer',
    fontFamily: 'ui-monospace, monospace',
};

const inputStyle: React.CSSProperties = {
    background: '#0a0a14', color: '#dcdcdc',
    border: '1px solid #2a2a3a', borderRadius: 4,
    padding: '3px 6px', fontSize: 11,
    fontFamily: 'ui-monospace, monospace',
    width: '100%',
};
