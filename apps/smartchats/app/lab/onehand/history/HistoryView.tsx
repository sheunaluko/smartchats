'use client';

import Link from 'next/link';
import React, { useEffect, useState } from 'react';
import { getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';

interface WpmRow {
    local_date: string;
    wpm_mean: number;
    wpm_p95: number;
    taps: number;
    sessions: number;
    duration_ms: number;
}

interface KeyStatRow {
    resolved_key: string;
    taps: number;
    dwell_mean: number;
    inter_mean: number;
    backspaces: number;
}

export default function HistoryView() {
    const [wpm, setWpm] = useState<WpmRow[] | null>(null);
    const [keys, setKeys] = useState<KeyStatRow[] | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const since = new Date(Date.now() - 7 * 86_400_000).toISOString().slice(0, 10);
                const since30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
                const [wpmRes, keysRes] = await Promise.all([
                    getBackend().data.query(queries.getOnehandWpmByDate({ since_local_date: since30 })),
                    getBackend().data.query(queries.getOnehandKeyStats({ since_local_date: since })),
                ]);
                if (cancelled) return;
                setWpm((wpmRes as any).rows.reverse());
                setKeys((keysRes as any).rows);
            } catch (err: any) {
                if (cancelled) return;
                setError(err?.message ?? String(err));
            }
        })();
        return () => {
            cancelled = true;
        };
    }, []);

    return (
        <div
            style={{
                minHeight: '100vh',
                background: 'linear-gradient(180deg, #0b0b14 0%, #15151f 100%)',
                color: '#e8e8f0',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                padding: '24px 28px 64px',
            }}
        >
            <div style={{ maxWidth: 960, margin: '0 auto' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 24 }}>
                    <div>
                        <Link
                            href="/lab/onehand"
                            style={{
                                color: '#9090b0',
                                textDecoration: 'none',
                                fontSize: 12,
                                letterSpacing: '0.1em',
                                textTransform: 'uppercase',
                            }}
                        >
                            ← Onehand
                        </Link>
                        <h1 style={{ fontSize: 28, fontWeight: 600, margin: '8px 0 0', letterSpacing: '-0.02em' }}>
                            History
                        </h1>
                    </div>
                </div>

                {error && (
                    <div
                        style={{
                            padding: 16,
                            background: 'rgba(240, 90, 90, 0.08)',
                            border: '1px solid rgba(240, 90, 90, 0.25)',
                            borderRadius: 10,
                            color: '#f0a0a0',
                            marginBottom: 24,
                            fontSize: 14,
                        }}
                    >
                        Couldn’t load history yet: {error}
                        <div style={{ marginTop: 8, color: '#c89090', fontSize: 12 }}>
                            If you just installed onehand, the schema may not be applied. Restart the local
                            server and try again.
                        </div>
                    </div>
                )}

                <Section title="WPM — last 30 days">
                    {wpm === null && !error && <Skeleton />}
                    {wpm && wpm.length === 0 && <Empty hint="Type for a bit on /lab/onehand to populate." />}
                    {wpm && wpm.length > 0 && <WpmChart rows={wpm} />}
                </Section>

                <Section title="Key stats — last 7 days">
                    {keys === null && !error && <Skeleton />}
                    {keys && keys.length === 0 && <Empty hint="No taps yet." />}
                    {keys && keys.length > 0 && <KeyTable rows={keys} />}
                </Section>
            </div>
        </div>
    );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
    return (
        <div style={{ marginBottom: 32 }}>
            <div
                style={{
                    fontSize: 10,
                    color: '#7c7c9e',
                    letterSpacing: '0.2em',
                    textTransform: 'uppercase',
                    marginBottom: 10,
                }}
            >
                {title}
            </div>
            <div
                style={{
                    background: 'rgba(255,255,255,0.025)',
                    border: '1px solid rgba(255,255,255,0.06)',
                    borderRadius: 12,
                    padding: 20,
                }}
            >
                {children}
            </div>
        </div>
    );
}

function Skeleton() {
    return <div style={{ height: 80, color: '#5e5e7e', fontSize: 13 }}>Loading…</div>;
}

function Empty({ hint }: { hint: string }) {
    return <div style={{ color: '#7c7c9e', fontSize: 14, padding: '12px 0' }}>{hint}</div>;
}

function WpmChart({ rows }: { rows: WpmRow[] }) {
    const max = Math.max(1, ...rows.map((r) => r.wpm_p95));
    const W = 920;
    const H = 200;
    const pad = 28;
    const step = (W - pad * 2) / Math.max(1, rows.length - 1);
    const points = rows.map((r, i) => `${pad + i * step},${pad + ((max - r.wpm_mean) / max) * (H - pad * 2)}`).join(' ');
    return (
        <div>
            <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ display: 'block' }}>
                <line x1={pad} y1={H - pad} x2={W - pad} y2={H - pad} stroke="rgba(255,255,255,0.15)" />
                <line x1={pad} y1={pad} x2={pad} y2={H - pad} stroke="rgba(255,255,255,0.15)" />
                <polyline fill="none" stroke="#f0c060" strokeWidth={2} points={points} />
                {rows.map((r, i) => (
                    <circle
                        key={r.local_date}
                        cx={pad + i * step}
                        cy={pad + ((max - r.wpm_mean) / max) * (H - pad * 2)}
                        r={3}
                        fill="#f0c060"
                    >
                        <title>{`${r.local_date} · wpm ${r.wpm_mean.toFixed(1)} · p95 ${r.wpm_p95.toFixed(1)}`}</title>
                    </circle>
                ))}
            </svg>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 4, fontSize: 11, color: '#7c7c9e' }}>
                <span>{rows[0]?.local_date}</span>
                <span>peak p95: {max.toFixed(1)} WPM</span>
                <span>{rows[rows.length - 1]?.local_date}</span>
            </div>
        </div>
    );
}

function KeyTable({ rows }: { rows: KeyStatRow[] }) {
    return (
        <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                    <tr style={{ color: '#9090b0', textAlign: 'left', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.12em' }}>
                        <th style={{ padding: '6px 8px' }}>Key</th>
                        <th style={{ padding: '6px 8px' }}>Taps</th>
                        <th style={{ padding: '6px 8px' }}>Dwell ms</th>
                        <th style={{ padding: '6px 8px' }}>Inter ms</th>
                        <th style={{ padding: '6px 8px' }}>Backspaces</th>
                    </tr>
                </thead>
                <tbody>
                    {rows.slice(0, 30).map((r) => (
                        <tr key={r.resolved_key} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <td style={{ padding: '8px', fontWeight: 600, color: '#f0c060' }}>{r.resolved_key}</td>
                            <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums' }}>{r.taps}</td>
                            <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums' }}>{r.dwell_mean.toFixed(0)}</td>
                            <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums' }}>{r.inter_mean.toFixed(0)}</td>
                            <td style={{ padding: '8px', fontVariantNumeric: 'tabular-nums' }}>{r.backspaces}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
