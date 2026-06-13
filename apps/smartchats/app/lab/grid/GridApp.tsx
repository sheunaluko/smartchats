'use client';

/**
 * Grid keyboard top-level client component.
 *
 * Holds:
 *   - the active layout variant (persisted to localStorage)
 *   - typed text state
 *   - shift state (sticky toggle, clears after next letter)
 *   - in-memory tap log for live WPM/accuracy
 *   - telemetry session lifecycle (one session per mount)
 *
 * Reuses feedback + metrics utilities from the onehand experiment
 * (pure helpers, no shared mutable state).
 */

import Link from 'next/link';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { LiveHud } from '../onehand/components/LiveHud';
import { playBackspace, playClick, primeAudio } from '../onehand/lib/feedback';
import { rollingAccuracy, rollingNetWpm } from '../onehand/lib/metrics';
import { TapEvent } from '../onehand/lib/types';
import { GridKeyboard, GridTapMeta } from './components/GridKeyboard';
import { DEFAULT_LAYOUT_ID, LAYOUTS, LAYOUTS_BY_ID } from './layouts';
import { GridLayout } from './layouts/types';
import {
    GridSessionSummary,
    GridTapRow,
    closeSession,
    openSession,
    pushTap,
} from './lib/telemetry';

const STORAGE_KEY = 'lab_grid_active_variant_v1';

function loadActiveVariant(): string {
    if (typeof window === 'undefined') return DEFAULT_LAYOUT_ID;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (raw && LAYOUTS_BY_ID[raw]) return raw;
    } catch {}
    return DEFAULT_LAYOUT_ID;
}

function saveActiveVariant(id: string): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, id);
    } catch {}
}

export default function GridApp() {
    const [variantId, setVariantId] = useState<string>(DEFAULT_LAYOUT_ID);
    const [text, setText] = useState('');
    const [shift, setShift] = useState(false);
    const [flashKeyId, setFlashKeyId] = useState<string | null>(null);
    const [hudTick, setHudTick] = useState(0);

    const sessionStartRef = useRef<number>(0);
    const seqRef = useRef(0);
    const lastTapEndRef = useRef<number | null>(null);
    const tapsRef = useRef<TapEvent[]>([]);
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const layout: GridLayout = useMemo(() => LAYOUTS_BY_ID[variantId] ?? LAYOUTS[0], [variantId]);

    // Hydrate active variant from localStorage on mount.
    useEffect(() => {
        setVariantId(loadActiveVariant());
    }, []);

    // Session open/close lifecycle.
    useEffect(() => {
        sessionStartRef.current = performance.now();
        let cancelled = false;
        (async () => {
            const vw = typeof window !== 'undefined' ? window.innerWidth : 1180;
            const vh = typeof window !== 'undefined' ? window.innerHeight : 820;
            await openSession({ viewportW: vw, viewportH: vh });
            if (cancelled) void closeAndSummarize();
        })();
        return () => {
            cancelled = true;
            void closeAndSummarize();
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const id = setInterval(() => setHudTick((n) => n + 1), 1000);
        return () => clearInterval(id);
    }, []);

    useEffect(() => {
        const onVisibility = () => {
            if (document.hidden) void closeAndSummarize();
        };
        document.addEventListener('visibilitychange', onVisibility);
        return () => document.removeEventListener('visibilitychange', onVisibility);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const closeAndSummarize = useCallback(async () => {
        const taps = tapsRef.current;
        const dur = performance.now() - sessionStartRef.current;
        if (taps.length === 0) {
            await closeSession(emptySummary(dur));
            return;
        }
        await closeSession(summarize(taps, dur));
    }, []);

    const handleKey = useCallback(
        (e: GridTapMeta) => {
            primeAudio();
            const key = e.key;
            const now = performance.now();
            const tRel = now - sessionStartRef.current;
            const interMs = lastTapEndRef.current === null ? 0 : tRel - lastTapEndRef.current;
            lastTapEndRef.current = tRel;

            setFlashKeyId(key.id);
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => setFlashKeyId(null), 90);

            // Audio feedback. Pan derived from horizontal position so the
            // ear can hear which side of the keyboard you hit.
            const xCenter = key.leftPct + key.widthPct / 2;
            const pan = (xCenter / 100) * 2 - 1; // map [0..100] to [-1..1]
            if (key.kind === 'command' && key.primary === 'BACK') {
                playBackspace();
            } else {
                // Use a coarse "finger" derived from horizontal position
                // (left = index, right = pinky) only as a timbre cue.
                const finger = xCenter < 25 ? 'index' : xCenter < 50 ? 'middle' : xCenter < 75 ? 'ring' : 'pinky';
                playClick({ finger, columnTone: (xCenter / 100) * 2 - 1, pan: pan * 0.6 });
            }

            // Resolve action.
            let committed = '';
            let isBackspace = false;

            if (key.kind === 'command') {
                switch (key.primary) {
                    case 'SPACE':
                        committed = ' ';
                        setText((t) => t + ' ');
                        if (shift) setShift(false);
                        break;
                    case 'BACK':
                        isBackspace = true;
                        setText((t) => t.slice(0, -1));
                        break;
                    case 'SHIFT':
                        setShift((s) => !s);
                        break;
                    case 'ENTER':
                        committed = '\n';
                        setText((t) => t + '\n');
                        break;
                }
            } else {
                committed = shift ? key.primary.toUpperCase() : key.primary.toLowerCase();
                setText((t) => t + committed);
                if (shift) setShift(false);
            }

            // In-memory tap for HUD math.
            const seq = ++seqRef.current;
            const memTap: TapEvent = {
                seq,
                session_seq: seq,
                t_rel_ms: Math.round(tRel),
                finger: 'index',
                arc: 'outer',
                keyId: key.id,
                intended_key: key.primary,
                resolved_key: key.primary,
                committed_char: committed,
                gesture: 'tap',
                tap_x_norm: e.xNorm,
                tap_y_norm: e.yNorm,
                key_center_x_norm: (key.leftPct + key.widthPct / 2) / 100,
                key_center_y_norm: (key.topPct + key.heightPct / 2) / 100,
                dwell_ms: Math.round(e.dwellMs),
                inter_ms: Math.round(interMs),
                is_backspace: isBackspace,
                layer: 'base',
            };
            tapsRef.current.push(memTap);

            // Telemetry write.
            const row: GridTapRow = {
                seq,
                t_rel_ms: Math.round(tRel),
                variant: variantId,
                key_id: key.id,
                primary: key.primary,
                kind: key.kind,
                committed_char: committed,
                is_backspace: isBackspace,
                tap_x_norm: e.xNorm,
                tap_y_norm: e.yNorm,
                key_left_pct: key.leftPct,
                key_top_pct: key.topPct,
                key_width_pct: key.widthPct,
                key_height_pct: key.heightPct,
                dwell_ms: Math.round(e.dwellMs),
                inter_ms: Math.round(interMs),
            };
            pushTap(row);

            setHudTick((n) => n + 1);
        },
        [shift, variantId],
    );

    const wpm = useMemo(
        () => rollingNetWpm(tapsRef.current, performance.now() - sessionStartRef.current),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [hudTick],
    );
    const accuracy = useMemo(
        () => rollingAccuracy(tapsRef.current),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [hudTick],
    );

    const switchVariant = (id: string) => {
        setVariantId(id);
        saveActiveVariant(id);
    };

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'linear-gradient(180deg, #0b0b14 0%, #15151f 100%)',
                color: '#e8e8f0',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
            }}
        >
            {/* Header */}
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 16px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    flex: '0 0 auto',
                    flexWrap: 'wrap',
                    gap: 8,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Link
                        href="/lab"
                        style={{
                            color: '#9090b0',
                            textDecoration: 'none',
                            fontSize: 12,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                        }}
                    >
                        ← Lab
                    </Link>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>Grid</div>
                    <div
                        style={{
                            fontSize: 10,
                            color: '#7c7c9e',
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                        }}
                    >
                        {layout.name}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <LiveHud
                        wpm={wpm}
                        accuracy={accuracy}
                        totalTaps={tapsRef.current.length}
                        sessionDurationMs={performance.now() - sessionStartRef.current}
                    />
                    <Link
                        href="/lab/onehand/history"
                        style={{
                            color: '#9090b0',
                            textDecoration: 'none',
                            fontSize: 11,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            padding: '7px 11px',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 8,
                        }}
                    >
                        History
                    </Link>
                </div>
            </div>

            {/* Variant switcher */}
            <div
                style={{
                    display: 'flex',
                    gap: 6,
                    padding: '8px 12px',
                    borderBottom: '1px solid rgba(255,255,255,0.05)',
                    flex: '0 0 auto',
                    overflowX: 'auto',
                }}
            >
                {LAYOUTS.map((l, i) => {
                    const active = l.id === variantId;
                    return (
                        <button
                            key={l.id}
                            onClick={() => switchVariant(l.id)}
                            style={{
                                flex: '1 1 auto',
                                minWidth: 80,
                                background: active ? '#f0c060' : 'rgba(255,255,255,0.04)',
                                color: active ? '#1b1b27' : '#c8c8e0',
                                border: '1px solid rgba(255,255,255,0.07)',
                                padding: '8px 10px',
                                fontSize: 12,
                                fontWeight: active ? 700 : 500,
                                borderRadius: 8,
                                cursor: 'pointer',
                                letterSpacing: '0.04em',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                gap: 2,
                            }}
                        >
                            <span style={{ fontSize: 10, opacity: 0.7 }}>
                                {String.fromCharCode(65 + i)}
                            </span>
                            <span>{l.name}</span>
                        </button>
                    );
                })}
            </div>

            {/* Readout */}
            <div
                style={{
                    padding: '10px 18px',
                    minHeight: 90,
                    maxHeight: '24%',
                    overflow: 'auto',
                    borderBottom: '1px solid rgba(255,255,255,0.04)',
                    flex: '0 0 auto',
                }}
            >
                <div
                    style={{
                        fontSize: 10,
                        color: '#7c7c9e',
                        letterSpacing: '0.18em',
                        textTransform: 'uppercase',
                        marginBottom: 6,
                    }}
                >
                    Output {shift && <span style={{ color: '#f0c060', marginLeft: 8 }}>⇧ SHIFT</span>}
                </div>
                <div
                    style={{
                        fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
                        fontSize: 20,
                        lineHeight: 1.45,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        minHeight: 40,
                    }}
                >
                    {text || (
                        <span style={{ color: '#5e5e7e' }}>
                            {layout.blurb} Tap to begin.
                        </span>
                    )}
                    <span
                        style={{
                            display: 'inline-block',
                            width: 10,
                            height: 22,
                            background: '#f0c060',
                            marginLeft: 2,
                            verticalAlign: 'text-bottom',
                            animation: 'grid-caret 1.1s steps(2, start) infinite',
                        }}
                    />
                </div>
                <style>{`@keyframes grid-caret { to { visibility: hidden; } }`}</style>
            </div>

            {/* Keyboard fills the remainder */}
            <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
                <GridKeyboard
                    layout={layout}
                    onKey={handleKey}
                    shift={shift}
                    flashKeyId={flashKeyId}
                />
            </div>
        </div>
    );
}

// ─── Summary helpers ──────────────────────────────────────────────────────

function emptySummary(durationMs: number): GridSessionSummary {
    return {
        taps: 0,
        chars_committed: 0,
        words: 0,
        duration_ms: durationMs,
        wpm_mean: 0,
        wpm_p50: 0,
        wpm_p95: 0,
        accuracy: 1,
        correction_rate: 0,
        median_iki_ms: 0,
        median_dwell_ms: 0,
    };
}

function summarize(taps: TapEvent[], durationMs: number): GridSessionSummary {
    const charTaps = taps.filter((t) => t.committed_char && !t.is_backspace);
    const backs = taps.filter((t) => t.is_backspace);
    const intervals = taps.map((t) => t.inter_ms).filter((m) => m > 0);
    const dwells = taps.map((t) => t.dwell_ms).filter((m) => m > 0);

    const minutes = Math.max(durationMs, 1) / 60_000;
    const netChars = Math.max(0, charTaps.length - 5 * backs.length);
    const wpmMean = minutes > 0 ? netChars / 5 / minutes : 0;

    return {
        taps: taps.length,
        chars_committed: charTaps.length,
        words: charTaps.filter((t) => t.committed_char === ' ' || t.committed_char === '\n').length,
        duration_ms: Math.round(durationMs),
        wpm_mean: round2(wpmMean),
        wpm_p50: round2(percentileWpm(taps, 50)),
        wpm_p95: round2(percentileWpm(taps, 95)),
        accuracy: round2(charTaps.length === 0 ? 1 : 1 - backs.length / Math.max(1, charTaps.length)),
        correction_rate: round2(backs.length / Math.max(1, taps.length)),
        median_iki_ms: Math.round(median(intervals)),
        median_dwell_ms: Math.round(median(dwells)),
    };
}

function median(xs: number[]): number {
    if (xs.length === 0) return 0;
    const s = [...xs].sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function percentileWpm(taps: TapEvent[], p: number): number {
    const words: number[] = [];
    let buf: TapEvent[] = [];
    for (const t of taps) {
        const flush = !t.committed_char || t.committed_char === ' ' || t.committed_char === '\n' || t.is_backspace;
        if (flush) {
            if (buf.length >= 2) words.push(wordWpm(buf));
            buf = [];
        } else {
            buf.push(t);
        }
    }
    if (buf.length >= 2) words.push(wordWpm(buf));
    if (words.length === 0) return 0;
    const sorted = words.sort((a, b) => a - b);
    const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
    return sorted[idx];
}

function wordWpm(buf: TapEvent[]): number {
    const dur = buf[buf.length - 1].t_rel_ms - buf[0].t_rel_ms;
    if (dur <= 0) return 0;
    const minutes = dur / 60_000;
    return buf.length / 5 / minutes;
}

function round2(n: number): number {
    return Math.round(n * 100) / 100;
}
