'use client';

/**
 * Asciinema cast player for embedding install/setup recordings in docs.
 *
 * Usage from MDX:
 *   import { AsciinemaCast } from '../../components/AsciinemaCast'
 *
 *   <AsciinemaCast
 *     src="https://github.com/sheunaluko/smartchats/releases/latest/download/smartchats-darwin-arm64.cast"
 *     title="`smartchats setup` on darwin-arm64"
 *   />
 *
 * The CI workflow at .github/workflows/release.yml uploads per-platform
 * .cast files alongside each release tarball, so the URL above resolves
 * to the latest release's cast as soon as v0.3.0+ is tagged.
 *
 * We pull asciinema-player from a CDN rather than bundling so the docs
 * site stays small for the 95% of users who just read text.
 */

import { useEffect, useRef } from 'react';

interface AsciinemaCastProps {
    src: string;
    title?: string;
    cols?: number;
    rows?: number;
    autoPlay?: boolean;
    loop?: boolean;
}

const PLAYER_VERSION = '3.10.0';

let scriptLoaded: Promise<void> | null = null;

function loadAsciinemaPlayer(): Promise<void> {
    if (scriptLoaded) return scriptLoaded;
    if (typeof window === 'undefined') return Promise.resolve();

    scriptLoaded = new Promise<void>((resolve, reject) => {
        // CSS
        if (!document.querySelector('link[data-asciinema]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            link.href = `https://cdn.jsdelivr.net/npm/asciinema-player@${PLAYER_VERSION}/dist/bundle/asciinema-player.css`;
            link.setAttribute('data-asciinema', '');
            document.head.appendChild(link);
        }
        // JS
        if ((window as any).AsciinemaPlayer) {
            resolve();
            return;
        }
        const script = document.createElement('script');
        script.src = `https://cdn.jsdelivr.net/npm/asciinema-player@${PLAYER_VERSION}/dist/bundle/asciinema-player.min.js`;
        script.onload = () => resolve();
        script.onerror = () => reject(new Error('Failed to load asciinema-player'));
        document.head.appendChild(script);
    });
    return scriptLoaded;
}

export function AsciinemaCast({
    src,
    title,
    cols = 110,
    rows = 28,
    autoPlay = false,
    loop = false,
}: AsciinemaCastProps) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        loadAsciinemaPlayer().then(() => {
            const w = window as any;
            if (!w.AsciinemaPlayer || !container) return;
            container.innerHTML = '';
            w.AsciinemaPlayer.create(src, container, {
                cols,
                rows,
                autoPlay,
                loop,
                theme: 'monokai',
                preload: true,
            });
        }).catch((err) => {
            console.error('AsciinemaCast: failed to load player', err);
            if (container) {
                container.innerHTML = `<div style="padding: 1rem; border: 1px solid #ccc; border-radius: 4px; color: #666;">Could not load the asciinema cast. <a href="${src}">Download .cast file</a></div>`;
            }
        });

        return () => {
            if (container) container.innerHTML = '';
        };
    }, [src, cols, rows, autoPlay, loop]);

    return (
        <div style={{ margin: '1.5rem 0' }}>
            {title && (
                <div style={{ fontSize: '0.85rem', color: '#888', marginBottom: '0.5rem' }}>
                    {title}
                </div>
            )}
            <div ref={containerRef} style={{ minHeight: `${rows * 18}px` }} />
        </div>
    );
}
