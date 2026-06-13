'use client';

/**
 * Tune the calibrated layout — nudge each row's position, spacing,
 * and key size. Tunings ride on top of the calibration and persist
 * separately so changing the tunings doesn't trigger re-calibration.
 *
 * Layout in portrait:
 *   ┌────────────────────────────────────────┐
 *   │  Header (back / title / Cancel / Save) │
 *   │  Tabs:  [Top] [Home] [Bottom] [Space]  │
 *   │  Sliders for the active tab            │
 *   │ ────────────────────────────────────── │
 *   │  Live keyboard preview                 │
 *   └────────────────────────────────────────┘
 */

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import React, { useMemo, useState } from 'react';
import { Keyboard } from '../components/Keyboard';
import { loadCalibration } from '../lib/calibration';
import { buildLayout } from '../lib/layout';
import {
    CommandKeyTuning,
    LayoutTunings,
    RowTuning,
    defaultCommandTuning,
    defaultRowTuning,
    loadTunings,
    saveTunings,
} from '../lib/tunings';

type Tab = 'outer' | 'middle' | 'inner' | 'space';

const TAB_LABELS: Record<Tab, string> = {
    outer: 'Top row',
    middle: 'Home row',
    inner: 'Bottom row',
    space: 'Space',
};

const OFFSET_RANGE = 300;
const SCALE_MIN = 0.7;
const SCALE_MAX = 1.3;

export default function TuneView() {
    const router = useRouter();
    const calibration = useMemo(() => loadCalibration(), []);
    const [tunings, setTunings] = useState<LayoutTunings>(() => loadTunings());
    const [tab, setTab] = useState<Tab>('outer');

    const built = useMemo(() => {
        if (!calibration) return null;
        return buildLayout(calibration, tunings);
    }, [calibration, tunings]);

    if (!calibration) {
        // No calibration yet — bounce to the calibration flow.
        if (typeof window !== 'undefined') {
            router.replace('/lab/onehand/calibrate');
        }
        return <FallbackMsg>Redirecting to calibration…</FallbackMsg>;
    }
    if (!built) return <FallbackMsg>Loading…</FallbackMsg>;

    const updateRow = (which: 'outer' | 'middle' | 'inner', patch: Partial<RowTuning>) => {
        setTunings((t) => ({ ...t, [which]: { ...t[which], ...patch } }));
    };
    const updateSpace = (patch: Partial<CommandKeyTuning>) => {
        setTunings((t) => ({ ...t, space: { ...t.space, ...patch } }));
    };
    const resetActive = () => {
        if (tab === 'space') updateSpace(defaultCommandTuning());
        else updateRow(tab, defaultRowTuning());
    };

    const onSave = () => {
        saveTunings(tunings);
        router.push('/lab/onehand');
    };

    const activeRow: RowTuning | null = tab === 'space' ? null : tunings[tab];
    const activeSpace: CommandKeyTuning | null = tab === 'space' ? tunings.space : null;

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
            <Header onCancel={() => router.push('/lab/onehand')} onSave={onSave} onReset={resetActive} />

            <Tabs tab={tab} setTab={setTab} />

            <div
                style={{
                    padding: '14px 18px 18px',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    flex: '0 0 auto',
                }}
            >
                {activeRow && (
                    <>
                        <Slider
                            label="Horizontal position"
                            min={-OFFSET_RANGE}
                            max={OFFSET_RANGE}
                            step={2}
                            value={activeRow.offsetX}
                            onChange={(v) => updateRow(tab as 'outer' | 'middle' | 'inner', { offsetX: v })}
                            display={`${activeRow.offsetX > 0 ? '+' : ''}${activeRow.offsetX.toFixed(0)} px`}
                        />
                        <Slider
                            label="Vertical position"
                            min={-OFFSET_RANGE}
                            max={OFFSET_RANGE}
                            step={2}
                            value={activeRow.offsetY}
                            onChange={(v) => updateRow(tab as 'outer' | 'middle' | 'inner', { offsetY: v })}
                            display={`${activeRow.offsetY > 0 ? '+' : ''}${activeRow.offsetY.toFixed(0)} px`}
                        />
                        <Slider
                            label="Letter spacing"
                            min={SCALE_MIN}
                            max={SCALE_MAX}
                            step={0.01}
                            value={activeRow.spacingScale}
                            onChange={(v) => updateRow(tab as 'outer' | 'middle' | 'inner', { spacingScale: v })}
                            display={`×${activeRow.spacingScale.toFixed(2)}`}
                        />
                        <Slider
                            label="Key size"
                            min={SCALE_MIN}
                            max={SCALE_MAX}
                            step={0.01}
                            value={activeRow.sizeScale}
                            onChange={(v) => updateRow(tab as 'outer' | 'middle' | 'inner', { sizeScale: v })}
                            display={`×${activeRow.sizeScale.toFixed(2)}`}
                        />
                    </>
                )}
                {activeSpace && (
                    <>
                        <Slider
                            label="Horizontal position"
                            min={-OFFSET_RANGE}
                            max={OFFSET_RANGE}
                            step={2}
                            value={activeSpace.offsetX}
                            onChange={(v) => updateSpace({ offsetX: v })}
                            display={`${activeSpace.offsetX > 0 ? '+' : ''}${activeSpace.offsetX.toFixed(0)} px`}
                        />
                        <Slider
                            label="Vertical position"
                            min={-OFFSET_RANGE}
                            max={OFFSET_RANGE}
                            step={2}
                            value={activeSpace.offsetY}
                            onChange={(v) => updateSpace({ offsetY: v })}
                            display={`${activeSpace.offsetY > 0 ? '+' : ''}${activeSpace.offsetY.toFixed(0)} px`}
                        />
                        <Slider
                            label="Key size"
                            min={SCALE_MIN}
                            max={SCALE_MAX}
                            step={0.01}
                            value={activeSpace.sizeScale}
                            onChange={(v) => updateSpace({ sizeScale: v })}
                            display={`×${activeSpace.sizeScale.toFixed(2)}`}
                        />
                    </>
                )}
            </div>

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
        </div>
    );
}

// ────────────────────────────────────────────────────────────────────────

function Header({ onCancel, onSave, onReset }: { onCancel: () => void; onSave: () => void; onReset: () => void }) {
    return (
        <div
            style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '10px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                flex: '0 0 auto',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <Link
                    href="/lab/onehand"
                    onClick={(e) => {
                        e.preventDefault();
                        onCancel();
                    }}
                    style={{
                        color: '#9090b0',
                        textDecoration: 'none',
                        fontSize: 12,
                        letterSpacing: '0.1em',
                        textTransform: 'uppercase',
                    }}
                >
                    ← Cancel
                </Link>
                <div style={{ fontSize: 15, fontWeight: 600 }}>Tune layout</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button onClick={onReset} style={btnStyle('ghost')}>
                    Reset
                </button>
                <button onClick={onSave} style={btnStyle('primary')}>
                    Save
                </button>
            </div>
        </div>
    );
}

function Tabs({ tab, setTab }: { tab: Tab; setTab: (t: Tab) => void }) {
    const tabs: Tab[] = ['outer', 'middle', 'inner', 'space'];
    return (
        <div
            style={{
                display: 'flex',
                gap: 6,
                padding: '10px 16px',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                flex: '0 0 auto',
            }}
        >
            {tabs.map((t) => (
                <button
                    key={t}
                    onClick={() => setTab(t)}
                    style={{
                        flex: 1,
                        background: t === tab ? '#f0c060' : 'rgba(255,255,255,0.04)',
                        color: t === tab ? '#1b1b27' : '#c8c8e0',
                        border: '1px solid rgba(255,255,255,0.06)',
                        padding: '10px 8px',
                        fontSize: 13,
                        fontWeight: t === tab ? 600 : 500,
                        borderRadius: 8,
                        cursor: 'pointer',
                        letterSpacing: '0.02em',
                    }}
                >
                    {TAB_LABELS[t]}
                </button>
            ))}
        </div>
    );
}

interface SliderProps {
    label: string;
    min: number;
    max: number;
    step: number;
    value: number;
    onChange: (v: number) => void;
    display: string;
}

function Slider({ label, min, max, step, value, onChange, display }: SliderProps) {
    return (
        <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: '#9090b0', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                    {label}
                </span>
                <span style={{ fontSize: 12, color: '#f0c060', fontVariantNumeric: 'tabular-nums' }}>{display}</span>
            </div>
            <input
                type="range"
                min={min}
                max={max}
                step={step}
                value={value}
                onChange={(e) => onChange(parseFloat(e.target.value))}
                style={{
                    width: '100%',
                    accentColor: '#f0c060',
                    height: 28,
                }}
            />
        </div>
    );
}

function FallbackMsg({ children }: { children: React.ReactNode }) {
    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: '#0b0b14',
                color: '#9090b0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: 'system-ui, sans-serif',
                fontSize: 14,
                letterSpacing: '0.1em',
            }}
        >
            {children}
        </div>
    );
}

function btnStyle(kind: 'primary' | 'ghost'): React.CSSProperties {
    return kind === 'primary'
        ? {
              background: '#f0c060',
              color: '#1b1b27',
              border: 'none',
              padding: '8px 16px',
              borderRadius: 8,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: '0.04em',
              cursor: 'pointer',
          }
        : {
              background: 'transparent',
              color: '#c8c8e0',
              border: '1px solid rgba(255,255,255,0.15)',
              padding: '8px 14px',
              borderRadius: 8,
              fontSize: 12,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: 'pointer',
          };
}
