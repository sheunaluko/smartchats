'use client';

/**
 * Hand-reach mapper.
 *
 * Step-by-step capture of where each part of the right hand
 * naturally lands on the screen. The output is a structured
 * `HandMap` of every captured point, viewable as a colored overlay
 * and as raw JSON.
 *
 * Steps:
 *   1. Palm rest   — single sustained touch held for 1 second
 *   2. Thumb       — open-ended discrete taps
 *   3. Index       — same
 *   4. Middle      — same
 *   5. Ring        — same
 *   6. Pinky       — same
 *   → Result view  — overlay + JSON
 *
 * Touch radius (Touch.radiusX / radiusY) is captured per point when
 * iOS exposes it — useful for the palm step where the contact area
 * is large and shape-bearing.
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { loadHandMap, saveHandMap } from './lib/storage';
import {
    FINGER_COLORS,
    FINGER_LABELS,
    FINGER_ORDER,
    FingerKey,
    HandMap,
    TouchPoint,
    computeStats,
    emptyHandMap,
} from './lib/types';

type Step = 'intro' | FingerKey | 'result';

const PALM_HOLD_MS = 1000;
const PALM_STABLE_RADIUS_PX = 40;

export default function HandmapApp() {
    const router = useRouter();
    const [step, setStep] = useState<Step>('intro');
    const [map, setMap] = useState<HandMap>(() => loadHandMap() ?? emptyHandMap());
    const [viewport, setViewport] = useState<{ w: number; h: number }>({
        w: typeof window !== 'undefined' ? window.innerWidth : 1024,
        h: typeof window !== 'undefined' ? window.innerHeight : 1366,
    });

    // Keep viewport up to date on orientation/resize.
    useEffect(() => {
        const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
        window.addEventListener('resize', onResize);
        window.addEventListener('orientationchange', onResize);
        return () => {
            window.removeEventListener('resize', onResize);
            window.removeEventListener('orientationchange', onResize);
        };
    }, []);

    const startCapture = useCallback(() => {
        const fresh = emptyHandMap();
        fresh.capturedAt = new Date().toISOString();
        fresh.viewportW = viewport.w;
        fresh.viewportH = viewport.h;
        fresh.orientation = viewport.w > viewport.h ? 'landscape' : 'portrait';
        fresh.devicePixelRatio = window.devicePixelRatio || 1;
        setMap(fresh);
        setStep('palm');
    }, [viewport]);

    const finishStep = useCallback(
        (finger: FingerKey, points: TouchPoint[]) => {
            setMap((m) => ({ ...m, fingers: { ...m.fingers, [finger]: points } }));
            const idx = FINGER_ORDER.indexOf(finger);
            if (idx < FINGER_ORDER.length - 1) {
                setStep(FINGER_ORDER[idx + 1]);
            } else {
                setStep('result');
            }
        },
        [],
    );

    const handleResultSave = useCallback(() => {
        saveHandMap(map);
    }, [map]);

    const handleRestart = useCallback(() => {
        setMap(emptyHandMap());
        setStep('intro');
    }, []);

    if (step === 'intro') {
        return <IntroStep onStart={startCapture} onExit={() => router.push('/lab')} />;
    }
    if (step === 'result') {
        return (
            <ResultView
                map={map}
                onSave={handleResultSave}
                onRestart={handleRestart}
                onExit={() => router.push('/lab')}
            />
        );
    }

    return (
        <CaptureStep
            finger={step}
            previousMap={map}
            onBack={() => {
                const idx = FINGER_ORDER.indexOf(step);
                if (idx === 0) setStep('intro');
                else setStep(FINGER_ORDER[idx - 1]);
            }}
            onComplete={(pts) => finishStep(step, pts)}
        />
    );
}

// ─── Intro ────────────────────────────────────────────────────────────────

function IntroStep({ onStart, onExit }: { onStart: () => void; onExit: () => void }) {
    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'linear-gradient(180deg, #0b0b14 0%, #15151f 100%)',
                color: '#e8e8f0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 40,
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                textAlign: 'center',
            }}
        >
            <Link
                href="/lab"
                onClick={(e) => {
                    e.preventDefault();
                    onExit();
                }}
                style={{
                    position: 'absolute',
                    top: 16,
                    left: 18,
                    color: '#9090b0',
                    textDecoration: 'none',
                    fontSize: 12,
                    letterSpacing: '0.1em',
                    textTransform: 'uppercase',
                }}
            >
                ← Lab
            </Link>
            <div
                style={{
                    fontSize: 11,
                    letterSpacing: '0.2em',
                    color: '#7c7c9e',
                    textTransform: 'uppercase',
                    marginBottom: 12,
                }}
            >
                Handmap
            </div>
            <h1 style={{ fontSize: 34, fontWeight: 600, margin: 0, letterSpacing: '-0.02em', marginBottom: 18 }}>
                Map your right hand
            </h1>
            <p style={{ color: '#c8c8e0', fontSize: 16, lineHeight: 1.55, maxWidth: 540, marginBottom: 32 }}>
                Six guided steps. Each step asks you to touch the screen with a specific part of your right
                hand — first the palm, then each finger. You touch freely; we record every point so the result
                is a real picture of your hand's reach.
            </p>
            <button
                onClick={onStart}
                style={{
                    background: '#f0c060',
                    color: '#1b1b27',
                    border: 'none',
                    fontSize: 16,
                    fontWeight: 600,
                    padding: '14px 28px',
                    borderRadius: 12,
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                }}
            >
                Begin
            </button>
            <div style={{ marginTop: 18, color: '#7c7c9e', fontSize: 13 }}>
                Hold the iPad in whatever orientation feels natural for typing.
            </div>
        </div>
    );
}

// ─── Per-finger capture step ──────────────────────────────────────────────

interface CaptureStepProps {
    finger: FingerKey;
    previousMap: HandMap;
    onBack: () => void;
    onComplete: (points: TouchPoint[]) => void;
}

interface ActiveTouchSample {
    identifier: number;
    x: number;
    y: number;
    radiusX: number;
    radiusY: number;
    startedAtMs: number;
}

function CaptureStep({ finger, previousMap, onBack, onComplete }: CaptureStepProps) {
    const [points, setPoints] = useState<TouchPoint[]>([]);
    const stepStartRef = useRef<number>(performance.now());
    const palmActiveRef = useRef<ActiveTouchSample | null>(null);
    const [palmProgress, setPalmProgress] = useState(0);
    const isPalm = finger === 'palm';

    useEffect(() => {
        stepStartRef.current = performance.now();
        setPoints([]);
        setPalmProgress(0);
        palmActiveRef.current = null;
    }, [finger]);

    const samplePoint = useCallback((t: React.Touch | Touch): TouchPoint => {
        return {
            x: t.clientX,
            y: t.clientY,
            radiusX: (t as any).radiusX ?? 0,
            radiusY: (t as any).radiusY ?? 0,
            tRel: Math.round(performance.now() - stepStartRef.current),
        };
    }, []);

    // ── Palm step: sustained-touch detector ───────────────────────────────
    useEffect(() => {
        if (!isPalm) return;
        let rafId = 0;
        const loop = () => {
            const active = palmActiveRef.current;
            if (active) {
                const held = performance.now() - active.startedAtMs;
                const pct = Math.min(1, held / PALM_HOLD_MS);
                setPalmProgress(pct);
                if (held >= PALM_HOLD_MS) {
                    const finalPoint: TouchPoint = {
                        x: active.x,
                        y: active.y,
                        radiusX: active.radiusX,
                        radiusY: active.radiusY,
                        tRel: Math.round(performance.now() - stepStartRef.current),
                    };
                    onComplete([finalPoint]);
                    return; // stop loop
                }
            } else {
                setPalmProgress(0);
            }
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
    }, [isPalm, onComplete]);

    const handleTouchStart = useCallback(
        (e: React.TouchEvent<HTMLDivElement>) => {
            e.preventDefault();
            if (isPalm) {
                // Take the first touch as the palm sample.
                const t = e.changedTouches[0];
                if (!t) return;
                palmActiveRef.current = {
                    identifier: t.identifier,
                    x: t.clientX,
                    y: t.clientY,
                    radiusX: (t as any).radiusX ?? 0,
                    radiusY: (t as any).radiusY ?? 0,
                    startedAtMs: performance.now(),
                };
            } else {
                // Discrete tap recording.
                const newPoints: TouchPoint[] = [];
                for (let i = 0; i < e.changedTouches.length; i++) {
                    newPoints.push(samplePoint(e.changedTouches[i]));
                }
                if (newPoints.length > 0) setPoints((p) => [...p, ...newPoints]);
            }
        },
        [isPalm, samplePoint],
    );

    const handleTouchMove = useCallback(
        (e: React.TouchEvent<HTMLDivElement>) => {
            e.preventDefault();
            if (isPalm) {
                // Re-anchor on significant move to reset the hold timer.
                const tracked = palmActiveRef.current;
                if (!tracked) return;
                for (let i = 0; i < e.changedTouches.length; i++) {
                    const t = e.changedTouches[i];
                    if (t.identifier !== tracked.identifier) continue;
                    const dx = t.clientX - tracked.x;
                    const dy = t.clientY - tracked.y;
                    if (dx * dx + dy * dy > PALM_STABLE_RADIUS_PX * PALM_STABLE_RADIUS_PX) {
                        tracked.x = t.clientX;
                        tracked.y = t.clientY;
                        tracked.radiusX = (t as any).radiusX ?? 0;
                        tracked.radiusY = (t as any).radiusY ?? 0;
                        tracked.startedAtMs = performance.now(); // reset hold
                    }
                }
            }
        },
        [isPalm],
    );

    const handleTouchEnd = useCallback(
        (e: React.TouchEvent<HTMLDivElement>) => {
            if (!isPalm) return;
            for (let i = 0; i < e.changedTouches.length; i++) {
                if (e.changedTouches[i].identifier === palmActiveRef.current?.identifier) {
                    palmActiveRef.current = null;
                }
            }
        },
        [isPalm],
    );

    const handleDone = useCallback(() => {
        onComplete(points);
    }, [points, onComplete]);

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: '#08080f',
                color: '#e8e8f0',
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                overflow: 'hidden',
            }}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            onTouchCancel={handleTouchEnd}
        >
            <ScatterOverlay map={previousMap} currentFinger={finger} currentPoints={points} />

            {/* Palm progress ring (only shown during palm step) */}
            {isPalm && palmActiveRef.current && (
                <PalmProgressRing
                    x={palmActiveRef.current.x}
                    y={palmActiveRef.current.y}
                    progress={palmProgress}
                />
            )}

            <CaptionCard
                finger={finger}
                count={points.length}
                isPalm={isPalm}
                onBack={onBack}
                onDone={handleDone}
            />
        </div>
    );
}

function PalmProgressRing({ x, y, progress }: { x: number; y: number; progress: number }) {
    const R = 90;
    const C = 2 * Math.PI * R;
    return (
        <svg
            style={{
                position: 'absolute',
                left: x - R - 20,
                top: y - R - 20,
                width: (R + 20) * 2,
                height: (R + 20) * 2,
                pointerEvents: 'none',
            }}
            viewBox={`0 0 ${(R + 20) * 2} ${(R + 20) * 2}`}
        >
            <circle
                cx={R + 20}
                cy={R + 20}
                r={R}
                fill="none"
                stroke="rgba(232, 232, 232, 0.25)"
                strokeWidth={6}
            />
            <circle
                cx={R + 20}
                cy={R + 20}
                r={R}
                fill="none"
                stroke="#ffffff"
                strokeWidth={6}
                strokeLinecap="round"
                strokeDasharray={`${C * progress} ${C}`}
                transform={`rotate(-90 ${R + 20} ${R + 20})`}
            />
        </svg>
    );
}

function CaptionCard({
    finger,
    count,
    isPalm,
    onBack,
    onDone,
}: {
    finger: FingerKey;
    count: number;
    isPalm: boolean;
    onBack: () => void;
    onDone: () => void;
}) {
    const stepIdx = FINGER_ORDER.indexOf(finger);
    const stepNum = stepIdx + 1;
    const total = FINGER_ORDER.length;
    return (
        <div
            style={{
                position: 'absolute',
                top: 26,
                left: 0,
                right: 0,
                display: 'flex',
                justifyContent: 'center',
                pointerEvents: 'none',
                zIndex: 5,
            }}
        >
            <div
                style={{
                    background: 'rgba(20, 20, 32, 0.78)',
                    backdropFilter: 'blur(12px)',
                    WebkitBackdropFilter: 'blur(12px)',
                    padding: '14px 22px',
                    borderRadius: 14,
                    border: '1px solid rgba(255,255,255,0.08)',
                    maxWidth: 640,
                    textAlign: 'center',
                    pointerEvents: 'auto',
                    fontFamily: 'system-ui, sans-serif',
                }}
            >
                <div
                    style={{
                        fontSize: 11,
                        letterSpacing: '0.18em',
                        color: FINGER_COLORS[finger],
                        textTransform: 'uppercase',
                        marginBottom: 6,
                    }}
                >
                    Step {stepNum} of {total} · {FINGER_LABELS[finger]}
                </div>
                <div style={{ color: '#e8e8f0', fontSize: 15, lineHeight: 1.45, marginBottom: 10 }}>
                    {isPalm
                        ? 'Rest your right palm flat on the screen and hold for one second.'
                        : `Touch the screen with just your ${FINGER_LABELS[finger].toLowerCase()} at every natural position you can reach. Hit DONE when finished.`}
                </div>
                {!isPalm && (
                    <div style={{ fontSize: 12, color: '#9090b0', marginBottom: 12 }}>
                        Recorded: <span style={{ color: FINGER_COLORS[finger], fontWeight: 600 }}>{count}</span> points
                    </div>
                )}
                <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                    <button
                        onClick={onBack}
                        style={{
                            background: 'transparent',
                            border: '1px solid rgba(255,255,255,0.15)',
                            color: '#9090b0',
                            fontSize: 11,
                            letterSpacing: '0.12em',
                            textTransform: 'uppercase',
                            padding: '6px 14px',
                            borderRadius: 8,
                            cursor: 'pointer',
                        }}
                    >
                        ← Back
                    </button>
                    {!isPalm && (
                        <button
                            onClick={onDone}
                            disabled={count === 0}
                            style={{
                                background: count === 0 ? 'rgba(255,255,255,0.06)' : FINGER_COLORS[finger],
                                color: count === 0 ? '#7c7c9e' : '#1b1b27',
                                border: 'none',
                                fontSize: 13,
                                fontWeight: 600,
                                letterSpacing: '0.06em',
                                padding: '8px 20px',
                                borderRadius: 8,
                                cursor: count === 0 ? 'not-allowed' : 'pointer',
                            }}
                        >
                            Done — Next →
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}

// ─── Visualization overlay ────────────────────────────────────────────────

function ScatterOverlay({
    map,
    currentFinger,
    currentPoints,
}: {
    map: HandMap;
    currentFinger?: FingerKey;
    currentPoints?: TouchPoint[];
}) {
    return (
        <svg
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
        >
            {FINGER_ORDER.map((f) => {
                if (f === currentFinger) return null; // rendered below from currentPoints
                const points = map.fingers[f];
                if (points.length === 0) return null;
                const color = FINGER_COLORS[f];
                return (
                    <g key={f}>
                        {points.map((p, i) => (
                            <circle
                                key={i}
                                cx={p.x}
                                cy={p.y}
                                r={f === 'palm' ? Math.max(p.radiusX, p.radiusY, 24) : 14}
                                fill={color}
                                fillOpacity={f === 'palm' ? 0.12 : 0.32}
                                stroke={color}
                                strokeOpacity={0.55}
                                strokeWidth={2}
                            />
                        ))}
                    </g>
                );
            })}
            {currentFinger && currentPoints && (
                <g>
                    {currentPoints.map((p, i) => {
                        const color = FINGER_COLORS[currentFinger];
                        return (
                            <circle
                                key={i}
                                cx={p.x}
                                cy={p.y}
                                r={currentFinger === 'palm' ? Math.max(p.radiusX, p.radiusY, 30) : 18}
                                fill={color}
                                fillOpacity={currentFinger === 'palm' ? 0.18 : 0.45}
                                stroke={color}
                                strokeOpacity={0.9}
                                strokeWidth={3}
                            />
                        );
                    })}
                </g>
            )}
        </svg>
    );
}

// ─── Result view ──────────────────────────────────────────────────────────

function ResultView({
    map,
    onSave,
    onRestart,
    onExit,
}: {
    map: HandMap;
    onSave: () => void;
    onRestart: () => void;
    onExit: () => void;
}) {
    const [copied, setCopied] = useState(false);
    const [saved, setSaved] = useState(false);
    const json = useMemo(() => JSON.stringify(map, null, 2), [map]);

    const copy = useCallback(async () => {
        try {
            await navigator.clipboard.writeText(json);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.warn('[handmap] clipboard write failed:', err);
        }
    }, [json]);

    const save = useCallback(() => {
        onSave();
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
    }, [onSave]);

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: '#08080f',
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
                    background: 'rgba(15, 15, 24, 0.9)',
                    backdropFilter: 'blur(8px)',
                    WebkitBackdropFilter: 'blur(8px)',
                    zIndex: 5,
                }}
            >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <Link
                        href="/lab"
                        onClick={(e) => {
                            e.preventDefault();
                            onExit();
                        }}
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
                    <div style={{ fontSize: 15, fontWeight: 600 }}>Handmap result</div>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                    <button onClick={onRestart} style={btnStyle('ghost')}>
                        Restart
                    </button>
                    <button onClick={save} style={btnStyle('ghost')}>
                        {saved ? 'Saved' : 'Save'}
                    </button>
                    <button onClick={copy} style={btnStyle('primary')}>
                        {copied ? 'Copied' : 'Copy JSON'}
                    </button>
                </div>
            </div>

            {/* Map area */}
            <div style={{ position: 'relative', flex: '1 1 50%', minHeight: 0 }}>
                <ScatterOverlay map={map} />
                <Legend />
            </div>

            {/* Stats + JSON */}
            <div
                style={{
                    flex: '1 1 50%',
                    minHeight: 0,
                    display: 'flex',
                    flexDirection: 'column',
                    borderTop: '1px solid rgba(255,255,255,0.06)',
                    background: '#0b0b14',
                }}
            >
                <StatsTable map={map} />
                <pre
                    style={{
                        flex: '1 1 auto',
                        margin: 0,
                        padding: 16,
                        fontSize: 11,
                        fontFamily: '"SF Mono", ui-monospace, Menlo, monospace',
                        color: '#c8c8e0',
                        overflow: 'auto',
                        background: '#06060c',
                        whiteSpace: 'pre',
                    }}
                >
                    {json}
                </pre>
            </div>
        </div>
    );
}

function Legend() {
    return (
        <div
            style={{
                position: 'absolute',
                bottom: 12,
                left: 12,
                background: 'rgba(20, 20, 32, 0.85)',
                border: '1px solid rgba(255,255,255,0.08)',
                borderRadius: 10,
                padding: '8px 12px',
                display: 'flex',
                gap: 14,
                flexWrap: 'wrap',
                pointerEvents: 'none',
                fontFamily: 'system-ui, sans-serif',
                fontSize: 11,
            }}
        >
            {FINGER_ORDER.map((f) => (
                <div key={f} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <div
                        style={{
                            width: 10,
                            height: 10,
                            borderRadius: 5,
                            background: FINGER_COLORS[f],
                            border: '1px solid rgba(255,255,255,0.3)',
                        }}
                    />
                    <span style={{ color: '#c8c8e0' }}>{FINGER_LABELS[f]}</span>
                </div>
            ))}
        </div>
    );
}

function StatsTable({ map }: { map: HandMap }) {
    return (
        <div
            style={{
                padding: '10px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                overflowX: 'auto',
            }}
        >
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                    <tr style={{ color: '#9090b0', textTransform: 'uppercase', letterSpacing: '0.12em' }}>
                        <th style={{ textAlign: 'left', padding: '4px 8px' }}>Finger</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Pts</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Centroid (x,y)</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>BBox (w×h)</th>
                        <th style={{ textAlign: 'right', padding: '4px 8px' }}>Avg radius</th>
                    </tr>
                </thead>
                <tbody>
                    {FINGER_ORDER.map((f) => {
                        const s = computeStats(map.fingers[f]);
                        const bw = s.bbox ? Math.round(s.bbox.maxX - s.bbox.minX) : 0;
                        const bh = s.bbox ? Math.round(s.bbox.maxY - s.bbox.minY) : 0;
                        return (
                            <tr key={f} style={{ borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                                <td style={{ padding: '6px 8px', color: FINGER_COLORS[f], fontWeight: 600 }}>
                                    {FINGER_LABELS[f]}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                                    {s.count}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#c8c8e0' }}>
                                    {s.centroid ? `${Math.round(s.centroid.x)}, ${Math.round(s.centroid.y)}` : '—'}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#c8c8e0' }}>
                                    {s.bbox ? `${bw}×${bh}` : '—'}
                                </td>
                                <td style={{ padding: '6px 8px', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: '#c8c8e0' }}>
                                    {s.avgRadius > 0 ? s.avgRadius.toFixed(1) : '—'}
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
}

function btnStyle(kind: 'primary' | 'ghost'): React.CSSProperties {
    return kind === 'primary'
        ? {
              background: '#f0c060',
              color: '#1b1b27',
              border: 'none',
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.04em',
              cursor: 'pointer',
          }
        : {
              background: 'transparent',
              color: '#c8c8e0',
              border: '1px solid rgba(255,255,255,0.15)',
              padding: '8px 12px',
              borderRadius: 8,
              fontSize: 11,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
          };
}
