'use client';

/**
 * Hand-geometry calibration flow.
 *
 *   1. Palm rest  — single tap
 *   2. Fingers    — multi-touch capture, 4 fingertips held still ~1s
 *   3. Thumb rest — single tap
 *   4. Preview    — renders the calibrated keyboard for confirmation
 *
 * All captures are stored in viewBox coords (1600 × 1000) so the
 * derived layout slots into the same SVG the keyboard renders into.
 *
 * Multi-touch detection ignores any touch inside the palm dead zone
 * (so the heel of the hand resting on the screen doesn't count as a
 * fifth fingertip).
 */

import { useRouter } from 'next/navigation';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Keyboard } from '../components/Keyboard';
import {
    buildCalibration,
    Point,
    saveCalibration,
} from '../lib/calibration';
import { buildLayout } from '../lib/layout';
import { VIEW_HEIGHT, VIEW_WIDTH } from '../lib/types';
import Link from 'next/link';

type Step = 'intro' | 'palm' | 'fingers' | 'thumb' | 'preview';

const FINGER_HOLD_MS = 1100;
const FINGER_STABLE_RADIUS = 28; // viewBox units of allowed jitter

export default function CalibrateView() {
    const router = useRouter();
    const [step, setStep] = useState<Step>('intro');
    const [palm, setPalm] = useState<Point | null>(null);
    const [fingers, setFingers] = useState<Point[] | null>(null);
    const [thumb, setThumb] = useState<Point | null>(null);

    const handleFinish = useCallback(() => {
        if (!palm || !fingers || !thumb) return;
        try {
            const cal = buildCalibration({ palm, fingers, thumb });
            saveCalibration(cal);
            router.replace('/lab/onehand');
        } catch (err) {
            console.error('[onehand] calibration build failed:', err);
        }
    }, [palm, fingers, thumb, router]);

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'linear-gradient(180deg, #0b0b14 0%, #15151f 100%)',
                color: '#e8e8f0',
                fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                overflow: 'hidden',
                touchAction: 'none',
            }}
        >
            <StepHeader step={step} onCancel={() => router.push('/lab')} />

            {step === 'intro' && <IntroStep onStart={() => setStep('palm')} />}
            {step === 'palm' && (
                <TapTarget
                    instruction="Step 1 of 3 — palm rest"
                    detail="Rest your whole right palm on the iPad in your natural typing position, then tap once where your palm sits."
                    onCapture={(p) => {
                        setPalm(p);
                        setStep('fingers');
                    }}
                />
            )}
            {step === 'fingers' && palm && (
                <FingersStep
                    palm={palm}
                    onCapture={(pts) => {
                        setFingers(pts);
                        setStep('thumb');
                    }}
                    onBack={() => setStep('palm')}
                />
            )}
            {step === 'thumb' && palm && (
                <TapTarget
                    instruction="Step 3 of 3 — thumb rest"
                    detail="Relax your hand. Tap where your right thumb naturally sits when it's not reaching for a key."
                    onCapture={(p) => {
                        setThumb(p);
                        setStep('preview');
                    }}
                    onBack={() => setStep('fingers')}
                />
            )}
            {step === 'preview' && palm && fingers && thumb && (
                <PreviewStep
                    palm={palm}
                    fingers={fingers}
                    thumb={thumb}
                    onAccept={handleFinish}
                    onRedo={() => {
                        setPalm(null);
                        setFingers(null);
                        setThumb(null);
                        setStep('palm');
                    }}
                />
            )}
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────

function StepHeader({ step, onCancel }: { step: Step; onCancel: () => void }) {
    const stepNum: Record<Step, number> = { intro: 0, palm: 1, fingers: 2, thumb: 3, preview: 4 };
    const n = stepNum[step];
    return (
        <div
            style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 18px',
                zIndex: 5,
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
                <div style={{ fontSize: 14, fontWeight: 600 }}>Onehand · Calibrate</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {[1, 2, 3, 4].map((i) => (
                    <div
                        key={i}
                        style={{
                            width: 28,
                            height: 4,
                            borderRadius: 2,
                            background: i <= n ? '#f0c060' : 'rgba(255,255,255,0.1)',
                        }}
                    />
                ))}
                {step !== 'preview' && (
                    <button
                        onClick={onCancel}
                        style={{
                            marginLeft: 14,
                            background: 'transparent',
                            border: 'none',
                            color: '#9090b0',
                            fontSize: 12,
                            letterSpacing: '0.1em',
                            textTransform: 'uppercase',
                            cursor: 'pointer',
                        }}
                    >
                        Cancel
                    </button>
                )}
            </div>
        </div>
    );
}

function IntroStep({ onStart }: { onStart: () => void }) {
    return (
        <div
            style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 40,
                textAlign: 'center',
            }}
        >
            <div
                style={{
                    fontSize: 11,
                    letterSpacing: '0.2em',
                    color: '#7c7c9e',
                    textTransform: 'uppercase',
                    marginBottom: 12,
                }}
            >
                Welcome
            </div>
            <h1 style={{ fontSize: 34, fontWeight: 600, margin: 0, letterSpacing: '-0.02em', marginBottom: 18 }}>
                Let’s fit the keyboard to your hand
            </h1>
            <p style={{ color: '#c8c8e0', fontSize: 16, lineHeight: 1.55, maxWidth: 540, marginBottom: 32 }}>
                In three quick steps, you’ll show me where your palm rests, where your fingers naturally land,
                and where your thumb sits. I’ll project the QWERTY layout onto those exact points so every key
                is comfortably in reach.
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
                Start calibration
            </button>
            <div style={{ marginTop: 18, color: '#7c7c9e', fontSize: 13 }}>
                Hold the iPad in landscape with your right palm in the lower-right of the screen.
            </div>
        </div>
    );
}

// ── Tap target step (palm / thumb) ───────────────────────────────────────

interface TapTargetProps {
    instruction: string;
    detail: string;
    onCapture: (p: Point) => void;
    onBack?: () => void;
}

function TapTarget({ instruction, detail, onCapture, onBack }: TapTargetProps) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const [preview, setPreview] = useState<Point | null>(null);

    const toViewBox = useCallback((clientX: number, clientY: number): Point | null => {
        const svg = svgRef.current;
        if (!svg) return null;
        const ctm = svg.getScreenCTM();
        if (!ctm) return null;
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const svgPt = pt.matrixTransform(ctm.inverse());
        return { x: svgPt.x, y: svgPt.y };
    }, []);

    const handleTouchStart = useCallback(
        (e: React.TouchEvent<SVGSVGElement>) => {
            e.preventDefault();
            const t = e.changedTouches[0];
            if (!t) return;
            const vb = toViewBox(t.clientX, t.clientY);
            if (!vb) return;
            setPreview(vb);
        },
        [toViewBox],
    );

    const handleTouchEnd = useCallback(
        (e: React.TouchEvent<SVGSVGElement>) => {
            e.preventDefault();
            if (preview) {
                onCapture(preview);
                setPreview(null);
            }
        },
        [preview, onCapture],
    );

    return (
        <div style={{ position: 'absolute', inset: 0 }}>
            <svg
                ref={svgRef}
                viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                preserveAspectRatio="xMidYMid meet"
                style={{
                    width: '100%',
                    height: '100%',
                    touchAction: 'none',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    display: 'block',
                }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
            >
                {preview && (
                    <>
                        <circle
                            cx={preview.x}
                            cy={preview.y}
                            r={90}
                            fill="rgba(240, 192, 96, 0.18)"
                            stroke="rgba(240, 192, 96, 0.55)"
                            strokeWidth={3}
                        />
                        <circle cx={preview.x} cy={preview.y} r={12} fill="#f0c060" />
                    </>
                )}
            </svg>
            <CaptionCard instruction={instruction} detail={detail} onBack={onBack} />
        </div>
    );
}

function CaptionCard({ instruction, detail, onBack }: { instruction: string; detail: string; onBack?: () => void }) {
    return (
        <div
            style={{
                position: 'absolute',
                top: 60,
                left: '50%',
                transform: 'translateX(-50%)',
                background: 'rgba(20, 20, 32, 0.78)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                padding: '14px 22px',
                borderRadius: 14,
                border: '1px solid rgba(255,255,255,0.08)',
                maxWidth: 620,
                textAlign: 'center',
                pointerEvents: 'auto',
            }}
        >
            <div
                style={{
                    fontSize: 11,
                    letterSpacing: '0.18em',
                    color: '#f0c060',
                    textTransform: 'uppercase',
                    marginBottom: 6,
                }}
            >
                {instruction}
            </div>
            <div style={{ color: '#e8e8f0', fontSize: 15, lineHeight: 1.45 }}>{detail}</div>
            {onBack && (
                <button
                    onClick={onBack}
                    style={{
                        marginTop: 12,
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
            )}
        </div>
    );
}

// ── Fingers (multi-touch) step ───────────────────────────────────────────

interface FingersStepProps {
    palm: Point;
    onCapture: (pts: Point[]) => void;
    onBack: () => void;
}

interface TouchTrack {
    id: number;
    x: number;
    y: number;
    /** Position when this touch was first seen — used for stability check. */
    anchorX: number;
    anchorY: number;
    /** When the touch was placed. */
    startedAtMs: number;
}

function FingersStep({ palm, onCapture, onBack }: FingersStepProps) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const tracksRef = useRef<Map<number, TouchTrack>>(new Map());
    const stableSinceRef = useRef<number | null>(null);
    const [stableProgress, setStableProgress] = useState(0); // 0..1
    const [livePoints, setLivePoints] = useState<TouchTrack[]>([]);
    const PALM_GUARD_R = 160; // viewBox units — ignore touches in this radius

    const toViewBox = useCallback((clientX: number, clientY: number): Point => {
        const svg = svgRef.current!;
        const ctm = svg.getScreenCTM();
        if (!ctm) return { x: 0, y: 0 };
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const svgPt = pt.matrixTransform(ctm.inverse());
        return { x: svgPt.x, y: svgPt.y };
    }, []);

    const isInsidePalmGuard = useCallback(
        (p: Point) => {
            const dx = p.x - palm.x;
            const dy = p.y - palm.y;
            return dx * dx + dy * dy < PALM_GUARD_R * PALM_GUARD_R;
        },
        [palm],
    );

    const updateLive = useCallback(() => {
        const arr = Array.from(tracksRef.current.values());
        setLivePoints(arr);
    }, []);

    const handleTouchStart = useCallback(
        (e: React.TouchEvent<SVGSVGElement>) => {
            e.preventDefault();
            const now = performance.now();
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                const vb = toViewBox(t.clientX, t.clientY);
                if (isInsidePalmGuard(vb)) continue;
                tracksRef.current.set(t.identifier, {
                    id: t.identifier,
                    x: vb.x,
                    y: vb.y,
                    anchorX: vb.x,
                    anchorY: vb.y,
                    startedAtMs: now,
                });
            }
            stableSinceRef.current = null;
            setStableProgress(0);
            updateLive();
        },
        [toViewBox, isInsidePalmGuard, updateLive],
    );

    const handleTouchMove = useCallback(
        (e: React.TouchEvent<SVGSVGElement>) => {
            e.preventDefault();
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                const track = tracksRef.current.get(t.identifier);
                if (!track) continue;
                const vb = toViewBox(t.clientX, t.clientY);
                const dx = vb.x - track.anchorX;
                const dy = vb.y - track.anchorY;
                if (dx * dx + dy * dy > FINGER_STABLE_RADIUS * FINGER_STABLE_RADIUS) {
                    // jitter: re-anchor and break stability
                    track.anchorX = vb.x;
                    track.anchorY = vb.y;
                    stableSinceRef.current = null;
                    setStableProgress(0);
                }
                track.x = vb.x;
                track.y = vb.y;
            }
            updateLive();
        },
        [toViewBox, updateLive],
    );

    const handleTouchEnd = useCallback(
        (e: React.TouchEvent<SVGSVGElement>) => {
            e.preventDefault();
            for (let i = 0; i < e.changedTouches.length; i++) {
                tracksRef.current.delete(e.changedTouches[i].identifier);
            }
            stableSinceRef.current = null;
            setStableProgress(0);
            updateLive();
        },
        [updateLive],
    );

    // Stability + commit loop
    useEffect(() => {
        let rafId = 0;
        const loop = () => {
            const tracks = Array.from(tracksRef.current.values());
            const validCount = tracks.length;
            const now = performance.now();
            if (validCount === 4) {
                if (stableSinceRef.current === null) {
                    stableSinceRef.current = now;
                }
                const held = now - stableSinceRef.current;
                const pct = Math.min(1, held / FINGER_HOLD_MS);
                setStableProgress(pct);
                if (held >= FINGER_HOLD_MS) {
                    const pts = tracks.map((t) => ({ x: t.x, y: t.y }));
                    onCapture(pts);
                    return; // stop loop after capture
                }
            } else {
                if (stableSinceRef.current !== null) {
                    stableSinceRef.current = null;
                    setStableProgress(0);
                }
            }
            rafId = requestAnimationFrame(loop);
        };
        rafId = requestAnimationFrame(loop);
        return () => cancelAnimationFrame(rafId);
    }, [onCapture]);

    const ring = (Math.PI * 2) * 60; // circumference for progress ring (r=60)

    return (
        <div style={{ position: 'absolute', inset: 0 }}>
            <svg
                ref={svgRef}
                viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                preserveAspectRatio="xMidYMid meet"
                style={{
                    width: '100%',
                    height: '100%',
                    touchAction: 'none',
                    userSelect: 'none',
                    WebkitUserSelect: 'none',
                    display: 'block',
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onTouchCancel={handleTouchEnd}
            >
                {/* palm ghost */}
                <circle
                    cx={palm.x}
                    cy={palm.y}
                    r={PALM_GUARD_R}
                    fill="rgba(255,255,255,0.018)"
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth={2}
                    strokeDasharray="6 8"
                />
                <text
                    x={palm.x}
                    y={palm.y + 8}
                    textAnchor="middle"
                    fill="rgba(255,255,255,0.32)"
                    fontSize={22}
                    fontFamily="system-ui, sans-serif"
                >
                    palm
                </text>

                {livePoints.map((p) => (
                    <g key={p.id}>
                        <circle
                            cx={p.x}
                            cy={p.y}
                            r={60}
                            fill="rgba(240, 192, 96, 0.15)"
                            stroke="rgba(240, 192, 96, 0.45)"
                            strokeWidth={3}
                        />
                        {livePoints.length === 4 && stableProgress > 0 && (
                            <circle
                                cx={p.x}
                                cy={p.y}
                                r={60}
                                fill="none"
                                stroke="#f0c060"
                                strokeWidth={5}
                                strokeLinecap="round"
                                strokeDasharray={`${ring * stableProgress} ${ring}`}
                                transform={`rotate(-90 ${p.x} ${p.y})`}
                            />
                        )}
                        <circle cx={p.x} cy={p.y} r={8} fill="#f0c060" />
                    </g>
                ))}
            </svg>
            <CaptionCard
                instruction={`Step 2 of 3 — fingers · ${livePoints.length}/4 detected`}
                detail="Spread your four fingertips (index, middle, ring, pinky — no thumb) onto the screen at comfortable full reach. Hold them still until the rings fill in."
                onBack={onBack}
            />
        </div>
    );
}

// ── Preview step ─────────────────────────────────────────────────────────

interface PreviewStepProps {
    palm: Point;
    fingers: Point[];
    thumb: Point;
    onAccept: () => void;
    onRedo: () => void;
}

function PreviewStep({ palm, fingers, thumb, onAccept, onRedo }: PreviewStepProps) {
    const cal = buildCalibration({ palm, fingers, thumb });
    const built = buildLayout(cal); // default tunings — calibration preview uses untuned layout
    return (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column' }}>
            <div style={{ flex: '1 1 auto', minHeight: 0, position: 'relative' }}>
                <Keyboard
                    keys={built.keys}
                    palmDeadzone={{ x: built.geometry.palm.x, y: built.geometry.palm.y, r: built.palmDeadzoneRadius }}
                    onKey={() => {}}
                    shift={false}
                    flashKeyId={null}
                    interactive={false}
                />
            </div>
            <div
                style={{
                    flex: '0 0 auto',
                    padding: '16px 22px',
                    borderTop: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(20,20,32,0.6)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 14,
                }}
            >
                <div>
                    <div style={{ fontSize: 11, letterSpacing: '0.18em', color: '#f0c060', textTransform: 'uppercase', marginBottom: 4 }}>
                        Preview
                    </div>
                    <div style={{ fontSize: 14, color: '#c8c8e0' }}>
                        QWERTY across three arcs, fitted to your hand. Try mentally reaching for each key — comfortable?
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button
                        onClick={onRedo}
                        style={{
                            background: 'transparent',
                            border: '1px solid rgba(255,255,255,0.15)',
                            color: '#c8c8e0',
                            fontSize: 13,
                            letterSpacing: '0.08em',
                            padding: '10px 18px',
                            borderRadius: 10,
                            cursor: 'pointer',
                        }}
                    >
                        Redo
                    </button>
                    <button
                        onClick={onAccept}
                        style={{
                            background: '#f0c060',
                            color: '#1b1b27',
                            border: 'none',
                            fontSize: 14,
                            fontWeight: 600,
                            letterSpacing: '0.04em',
                            padding: '10px 22px',
                            borderRadius: 10,
                            cursor: 'pointer',
                        }}
                    >
                        Looks good — start typing
                    </button>
                </div>
            </div>
        </div>
    );
}
