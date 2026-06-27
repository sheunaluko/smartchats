'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Terminal, type ITheme } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import WidgetItem from '../WidgetItem';
import {
    subscribeCliOutput,
    subscribeCliConnectionState,
    isCliConnected,
    sendCliRawInput,
    sendCliResize,
    requestCliSnapshot,
} from '../modules/cli_agent';

function getCssVar(name: string, fallback: string): string {
    if (typeof window === 'undefined') return fallback;
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
}

function buildSmartchatsTheme(): ITheme {
    return {
        background: getCssVar('--sc-surface-secondary', '#202024'),
        foreground: getCssVar('--sc-text', '#fafafa'),
        cursor: getCssVar('--sc-primary', '#3b82f6'),
        cursorAccent: getCssVar('--sc-surface-secondary', '#202024'),
        selectionBackground: 'rgba(59, 130, 246, 0.32)',
        black: getCssVar('--sc-background', '#09090b'),
        red: getCssVar('--sc-danger', '#ef4444'),
        green: getCssVar('--sc-success', '#22c55e'),
        yellow: getCssVar('--sc-warning', '#eab308'),
        blue: getCssVar('--sc-primary', '#3b82f6'),
        magenta: getCssVar('--sc-accent', '#f472b6'),
        cyan: '#06b6d4',
        white: getCssVar('--sc-text', '#fafafa'),
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#f9a8d4',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
    };
}

interface CliTerminalWidgetProps {
    fullscreen?: boolean;
    onFocus?: () => void;
    onClose?: () => void;
    theme?: Partial<ITheme>;
    fontSize?: number;
    fontFamily?: string;
}

const CliTerminalWidget: React.FC<CliTerminalWidgetProps> = ({
    fullscreen,
    onFocus,
    onClose,
    theme,
    fontSize = 12,
    fontFamily = 'ui-monospace, Menlo, Consolas, monospace',
}) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const [connected, setConnected] = useState<boolean>(() => isCliConnected());

    useEffect(() => subscribeCliConnectionState(setConnected), []);

    useEffect(() => {
        if (!connected || !hostRef.current) return;

        const term = new Terminal({
            convertEol: false,
            cursorBlink: true,
            fontFamily,
            fontSize,
            theme: { ...buildSmartchatsTheme(), ...(theme || {}) },
            allowProposedApi: true,
        });
        const fit = new FitAddon();
        term.loadAddon(fit);
        term.open(hostRef.current);
        try { fit.fit(); } catch {}

        sendCliResize(term.cols, term.rows);
        requestCliSnapshot();

        const unsubOutput = subscribeCliOutput((data) => term.write(data));
        const keyDispose = term.onData((data) => sendCliRawInput(data));

        const ro = new ResizeObserver(() => {
            try {
                fit.fit();
                sendCliResize(term.cols, term.rows);
            } catch {}
        });
        ro.observe(hostRef.current);

        return () => {
            unsubOutput();
            keyDispose.dispose();
            ro.disconnect();
            term.dispose();
        };
    }, [connected, theme, fontSize, fontFamily]);

    return (
        <WidgetItem title="CLI Terminal" fullscreen={fullscreen} onFocus={onFocus} onClose={onClose}>
            {connected ? (
                <div
                    ref={hostRef}
                    className="w-full h-full"
                    style={{ minHeight: 0, flexGrow: 1, background: 'var(--sc-surface-secondary)' }}
                />
            ) : (
                <div className="flex h-full w-full items-center justify-center px-6 py-8 text-center text-sm text-sc-text-muted">
                    Connect to the remote session to start the terminal proxy
                </div>
            )}
        </WidgetItem>
    );
};

export default CliTerminalWidget;
