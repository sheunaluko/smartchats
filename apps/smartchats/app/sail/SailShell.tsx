'use client';

/**
 * SailShell — SmartChats Audio Intelligence Lab shell.
 *
 * Maintainer-facing layout for /sail. Wires into the same app3 pipeline
 * as /app (same agent, same orchestrator, same insights events) but
 * renders a focused audio-diagnosis surface:
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  header — sail title · voice toggle · cancel speech         │
 *   ├──────────────────────────────────────┬──────────────────────┤
 *   │                                      │                      │
 *   │  Spectrogram (microphone)            │  EventTracePanel     │
 *   │                                      │  (audio events live) │
 *   ├──────────────────────────────────────┤                      │
 *   │  AudioContextInspector               │                      │
 *   │                                      │                      │
 *   └──────────────────────────────────────┴──────────────────────┘
 *
 * On mount: adds session tag 'sail' so `bin/find-sessions --tag sail`
 * can isolate /sail sessions for triage.
 *
 * Phase-1 scope: just enough to start a voice session and watch the
 * tts_playback_timing events flow. Subsequent phases will add TTS-output
 * spectrogram, rust-WASM custom analyzers, R3F 3D viz, auto-calibration.
 */

import React, { useEffect } from 'react';
import type { ShellProps } from '../../core/types/shell';
import { useInsights } from '@/context/InsightsContext';
import { SpectrogramPanel } from './components/SpectrogramPanel';
import { EventTracePanel } from './components/EventTracePanel';
import { AudioContextInspector } from './components/AudioContextInspector';
import { LabPoc } from './components/LabPoc';
import { ExperimentControls } from './components/ExperimentControls';
import { ExperimentRunner } from './components/ExperimentRunner';
import { Collapsible } from './components/Collapsible';

export function SailShell({ voice, actions }: ShellProps) {
    const { client } = useInsights();

    // Tag the session 'sail' once on mount so it's queryable separately
    // from /app sessions even though they share app_name='smartchats'.
    useEffect(() => {
        if (!client) return;
        try {
            client.addSessionTags?.(['sail']);
        } catch { /* swallow — tagging is best-effort */ }
    }, [client]);

    return (
        <div
            style={{
                position: 'fixed', inset: 0,
                background: '#06060c',
                color: '#dcdcdc',
                fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                overflow: 'hidden',
                display: 'flex', flexDirection: 'column',
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '10px 18px',
                    borderBottom: '1px solid #1a1a28',
                    background: '#0c0c14',
                }}
            >
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                    <span style={{ fontSize: 16, fontWeight: 600, letterSpacing: 0.4 }}>
                        SAIL
                    </span>
                    <span style={{ fontSize: 11, color: '#666' }}>
                        smartchats audio intelligence lab · session-tagged 'sail'
                    </span>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <span
                        style={{
                            fontSize: 11, color: '#a0a0c0',
                            padding: '4px 10px', borderRadius: 12,
                            background: voice.started ? '#1d3a1d' : '#1a1a28',
                            border: `1px solid ${voice.started ? '#4a7a4a' : '#2a2a3a'}`,
                        }}
                    >
                        {voice.started ? `● ${voice.voiceStatus}` : 'idle'}
                    </span>
                    {voice.isSpeaking && (
                        <button onClick={actions.onCancelSpeech} style={btnDanger}>
                            cancel speech
                        </button>
                    )}
                    <button
                        onClick={actions.onStartStop}
                        style={voice.started ? btnDanger : btnPrimary}
                    >
                        {voice.started ? 'stop' : 'start voice'}
                    </button>
                </div>
            </div>

            {/* Main layout */}
            <div
                style={{
                    flex: 1, display: 'grid', gap: 12, padding: 12,
                    gridTemplateColumns: 'minmax(0, 1fr) 380px',
                    gridTemplateRows: 'minmax(0, 1fr)',
                    overflow: 'hidden',
                }}
            >
                {/* Left column: spectrogram (fills available space) + collapsible
                    diagnostics + always-on experiment controls. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12, overflow: 'hidden', minHeight: 0 }}>
                    <div style={{ flex: 1, minHeight: 200 }}>
                        <SpectrogramPanel label="Microphone" />
                    </div>
                    <ExperimentControls />
                    <ExperimentRunner />
                    <Collapsible title="audio context inspector"><AudioContextInspector /></Collapsible>
                    <Collapsible title="lab poc"><LabPoc /></Collapsible>
                </div>

                {/* Right column: event trace */}
                <div style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                    <EventTracePanel />
                </div>
            </div>

            {/* Footer hint */}
            <div
                style={{
                    padding: '6px 18px', fontSize: 10, color: '#555',
                    borderTop: '1px solid #1a1a28',
                    fontFamily: 'ui-monospace, monospace',
                }}
            >
                tap "start voice", say something, watch tts_playback_timing events.
                first_chunk.snapped_forward=true ⇒ scheduling fell behind on chunk 0.
            </div>
        </div>
    );
}

const btnPrimary: React.CSSProperties = {
    background: '#3a5dff', color: '#fff',
    border: 'none', borderRadius: 6,
    padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
};
const btnDanger: React.CSSProperties = {
    background: '#aa3344', color: '#fff',
    border: 'none', borderRadius: 6,
    padding: '6px 14px', fontSize: 12, fontWeight: 500, cursor: 'pointer',
};
