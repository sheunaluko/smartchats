'use client';

/**
 * AudioContextInspector — live readout of a private AudioContext's state,
 * baseLatency, outputLatency, sample rate, and current time. Polls at
 * ~2Hz. Useful for confirming the browser audio output floor (baseLatency)
 * the user's device gives us — this sets a hard floor on perceived
 * audio latency, independent of our scheduling lookahead.
 *
 * Owns its own context so the readings reflect the underlying
 * device/browser combo rather than tivi's queue state. (tivi's
 * `tts_playback_timing` event already captures its own ctx state per
 * utterance.)
 */

import React, { useEffect, useState } from 'react';

type Snapshot = {
    state: AudioContextState;
    sampleRate: number;
    baseLatencyMs: number;
    outputLatencyMs: number | null;
    currentTimeMs: number;
};

export function AudioContextInspector() {
    const [snap, setSnap] = useState<Snapshot | null>(null);
    const [ctx, setCtx] = useState<AudioContext | null>(null);

    useEffect(() => {
        const audioCtx = new AudioContext();
        setCtx(audioCtx);
        return () => {
            audioCtx.close().catch(() => {});
        };
    }, []);

    useEffect(() => {
        if (!ctx) return;
        const tick = () => {
            setSnap({
                state: ctx.state,
                sampleRate: ctx.sampleRate,
                baseLatencyMs: (ctx.baseLatency ?? 0) * 1000,
                outputLatencyMs: typeof (ctx as any).outputLatency === 'number'
                    ? (ctx as any).outputLatency * 1000
                    : null,
                currentTimeMs: ctx.currentTime * 1000,
            });
        };
        tick();
        const id = window.setInterval(tick, 500);
        return () => window.clearInterval(id);
    }, [ctx]);

    async function resume() {
        if (ctx?.state === 'suspended') await ctx.resume();
    }
    async function suspend() {
        if (ctx?.state === 'running') await ctx.suspend();
    }

    return (
        <div
            style={{
                color: '#dcdcdc', fontFamily: 'ui-monospace, monospace', fontSize: 11,
                background: '#11111a', borderRadius: 8, padding: '10px 12px',
                border: '1px solid #2a2a3a',
            }}
        >
            <div style={{ color: '#a0a0c0', marginBottom: 6 }}>audio context (inspector — separate from tts)</div>
            {snap ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', columnGap: 12, rowGap: 2 }}>
                    <span style={{ color: '#666' }}>state</span>
                    <span style={{ color: snap.state === 'running' ? '#88dd88' : '#ffcc66' }}>{snap.state}</span>
                    <span style={{ color: '#666' }}>sampleRate</span>
                    <span>{snap.sampleRate} Hz</span>
                    <span style={{ color: '#666' }}>baseLatency</span>
                    <span>{snap.baseLatencyMs.toFixed(2)} ms</span>
                    <span style={{ color: '#666' }}>outputLatency</span>
                    <span>{snap.outputLatencyMs === null ? 'n/a' : `${snap.outputLatencyMs.toFixed(2)} ms`}</span>
                    <span style={{ color: '#666' }}>currentTime</span>
                    <span>{(snap.currentTimeMs / 1000).toFixed(2)} s</span>
                </div>
            ) : (
                <div style={{ color: '#666' }}>initializing…</div>
            )}
            <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={resume} style={btn}>resume</button>
                <button onClick={suspend} style={btn}>suspend</button>
            </div>
        </div>
    );
}

const btn: React.CSSProperties = {
    background: '#222236', color: '#c0c0e0',
    border: '1px solid #2a2a3a', borderRadius: 4,
    padding: '3px 10px', fontSize: 11, cursor: 'pointer',
    fontFamily: 'ui-monospace, monospace',
};
