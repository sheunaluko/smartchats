'use client';

/**
 * Onehand keyboard top-level client component.
 *
 * On mount, loads the saved calibration from localStorage. If
 * none exists, redirects to /lab/onehand/calibrate. Otherwise
 * builds the QWERTY 3-arc layout projected onto that calibration
 * and hands the keys array to <Keyboard>.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, KeyboardKeyEvent } from './components/Keyboard';
import { LiveHud } from './components/LiveHud';
import { loadCalibration } from './lib/calibration';
import { playBackspace, playClick, primeAudio } from './lib/feedback';
import { buildLayout, normalize } from './lib/layout';
import { rollingAccuracy, rollingNetWpm } from './lib/metrics';
import { closeSession, openSession, pushTap } from './lib/telemetry';
import { loadTunings } from './lib/tunings';
import { FingerName, TapEvent } from './lib/types';

const FINGER_PAN: Record<FingerName, number> = {
    thumb: -0.3,
    index: -0.6,
    middle: -0.2,
    ring: 0.2,
    pinky: 0.6,
};

export default function OnehandApp() {
    const router = useRouter();
    const [calLoaded, setCalLoaded] = useState<'pending' | 'present' | 'missing'>('pending');
    const [text, setText] = useState('');
    const [shift, setShift] = useState(false);
    const [flashKeyId, setFlashKeyId] = useState<string | null>(null);
    const [hudTick, setHudTick] = useState(0);

    const sessionStartRef = useRef<number>(0);
    const sessionSeqRef = useRef(0);
    const lastTapEndRef = useRef<number | null>(null);
    const tapsRef = useRef<TapEvent[]>([]);
    const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const calibrationRef = useRef(loadCalibration());
    const tuningsRef = useRef(loadTunings());

    const built = useMemo(() => {
        const cal = calibrationRef.current;
        return cal ? buildLayout(cal, tuningsRef.current) : null;
    }, []);

    // Calibration gate — redirect to /calibrate if not set up yet.
    useEffect(() => {
        if (calibrationRef.current) {
            setCalLoaded('present');
        } else {
            setCalLoaded('missing');
            router.replace('/lab/onehand/calibrate');
        }
    }, [router]);

    // Session lifecycle.
    useEffect(() => {
        if (calLoaded !== 'present') return;
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
    }, [calLoaded]);

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
        if (taps.length === 0) {
            await closeSession({
                taps: 0,
                chars_committed: 0,
                words: 0,
                duration_ms: performance.now() - sessionStartRef.current,
                wpm_mean: 0,
                wpm_p50: 0,
                wpm_p95: 0,
                accuracy: 1,
                correction_rate: 0,
                median_iki_ms: 0,
                median_dwell_ms: 0,
            });
            return;
        }
        const summary = summarize(taps, performance.now() - sessionStartRef.current);
        await closeSession(summary);
    }, []);

    const handleKey = useCallback(
        (e: KeyboardKeyEvent) => {
            primeAudio();
            const key = e.key;
            const now = performance.now();
            const tRel = now - sessionStartRef.current;
            const interMs = lastTapEndRef.current === null ? 0 : tRel - lastTapEndRef.current;
            lastTapEndRef.current = tRel;

            setFlashKeyId(key.id);
            if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
            flashTimerRef.current = setTimeout(() => setFlashKeyId(null), 90);

            const columnTone = (key.x % 200) / 200 - 0.5;
            const pan = FINGER_PAN[key.finger] ?? 0;
            if (key.kind === 'command' && key.primary === 'BACK') {
                playBackspace();
            } else {
                playClick({ finger: key.finger, columnTone, pan });
            }

            let committed = '';
            let isBackspace = false;
            let intendedKey = e.char;
            let resolvedKey = e.char;

            if (key.kind === 'command') {
                intendedKey = key.primary;
                resolvedKey = key.primary;
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
                committed = shift ? e.char.toUpperCase() : e.char.toLowerCase();
                setText((t) => t + committed);
                if (shift) setShift(false);
            }

            const tapVbNorm = normalize(e.tapVx, e.tapVy);
            const keyCenterNorm = normalize(key.x, key.y);
            const seq = ++sessionSeqRef.current;

            const tap: TapEvent = {
                seq,
                session_seq: seq,
                t_rel_ms: Math.round(tRel),
                finger: key.finger,
                arc: key.arc,
                keyId: key.id,
                intended_key: intendedKey,
                resolved_key: resolvedKey,
                committed_char: committed,
                gesture: e.gesture,
                tap_x_norm: tapVbNorm.x,
                tap_y_norm: tapVbNorm.y,
                key_center_x_norm: keyCenterNorm.x,
                key_center_y_norm: keyCenterNorm.y,
                dwell_ms: Math.round(e.dwellMs),
                inter_ms: Math.round(interMs),
                is_backspace: isBackspace,
                layer: 'base',
            };
            tapsRef.current.push(tap);
            pushTap(tap);
            setHudTick((n) => n + 1);
        },
        [shift],
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

    if (calLoaded === 'pending' || calLoaded === 'missing' || !built) {
        return (
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    background: 'linear-gradient(180deg, #0b0b14 0%, #15151f 100%)',
                    color: '#9090b0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'system-ui, sans-serif',
                    fontSize: 14,
                    letterSpacing: '0.1em',
                }}
            >
                {calLoaded === 'missing' ? 'Redirecting to calibration…' : 'Loading…'}
            </div>
        );
    }

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
            <div
                style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 18px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    flex: '0 0 auto',
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
                    <div style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>Onehand</div>
                    <div style={{ fontSize: 11, color: '#7c7c9e', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                        QWERTY · rev 3
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                    <LiveHud
                        wpm={wpm}
                        accuracy={accuracy}
                        totalTaps={tapsRef.current.length}
                        sessionDurationMs={performance.now() - sessionStartRef.current}
                    />
                    <Link
                        href="/lab/onehand/tune"
                        style={{
                            color: '#1b1b27',
                            background: '#f0c060',
                            textDecoration: 'none',
                            fontSize: 12,
                            fontWeight: 600,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            padding: '8px 12px',
                            borderRadius: 8,
                        }}
                    >
                        Tune
                    </Link>
                    <Link
                        href="/lab/onehand/calibrate"
                        style={{
                            color: '#9090b0',
                            textDecoration: 'none',
                            fontSize: 12,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            padding: '8px 12px',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 8,
                        }}
                    >
                        Recal
                    </Link>
                    <Link
                        href="/lab/onehand/history"
                        style={{
                            color: '#9090b0',
                            textDecoration: 'none',
                            fontSize: 12,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            padding: '8px 12px',
                            border: '1px solid rgba(255,255,255,0.08)',
                            borderRadius: 8,
                        }}
                    >
                        History
                    </Link>
                </div>
            </div>

            <div
                style={{
                    padding: '12px 22px',
                    minHeight: '18%',
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
                        marginBottom: 8,
                    }}
                >
                    Output {shift && <span style={{ color: '#f0c060', marginLeft: 8 }}>⇧ SHIFT</span>}
                </div>
                <div
                    style={{
                        fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
                        fontSize: 22,
                        lineHeight: 1.45,
                        whiteSpace: 'pre-wrap',
                        wordBreak: 'break-word',
                        minHeight: 60,
                    }}
                >
                    {text || (
                        <span style={{ color: '#5e5e7e' }}>
                            QWERTY across three arcs — Q–P + ⌫, A–L + ⏎, Z–M + ⇧. Big SPACE under your thumb.
                            Tap to begin.
                        </span>
                    )}
                    <span
                        style={{
                            display: 'inline-block',
                            width: 12,
                            height: 24,
                            background: '#f0c060',
                            marginLeft: 2,
                            verticalAlign: 'text-bottom',
                            animation: 'onehand-caret 1.1s steps(2, start) infinite',
                        }}
                    />
                </div>
                <style>{`
                    @keyframes onehand-caret {
                        to { visibility: hidden; }
                    }
                `}</style>
            </div>

            <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
                <Keyboard
                    keys={built.keys}
                    palmDeadzone={{ x: built.geometry.palm.x, y: built.geometry.palm.y, r: built.palmDeadzoneRadius }}
                    onKey={handleKey}
                    shift={shift}
                    flashKeyId={flashKeyId}
                />
            </div>
        </div>
    );
}

function summarize(taps: TapEvent[], durationMs: number) {
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
