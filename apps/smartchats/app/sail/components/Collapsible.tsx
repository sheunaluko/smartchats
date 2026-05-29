'use client';

/**
 * Collapsible — minimal wrapper that adds a click-to-toggle header above
 * any panel. Lets the spectrogram reclaim vertical space when secondary
 * diagnostics (AudioContextInspector, LabPoc, etc.) aren't actively in
 * use. Local state, no persistence — defaultOpen sets the initial pose.
 */

import React, { useState } from 'react';

type Props = {
    title: string;
    defaultOpen?: boolean;
    /** Optional right-side text shown in the header (e.g. a count). */
    rightHint?: React.ReactNode;
    children: React.ReactNode;
};

export function Collapsible({ title, defaultOpen = false, rightHint, children }: Props) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div style={{
            border: '1px solid #2a2a3a',
            borderRadius: 8,
            background: '#11111a',
            overflow: 'hidden',
        }}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                style={{
                    display: 'flex', alignItems: 'center', gap: 6,
                    width: '100%', padding: '6px 10px',
                    background: 'transparent', border: 'none',
                    color: '#a0a0c0', fontFamily: 'ui-monospace, monospace',
                    fontSize: 11, cursor: 'pointer', textAlign: 'left',
                }}
                aria-expanded={open}
            >
                <span style={{ color: '#666', width: 10 }}>{open ? '▾' : '▸'}</span>
                <span>{title}</span>
                <div style={{ flex: 1 }} />
                {rightHint && <span style={{ color: '#666' }}>{rightHint}</span>}
            </button>
            {open && <div style={{ borderTop: '1px solid #1a1a28' }}>{children}</div>}
        </div>
    );
}
