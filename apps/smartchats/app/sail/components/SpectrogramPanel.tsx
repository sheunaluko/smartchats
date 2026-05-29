'use client';

/**
 * SpectrogramPanel — wraps the 2D and 3D spectrograms with a top toolbar:
 * mode (2D/3D), frequency-axis scale (linear/log), display range (min/max
 * Hz), and scroll speed. Only one spectrogram is mounted at a time so we
 * never hold two `getUserMedia` mic streams simultaneously.
 *
 * The frequency / scale / speed knobs are passed straight through as
 * props to the active spectrogram. Both components mirror them into
 * refs internally so changes apply live (no remount, no mic flicker).
 */

import React, { useCallback, useState } from 'react';
import { Spectrogram } from './Spectrogram';
import { Spectrogram3D } from './Spectrogram3D';
import { SpectrogramPresets, type SpectrogramSettings } from './SpectrogramPresets';
import type { FreqScale } from './spectrogram_utils';

type Mode = '2d' | '3d';

type Props = {
    /** Optional fixed height in px. If omitted, the panel fills its parent
     *  (use a flex parent with `flex: 1, minHeight: 0`). */
    height?: number;
    minDb?: number;
    maxDb?: number;
    label?: string;
    /** Initial render mode. Defaults to 2D (the debugging-friendly view). */
    initialMode?: Mode;
};

const SPEED_OPTIONS = [0.25, 0.5, 1, 2, 4];
const AUTOROTATE_DPS_OPTIONS = [5, 15, 30, 60, 120];
// Web Audio's AnalyserNode caps fftSize at 32768 — higher than that
// would need a custom FFT (not just AnalyserNode), which is out of scope.
const FFT_SIZE_OPTIONS = [512, 1024, 2048, 4096, 8192, 16384, 32768];

export function SpectrogramPanel({
    height, minDb = -100, maxDb = -10, label = 'Microphone', initialMode = '2d',
}: Props) {
    const [mode, setMode] = useState<Mode>(initialMode);
    const [scale, setScale] = useState<FreqScale>('linear');
    const [minFreqHz, setMinFreqHz] = useState(0);
    const [maxFreqHz, setMaxFreqHz] = useState(24000);
    const [speed, setSpeed] = useState(1);
    const [fftSize, setFftSize] = useState(2048);
    const [contrast, setContrast] = useState(1);
    const [showPitchMarker, setShowPitchMarker] = useState(false);
    const [harmonicRescueThreshold, setHarmonicRescueThreshold] = useState(0.3);
    const [pitchMarkerSize, setPitchMarkerSize] = useState(1);
    const [showPitchTrail, setShowPitchTrail] = useState(false);
    // 3D camera knobs — ignored when mode === '2d'.
    const [azimuthDeg, setAzimuthDeg] = useState(0);
    const [autorotate, setAutorotate] = useState(false);
    const [autorotateDegPerSec, setAutorotateDegPerSec] = useState(15);
    // Bumping this remounts Spectrogram3D, which re-seeds the camera at
    // its default pose. Cleaner than threading a "reset" signal through.
    const [resetTick, setResetTick] = useState(0);

    // Settings snapshot for preset save + setter for preset load.
    const currentSettings: SpectrogramSettings = {
        mode, scale, minFreqHz, maxFreqHz, speed, fftSize, contrast,
        azimuthDeg, autorotate, autorotateDegPerSec,
        showPitchMarker, harmonicRescueThreshold, pitchMarkerSize, showPitchTrail,
    };
    const applySettings = useCallback((s: SpectrogramSettings) => {
        setMode(s.mode);
        setScale(s.scale);
        setMinFreqHz(s.minFreqHz);
        setMaxFreqHz(s.maxFreqHz);
        setSpeed(s.speed);
        setFftSize(s.fftSize);
        setContrast(s.contrast);
        setAzimuthDeg(s.azimuthDeg);
        setAutorotate(s.autorotate);
        setAutorotateDegPerSec(s.autorotateDegPerSec);
        setShowPitchMarker(s.showPitchMarker);
        setHarmonicRescueThreshold(s.harmonicRescueThreshold);
        setPitchMarkerSize(s.pitchMarkerSize);
        setShowPitchTrail(s.showPitchTrail);
    }, []);

    // Children take 100% of the viz row — flex below allocates space.
    const sharedProps = {
        minDb, maxDb,
        scale, minFreqHz, maxFreqHz, speed, fftSize, contrast,
    };
    const camProps = { azimuthDeg, autorotate, autorotateDegPerSec };

    return (
        <div style={{
            width: '100%',
            height: height ?? '100%',
            display: 'flex', flexDirection: 'column',
            minHeight: 0,
        }}>
            {/* Toolbar — wraps to two rows when 3D mode adds the camera knobs. */}
            <div style={{
                flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 8,
                padding: '4px 8px', fontFamily: 'ui-monospace, monospace', fontSize: 10,
                color: '#a0a0c0', background: '#11111a', border: '1px solid #2a2a3a',
                borderTopLeftRadius: 8, borderTopRightRadius: 8, borderBottom: 'none',
                flexWrap: 'wrap', rowGap: 4,
            }}>
                <span style={{ color: '#888' }}>{label}</span>
                <Divider />

                <label style={labelStyle}>scale</label>
                <select value={scale} onChange={e => setScale(e.target.value as FreqScale)} style={selectStyle}>
                    <option value="linear">linear</option>
                    <option value="log">log</option>
                </select>

                <Divider />

                <label style={labelStyle}>min Hz</label>
                <input
                    type="number" min={0} max={24000} step={50}
                    value={minFreqHz}
                    onChange={e => setMinFreqHz(clamp(parseInt(e.target.value, 10) || 0, 0, maxFreqHz - 50))}
                    style={{ ...inputStyle, width: 64 }}
                />
                <label style={labelStyle}>max Hz</label>
                <input
                    type="number" min={50} max={24000} step={50}
                    value={maxFreqHz}
                    onChange={e => setMaxFreqHz(clamp(parseInt(e.target.value, 10) || 24000, minFreqHz + 50, 24000))}
                    style={{ ...inputStyle, width: 70 }}
                />

                <Divider />

                <label style={labelStyle}>speed</label>
                <select value={speed} onChange={e => setSpeed(parseFloat(e.target.value))} style={selectStyle}>
                    {SPEED_OPTIONS.map(s => <option key={s} value={s}>{s}×</option>)}
                </select>

                <Divider />

                <label style={labelStyle} title="FFT window size — bigger = finer freq resolution, slower time response">FFT</label>
                <select
                    value={fftSize}
                    onChange={e => setFftSize(parseInt(e.target.value, 10))}
                    style={selectStyle}
                    title={`${fftSize} bins → ~${(48000 / fftSize).toFixed(1)} Hz/bin at 48 kHz`}
                >
                    {FFT_SIZE_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
                </select>

                <Divider />

                <label style={labelStyle} title="contrast curve exponent — raises normalized magnitude to this power. 1=linear, 2=squared, 10=extreme peak isolation. higher = more low-signal suppression / peak emphasis.">contrast</label>
                <input
                    type="range" min={1} max={10} step={0.1}
                    value={contrast}
                    onChange={e => setContrast(parseFloat(e.target.value))}
                    style={{ width: 70, accentColor: '#3a5dff' }}
                    title={`v ^ ${contrast.toFixed(1)}`}
                />
                <span style={{ ...labelStyle, width: 28, textAlign: 'right' }}>{contrast.toFixed(1)}</span>

                {mode === '3d' && (
                    <>
                        <Divider />
                        <label style={labelStyle} title="camera orbit angle around the Y axis. When autorotate is on, this is the starting angle.">view °</label>
                        <input
                            type="range" min={0} max={360} step={5}
                            value={azimuthDeg}
                            onChange={e => setAzimuthDeg(parseInt(e.target.value, 10))}
                            style={{ width: 80, accentColor: '#3a5dff' }}
                            title={`${azimuthDeg}°`}
                        />
                        <span style={{ ...labelStyle, width: 28, textAlign: 'right' }}>{azimuthDeg}°</span>

                        <label style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={autorotate}
                                onChange={e => setAutorotate(e.target.checked)}
                                style={{ accentColor: '#3a5dff' }}
                            />
                            autorotate
                        </label>
                        <select
                            value={autorotateDegPerSec}
                            onChange={e => setAutorotateDegPerSec(parseInt(e.target.value, 10))}
                            disabled={!autorotate}
                            style={{ ...selectStyle, opacity: autorotate ? 1 : 0.5 }}
                            title="degrees per second"
                        >
                            {AUTOROTATE_DPS_OPTIONS.map(d => <option key={d} value={d}>{d}°/s</option>)}
                        </select>

                        <button
                            onClick={() => { setAzimuthDeg(0); setResetTick(t => t + 1); }}
                            style={modeButtonStyle(false)}
                            title="drag = orbit · scroll = zoom · right-drag = pan. click to reset to default pose."
                        >
                            reset view
                        </button>
                    </>
                )}

                <div style={{ flex: 1 }} />

                <SpectrogramPresets
                    currentSettings={currentSettings}
                    onLoad={applySettings}
                    labelStyle={labelStyle}
                    selectStyle={selectStyle}
                    buttonStyle={presetSmallBtn}
                />

                <Divider />

                <label
                    style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                    title="overlay a bright marker at the detected pitch (peak in current min/max Hz). 3D only. for voice F0 try min=80 max=400 + FFT ≥ 8192."
                >
                    <input
                        type="checkbox"
                        checked={showPitchMarker}
                        onChange={e => setShowPitchMarker(e.target.checked)}
                        style={{ accentColor: '#ffe066' }}
                        disabled={mode !== '3d'}
                    />
                    pitch
                </label>
                {showPitchMarker && mode === '3d' && (
                    <>
                        <label style={labelStyle} title="harmonic rescue: if a lower-freq local peak has ≥ this ratio of the contrasted global peak's magnitude, it wins (catches F0 when a harmonic outshines it). 0 = disabled.">rescue</label>
                        <input
                            type="range" min={0} max={1} step={0.05}
                            value={harmonicRescueThreshold}
                            onChange={e => setHarmonicRescueThreshold(parseFloat(e.target.value))}
                            style={{ width: 60, accentColor: '#ffe066' }}
                            title={`${(harmonicRescueThreshold * 100).toFixed(0)}% of peak`}
                        />
                        <span style={{ ...labelStyle, width: 28, textAlign: 'right' }}>{harmonicRescueThreshold.toFixed(2)}</span>

                        <label style={labelStyle} title="pitch marker sphere size">size</label>
                        <input
                            type="range" min={0.5} max={4} step={0.1}
                            value={pitchMarkerSize}
                            onChange={e => setPitchMarkerSize(parseFloat(e.target.value))}
                            style={{ width: 60, accentColor: '#ffe066' }}
                            title={`${pitchMarkerSize.toFixed(1)}×`}
                        />
                        <span style={{ ...labelStyle, width: 28, textAlign: 'right' }}>{pitchMarkerSize.toFixed(1)}×</span>

                        <label
                            style={{ ...labelStyle, display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}
                            title="show a fading trail of past pitch positions along the time axis"
                        >
                            <input
                                type="checkbox"
                                checked={showPitchTrail}
                                onChange={e => setShowPitchTrail(e.target.checked)}
                                style={{ accentColor: '#ffe066' }}
                            />
                            trail
                        </label>
                    </>
                )}
                <button onClick={() => setMode('2d')} style={modeButtonStyle(mode === '2d')} title="2D heatmap — best for reading">2D</button>
                <button onClick={() => setMode('3d')} style={modeButtonStyle(mode === '3d')} title="3D terrain — looks cool">3D</button>
            </div>

            {/* Viz */}
            <div style={{
                flex: 1, minHeight: 0,
                borderBottomLeftRadius: 8, borderBottomRightRadius: 8, overflow: 'hidden',
            }}>
                {mode === '2d' && <Spectrogram {...sharedProps} label={label} />}
                {mode === '3d' && (
                    <Spectrogram3D
                        key={resetTick}
                        {...sharedProps} {...camProps}
                        showPitchMarker={showPitchMarker}
                        harmonicRescueThreshold={harmonicRescueThreshold}
                        pitchMarkerSize={pitchMarkerSize}
                        showPitchTrail={showPitchTrail}
                        label={`${label} (3D)`}
                    />
                )}
            </div>
        </div>
    );
}

function Divider() {
    return <span style={{ color: '#2a2a3a' }}>·</span>;
}

function clamp(n: number, lo: number, hi: number): number {
    return Math.max(lo, Math.min(hi, n));
}

const labelStyle: React.CSSProperties = { color: '#666' };

const inputStyle: React.CSSProperties = {
    background: '#0a0a14', color: '#dcdcdc',
    border: '1px solid #2a2a3a', borderRadius: 3,
    padding: '1px 4px', fontSize: 10,
    fontFamily: 'ui-monospace, monospace',
};

const selectStyle: React.CSSProperties = {
    ...inputStyle, padding: '1px 4px',
};

const presetSmallBtn: React.CSSProperties = {
    background: '#1a1a2a', color: '#a0a0c0',
    border: '1px solid #2a2a3a', borderRadius: 4,
    padding: '2px 6px', fontSize: 10,
    fontFamily: 'ui-monospace, monospace', cursor: 'pointer',
};

function modeButtonStyle(active: boolean): React.CSSProperties {
    return {
        background: active ? '#3a5dff' : '#1a1a2a',
        color: active ? '#fff' : '#a0a0c0',
        border: '1px solid ' + (active ? '#3a5dff' : '#2a2a3a'),
        borderRadius: 4,
        padding: '2px 8px',
        fontSize: 10,
        fontFamily: 'ui-monospace, monospace',
        cursor: 'pointer',
        fontWeight: 500,
    };
}
