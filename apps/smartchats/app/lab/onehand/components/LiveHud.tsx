'use client';

import React from 'react';

interface Props {
    wpm: number;
    accuracy: number;
    totalTaps: number;
    sessionDurationMs: number;
}

export function LiveHud({ wpm, accuracy, totalTaps, sessionDurationMs }: Props) {
    const mins = Math.floor(sessionDurationMs / 60_000);
    const secs = Math.floor((sessionDurationMs % 60_000) / 1000);
    return (
        <div
            style={{
                display: 'flex',
                gap: 18,
                alignItems: 'center',
                padding: '8px 14px',
                background: 'rgba(255,255,255,0.04)',
                borderRadius: 12,
                fontFamily: 'system-ui, sans-serif',
                color: '#e8e8f0',
                border: '1px solid rgba(255,255,255,0.06)',
                whiteSpace: 'nowrap',
            }}
        >
            <Stat label="WPM" value={wpm.toFixed(0)} hint="rolling 10s" />
            <Sep />
            <Stat label="ACC" value={`${Math.round(accuracy * 100)}%`} hint="last 60" />
            <Sep />
            <Stat label="TAPS" value={String(totalTaps)} />
            <Sep />
            <Stat label="TIME" value={`${mins}:${String(secs).padStart(2, '0')}`} />
        </div>
    );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <div
                style={{
                    fontSize: 9,
                    color: '#9090b0',
                    letterSpacing: '0.18em',
                    textTransform: 'uppercase',
                }}
            >
                {label}
                {hint && (
                    <span style={{ color: '#5e5e7e', marginLeft: 4 }}> {hint}</span>
                )}
            </div>
            <div style={{ fontSize: 22, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: '#f0c060' }}>
                {value}
            </div>
        </div>
    );
}

function Sep() {
    return <div style={{ width: 1, height: 30, background: 'rgba(255,255,255,0.08)' }} />;
}
