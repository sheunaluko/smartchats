'use client';

/**
 * Grid keyboard renderer + touch handler.
 *
 * Keys are positioned as `position: absolute` divs at the layout's
 * percentage coordinates. The container is a flex child that fills
 * its parent — so the keyboard naturally expands/contracts with
 * orientation changes and surrounding chrome.
 *
 * Touch hit-test uses the container's bounding rect, so the same
 * code path covers both portrait and landscape. Each touch records
 * the key it started on at touchstart and fires onKey on touchend
 * if the release is still within that key's bounds.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { GridKeyDef, GridLayout } from '../layouts/types';

export interface GridTapMeta {
    key: GridKeyDef;
    /** Touch x as a fraction of container width [0..1]. */
    xNorm: number;
    /** Touch y as a fraction of container height [0..1]. */
    yNorm: number;
    dwellMs: number;
}

interface Props {
    layout: GridLayout;
    onKey: (e: GridTapMeta) => void;
    shift: boolean;
    flashKeyId: string | null;
    interactive?: boolean;
}

interface ActiveTouch {
    identifier: number;
    keyId: string;
    startedAtMs: number;
}

export function GridKeyboard({ layout, onKey, shift, flashKeyId, interactive = true }: Props) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const activeRef = useRef<Map<number, ActiveTouch>>(new Map());
    const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());

    const refreshActive = useCallback(() => {
        const next = new Set<string>();
        for (const t of activeRef.current.values()) next.add(t.keyId);
        setActiveKeys(next);
    }, []);

    const hitTest = useCallback(
        (clientX: number, clientY: number): GridKeyDef | null => {
            const el = containerRef.current;
            if (!el) return null;
            const rect = el.getBoundingClientRect();
            const xPct = ((clientX - rect.left) / rect.width) * 100;
            const yPct = ((clientY - rect.top) / rect.height) * 100;
            for (const key of layout.keys) {
                if (
                    xPct >= key.leftPct &&
                    xPct < key.leftPct + key.widthPct &&
                    yPct >= key.topPct &&
                    yPct < key.topPct + key.heightPct
                ) {
                    return key;
                }
            }
            return null;
        },
        [layout.keys],
    );

    const onTouchStart = useCallback(
        (e: React.TouchEvent<HTMLDivElement>) => {
            if (!interactive) return;
            e.preventDefault();
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                const key = hitTest(t.clientX, t.clientY);
                if (!key) continue;
                activeRef.current.set(t.identifier, {
                    identifier: t.identifier,
                    keyId: key.id,
                    startedAtMs: performance.now(),
                });
            }
            refreshActive();
        },
        [interactive, hitTest, refreshActive],
    );

    const onTouchMove = useCallback(
        (e: React.TouchEvent<HTMLDivElement>) => {
            if (!interactive) return;
            e.preventDefault();
        },
        [interactive],
    );

    const onTouchEnd = useCallback(
        (e: React.TouchEvent<HTMLDivElement>) => {
            if (!interactive) return;
            e.preventDefault();
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                const tracked = activeRef.current.get(t.identifier);
                if (!tracked) continue;
                activeRef.current.delete(t.identifier);
                const releaseKey = hitTest(t.clientX, t.clientY);
                // Commit only if the release landed on the same key we started on
                if (!releaseKey || releaseKey.id !== tracked.keyId) continue;
                const el = containerRef.current!;
                const rect = el.getBoundingClientRect();
                onKey({
                    key: releaseKey,
                    xNorm: (t.clientX - rect.left) / rect.width,
                    yNorm: (t.clientY - rect.top) / rect.height,
                    dwellMs: performance.now() - tracked.startedAtMs,
                });
            }
            refreshActive();
        },
        [interactive, hitTest, onKey, refreshActive],
    );

    const onTouchCancel = useCallback(
        (e: React.TouchEvent<HTMLDivElement>) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                activeRef.current.delete(e.changedTouches[i].identifier);
            }
            refreshActive();
        },
        [refreshActive],
    );

    // Suppress iOS pinch/zoom gestures on the keyboard surface.
    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;
        const prevent = (e: Event) => e.preventDefault();
        el.addEventListener('gesturestart', prevent);
        el.addEventListener('gesturechange', prevent);
        el.addEventListener('gestureend', prevent);
        return () => {
            el.removeEventListener('gesturestart', prevent);
            el.removeEventListener('gesturechange', prevent);
            el.removeEventListener('gestureend', prevent);
        };
    }, []);

    return (
        <div
            ref={containerRef}
            style={{
                position: 'relative',
                width: '100%',
                height: '100%',
                touchAction: 'none',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                WebkitTouchCallout: 'none',
                background: '#0a0a14',
            }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
        >
            {layout.keys.map((key) => (
                <GridKey
                    key={key.id}
                    keyDef={key}
                    active={activeKeys.has(key.id) || flashKeyId === key.id}
                    shift={shift}
                />
            ))}
        </div>
    );
}

function GridKey({ keyDef, active, shift }: { keyDef: GridKeyDef; active: boolean; shift: boolean }) {
    const isCommand = keyDef.kind === 'command';
    const label = useMemo(() => {
        if (isCommand) return commandLabel(keyDef.primary);
        return shift ? keyDef.primary.toUpperCase() : keyDef.primary.toLowerCase();
    }, [keyDef, isCommand, shift]);

    const bg = active
        ? isCommand
            ? '#caa15f'
            : '#f0c060'
        : isCommand
          ? 'rgba(202, 161, 95, 0.16)'
          : 'rgba(240, 192, 96, 0.08)';
    const stroke = active
        ? 'rgba(255,255,255,0.55)'
        : isCommand
          ? 'rgba(202,161,95,0.45)'
          : 'rgba(240,192,96,0.28)';
    const textColor = active ? '#1b1b27' : 'rgba(255,255,255,0.92)';

    return (
        <div
            style={{
                position: 'absolute',
                left: `${keyDef.leftPct}%`,
                top: `${keyDef.topPct}%`,
                width: `${keyDef.widthPct}%`,
                height: `${keyDef.heightPct}%`,
                padding: 4,
                boxSizing: 'border-box',
                pointerEvents: 'none',
            }}
        >
            <div
                style={{
                    width: '100%',
                    height: '100%',
                    background: bg,
                    border: `1.5px solid ${stroke}`,
                    borderRadius: 10,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: textColor,
                    fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, sans-serif',
                    fontWeight: 600,
                    fontSize: `clamp(14px, ${isCommand ? '2.2vmin' : '4vmin'}, ${isCommand ? '24px' : '38px'})`,
                    letterSpacing: isCommand ? '0.08em' : 0,
                    transition: 'background 50ms linear, color 50ms linear',
                }}
            >
                {label}
            </div>
        </div>
    );
}

function commandLabel(primary: string): string {
    switch (primary) {
        case 'SPACE':
            return 'space';
        case 'BACK':
            return '⌫';
        case 'ENTER':
            return '⏎';
        case 'SHIFT':
            return '⇧';
        default:
            return primary;
    }
}
