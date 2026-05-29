'use client';

/**
 * SpectrogramPresets — save/load/delete the full set of SpectrogramPanel
 * settings as named presets in localStorage. Useful so the user can
 * spin up a config like "voice F0 debug" or "wide log scan" with one
 * click instead of re-entering all the knobs.
 *
 * Storage shape is versioned so future schema changes don't silently
 * eat existing presets — bump LS_VERSION and add migration if needed.
 */

import React, { useEffect, useState } from 'react';
import type { FreqScale } from './spectrogram_utils';

/** All knobs the panel persists. Keep in sync with SpectrogramPanel state. */
export interface SpectrogramSettings {
    mode: '2d' | '3d';
    scale: FreqScale;
    minFreqHz: number;
    maxFreqHz: number;
    speed: number;
    fftSize: number;
    contrast: number;
    azimuthDeg: number;
    autorotate: boolean;
    autorotateDegPerSec: number;
    showPitchMarker: boolean;
    harmonicRescueThreshold: number;
    pitchMarkerSize: number;
    showPitchTrail: boolean;
}

interface Preset {
    name: string;
    savedAt: number;
    settings: SpectrogramSettings;
}

const LS_KEY = 'sail.spectrogramPresets.v1';

function loadPresets(): Preset[] {
    try {
        if (typeof window === 'undefined') return [];
        const raw = window.localStorage.getItem(LS_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        // Defensive — drop malformed entries rather than blowing up.
        return parsed.filter(p => p && typeof p.name === 'string' && p.settings);
    } catch {
        return [];
    }
}

function writePresets(presets: Preset[]): void {
    try {
        window.localStorage.setItem(LS_KEY, JSON.stringify(presets));
    } catch (err) {
        console.warn('[sail/presets] failed to write localStorage', err);
    }
}

interface Props {
    /** Current panel state — snapshot saved when user presses save. */
    currentSettings: SpectrogramSettings;
    /** Called with the chosen preset's settings; panel re-applies all state. */
    onLoad: (settings: SpectrogramSettings) => void;
    labelStyle: React.CSSProperties;
    selectStyle: React.CSSProperties;
    buttonStyle: React.CSSProperties;
}

export function SpectrogramPresets({ currentSettings, onLoad, labelStyle, selectStyle, buttonStyle }: Props) {
    const [presets, setPresets] = useState<Preset[]>([]);
    const [selected, setSelected] = useState<string>('');

    // Hydrate from localStorage on mount (avoids SSR mismatch).
    useEffect(() => { setPresets(loadPresets()); }, []);

    function refresh(next: Preset[]) {
        writePresets(next);
        setPresets(next);
    }

    function handleSave() {
        const suggested = selected || `preset ${presets.length + 1}`;
        const name = window.prompt('preset name:', suggested)?.trim();
        if (!name) return;
        const next: Preset[] = [
            ...presets.filter(p => p.name !== name),
            { name, savedAt: Date.now(), settings: currentSettings },
        ].sort((a, b) => a.name.localeCompare(b.name));
        refresh(next);
        setSelected(name);
    }

    function handleLoad() {
        const p = presets.find(p => p.name === selected);
        if (!p) return;
        onLoad(p.settings);
    }

    function handleDelete() {
        if (!selected) return;
        const p = presets.find(p => p.name === selected);
        if (!p) return;
        if (!window.confirm(`delete preset "${selected}"?`)) return;
        const next = presets.filter(p => p.name !== selected);
        refresh(next);
        setSelected('');
    }

    return (
        <>
            <label style={labelStyle} title="save / load named configurations of all spectrogram settings (browser localStorage)">presets</label>
            <select
                value={selected}
                onChange={e => setSelected(e.target.value)}
                style={selectStyle}
                title={presets.length === 0 ? 'no presets saved yet' : `${presets.length} saved`}
            >
                <option value="">{presets.length === 0 ? '— none saved —' : '— select —'}</option>
                {presets.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
            </select>
            <button onClick={handleSave} style={buttonStyle} title="save current settings as a new preset (or overwrite by name)">save</button>
            <button
                onClick={handleLoad}
                style={buttonStyle}
                disabled={!selected}
                title="apply the selected preset's settings to the panel"
            >
                load
            </button>
            <button
                onClick={handleDelete}
                style={buttonStyle}
                disabled={!selected}
                title="delete the selected preset"
            >
                del
            </button>
        </>
    );
}
