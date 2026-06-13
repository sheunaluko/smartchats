'use client';

/**
 * QWERTY-mirrored 3-arc keyboard surface, calibrated to the user's
 * hand. Pure tap input — one motor pattern for every letter.
 *
 * Receives the keys array + palm-deadzone marker as props so the
 * Calibrate view can render the same component for its end-of-flow
 * preview.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { hitTestKey } from '../lib/layout';
import { GestureType, KeyDef, VIEW_HEIGHT, VIEW_WIDTH } from '../lib/types';

interface ActiveTouch {
    identifier: number;
    keyId: string;
    startVx: number;
    startVy: number;
    startTimeMs: number;
}

export interface KeyboardKeyEvent {
    key: KeyDef;
    gesture: GestureType;
    char: string;
    tapVx: number;
    tapVy: number;
    dwellMs: number;
}

interface Props {
    keys: KeyDef[];
    palmDeadzone: { x: number; y: number; r: number };
    onKey: (e: KeyboardKeyEvent) => void;
    shift: boolean;
    flashKeyId: string | null;
    /** When true, disables input — used by the calibration preview. */
    interactive?: boolean;
}

export function Keyboard({ keys, palmDeadzone, onKey, shift, flashKeyId, interactive = true }: Props) {
    const svgRef = useRef<SVGSVGElement | null>(null);
    const activeRef = useRef<Map<number, ActiveTouch>>(new Map());
    const [activeKeys, setActiveKeys] = useState<Set<string>>(new Set());

    const toViewBox = useCallback((clientX: number, clientY: number): { x: number; y: number } | null => {
        const svg = svgRef.current;
        if (!svg) return null;
        // Use SVG's native screen↔viewBox transform so preserveAspectRatio
        // letterboxing is handled correctly. A naive rect-based ratio
        // breaks whenever the container aspect differs from the viewBox.
        const ctm = svg.getScreenCTM();
        if (!ctm) return null;
        const pt = svg.createSVGPoint();
        pt.x = clientX;
        pt.y = clientY;
        const svgPt = pt.matrixTransform(ctm.inverse());
        return { x: svgPt.x, y: svgPt.y };
    }, []);

    const refreshActiveKeys = useCallback(() => {
        const next = new Set<string>();
        for (const t of activeRef.current.values()) next.add(t.keyId);
        setActiveKeys(next);
    }, []);

    const onTouchStart = useCallback(
        (e: React.TouchEvent<SVGSVGElement>) => {
            if (!interactive) return;
            e.preventDefault();
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                const vb = toViewBox(t.clientX, t.clientY);
                if (!vb) continue;
                const key = hitTestKey(keys, palmDeadzone, vb.x, vb.y);
                if (!key) continue;
                activeRef.current.set(t.identifier, {
                    identifier: t.identifier,
                    keyId: key.id,
                    startVx: vb.x,
                    startVy: vb.y,
                    startTimeMs: performance.now(),
                });
            }
            refreshActiveKeys();
        },
        [interactive, keys, palmDeadzone, toViewBox, refreshActiveKeys],
    );

    const onTouchMove = useCallback(
        (e: React.TouchEvent<SVGSVGElement>) => {
            if (!interactive) return;
            e.preventDefault();
        },
        [interactive],
    );

    const onTouchEnd = useCallback(
        (e: React.TouchEvent<SVGSVGElement>) => {
            if (!interactive) return;
            e.preventDefault();
            for (let i = 0; i < e.changedTouches.length; i++) {
                const t = e.changedTouches[i];
                const tracked = activeRef.current.get(t.identifier);
                if (!tracked) continue;
                const key = keys.find((k) => k.id === tracked.keyId);
                if (!key) {
                    activeRef.current.delete(t.identifier);
                    continue;
                }
                const dwellMs = performance.now() - tracked.startTimeMs;
                onKey({
                    key,
                    gesture: 'tap',
                    char: key.primary,
                    tapVx: tracked.startVx,
                    tapVy: tracked.startVy,
                    dwellMs,
                });
                activeRef.current.delete(t.identifier);
            }
            refreshActiveKeys();
        },
        [interactive, keys, onKey, refreshActiveKeys],
    );

    const onTouchCancel = useCallback(
        (e: React.TouchEvent<SVGSVGElement>) => {
            for (let i = 0; i < e.changedTouches.length; i++) {
                activeRef.current.delete(e.changedTouches[i].identifier);
            }
            refreshActiveKeys();
        },
        [refreshActiveKeys],
    );

    useEffect(() => {
        const svg = svgRef.current;
        if (!svg) return;
        const prevent = (e: Event) => e.preventDefault();
        svg.addEventListener('gesturestart', prevent);
        svg.addEventListener('gesturechange', prevent);
        svg.addEventListener('gestureend', prevent);
        return () => {
            svg.removeEventListener('gesturestart', prevent);
            svg.removeEventListener('gesturechange', prevent);
            svg.removeEventListener('gestureend', prevent);
        };
    }, []);

    return (
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
                WebkitTouchCallout: 'none',
                display: 'block',
            }}
            onTouchStart={onTouchStart}
            onTouchMove={onTouchMove}
            onTouchEnd={onTouchEnd}
            onTouchCancel={onTouchCancel}
        >
            <circle
                cx={palmDeadzone.x}
                cy={palmDeadzone.y}
                r={palmDeadzone.r}
                fill="rgba(255,255,255,0.015)"
                stroke="rgba(255,255,255,0.06)"
                strokeWidth={2}
                strokeDasharray="6 8"
            />
            <text
                x={palmDeadzone.x}
                y={palmDeadzone.y + 8}
                textAnchor="middle"
                fill="rgba(255,255,255,0.18)"
                fontSize={20}
                fontFamily="system-ui, sans-serif"
                fontWeight={500}
                style={{ pointerEvents: 'none' }}
            >
                palm
            </text>

            {keys.map((key) => {
                const active = activeKeys.has(key.id);
                const flashing = flashKeyId === key.id;
                const isCommand = key.kind === 'command';
                const lit = active || flashing;
                const fill = isCommand
                    ? lit
                        ? '#caa15f'
                        : 'rgba(202, 161, 95, 0.18)'
                    : lit
                      ? '#f0c060'
                      : 'rgba(240, 192, 96, 0.10)';
                const stroke = lit
                    ? 'rgba(255,255,255,0.6)'
                    : isCommand
                      ? 'rgba(202,161,95,0.5)'
                      : 'rgba(240,192,96,0.35)';
                const label = isCommand
                    ? key.primary
                    : shift
                      ? key.primary.toUpperCase()
                      : key.primary.toLowerCase();
                const fontSize = isCommand ? Math.round(key.r * 0.38) : Math.round(key.r * 0.95);
                return (
                    <g key={key.id}>
                        <circle cx={key.x} cy={key.y} r={key.r} fill={fill} stroke={stroke} strokeWidth={3} />
                        <text
                            x={key.x}
                            y={key.y + fontSize * 0.35}
                            textAnchor="middle"
                            fill={lit ? '#1b1b27' : 'rgba(255,255,255,0.92)'}
                            fontSize={fontSize}
                            fontFamily="system-ui, sans-serif"
                            fontWeight={600}
                            style={{ pointerEvents: 'none' }}
                        >
                            {label}
                        </text>
                    </g>
                );
            })}
        </svg>
    );
}
