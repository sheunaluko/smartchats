'use client';

/**
 * Spectrogram — scrolling 2D frequency-vs-time canvas for a single audio
 * source (mic-only in the v1 scaffold). Uses a private AudioContext +
 * AnalyserNode so it doesn't touch tivi's graph; trade-off is a duplicate
 * mic stream when voice is active. Phase 2 will tap tivi's output bus
 * for the TTS-output spectrogram.
 *
 * Designed for /sail at 60fps; FFT 2048, smoothing 0.8. Cancels cleanly
 * on unmount + on tab hide (visibilitychange).
 */

import React, { useEffect, useRef } from 'react';

type Props = {
    /** CSS height in px; width fills container. */
    height?: number;
    /** dB floor — values below this clip to background. Default -100. */
    minDb?: number;
    /** dB ceiling — values above this clip to max color. Default -10. */
    maxDb?: number;
    /** Optional title shown in the top-left of the canvas. */
    label?: string;
};

export function Spectrogram({ height = 200, minDb = -100, maxDb = -10, label = 'Microphone' }: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const ctxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<number | null>(null);
    const dataRef = useRef<Uint8Array | null>(null);
    const stoppedRef = useRef(false);

    useEffect(() => {
        stoppedRef.current = false;
        let cancelled = false;

        async function setup() {
            try {
                const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                if (cancelled) {
                    stream.getTracks().forEach(t => t.stop());
                    return;
                }
                streamRef.current = stream;

                const audioCtx = new AudioContext();
                ctxRef.current = audioCtx;
                const src = audioCtx.createMediaStreamSource(stream);
                const analyser = audioCtx.createAnalyser();
                analyser.fftSize = 2048;
                analyser.smoothingTimeConstant = 0.8;
                analyser.minDecibels = minDb;
                analyser.maxDecibels = maxDb;
                src.connect(analyser);
                analyserRef.current = analyser;
                // Explicit ArrayBuffer-backed Uint8Array — TS strict mode rejects
                // the default Uint8Array<ArrayBufferLike> as the analyser's input type.
                dataRef.current = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));

                draw();
            } catch (err) {
                console.error('[sail/spectrogram] setup failed', err);
            }
        }

        function draw() {
            if (stoppedRef.current) return;
            const canvas = canvasRef.current;
            const analyser = analyserRef.current;
            const data = dataRef.current;
            if (!canvas || !analyser || !data) {
                rafRef.current = requestAnimationFrame(draw);
                return;
            }

            const ctx2d = canvas.getContext('2d');
            if (!ctx2d) return;

            // Read frequency data (0-255 mapped to minDb..maxDb).
            // Cast — TS 5.7+ flags Uint8Array<ArrayBufferLike> vs Uint8Array<ArrayBuffer>,
            // but the underlying buffer here is always ArrayBuffer (constructed above).
            analyser.getByteFrequencyData(data as unknown as Uint8Array<ArrayBuffer>);

            // Scroll existing image left by 1px, then draw the new column on the right.
            const w = canvas.width;
            const h = canvas.height;
            try {
                const img = ctx2d.getImageData(1, 0, w - 1, h);
                ctx2d.putImageData(img, 0, 0);
            } catch { /* ignore — happens on first paint when canvas was just resized */ }

            // Draw new column at the right edge
            for (let y = 0; y < h; y++) {
                // Map y inversely: bottom = low freq, top = high freq
                const binIdx = Math.floor(((h - 1 - y) / h) * data.length);
                const v = data[binIdx]; // 0..255
                ctx2d.fillStyle = colorFor(v);
                ctx2d.fillRect(w - 1, y, 1, 1);
            }

            rafRef.current = requestAnimationFrame(draw);
        }

        function colorFor(v: number): string {
            // Simple perceptual ramp: dark blue → cyan → green → yellow → red
            if (v < 1) return '#0a0a14';
            const t = v / 255;
            const h = (1 - t) * 240; // 240 (blue) → 0 (red)
            const s = 80;
            const l = 10 + t * 50;
            return `hsl(${h.toFixed(0)}, ${s}%, ${l.toFixed(0)}%)`;
        }

        function onVisChange() {
            if (document.visibilityState === 'hidden') {
                stoppedRef.current = true;
            } else if (stoppedRef.current) {
                stoppedRef.current = false;
                draw();
            }
        }
        document.addEventListener('visibilitychange', onVisChange);
        setup();

        return () => {
            cancelled = true;
            stoppedRef.current = true;
            document.removeEventListener('visibilitychange', onVisChange);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
            streamRef.current?.getTracks().forEach(t => t.stop());
            streamRef.current = null;
            ctxRef.current?.close().catch(() => {});
            ctxRef.current = null;
            analyserRef.current = null;
            dataRef.current = null;
        };
    }, [minDb, maxDb]);

    // Resize canvas to match container (run once + on window resize)
    useEffect(() => {
        function resize() {
            const c = canvasRef.current;
            if (!c) return;
            const rect = c.getBoundingClientRect();
            if (rect.width > 0 && c.width !== Math.floor(rect.width)) {
                c.width = Math.floor(rect.width);
            }
            if (c.height !== height) c.height = height;
        }
        resize();
        window.addEventListener('resize', resize);
        return () => window.removeEventListener('resize', resize);
    }, [height]);

    return (
        <div style={{ position: 'relative', width: '100%', height }}>
            <canvas
                ref={canvasRef}
                style={{
                    display: 'block',
                    width: '100%',
                    height: '100%',
                    background: '#0a0a14',
                    borderRadius: 8,
                }}
            />
            <div
                style={{
                    position: 'absolute', top: 8, left: 12,
                    color: '#a0a0c0', fontSize: 11, fontFamily: 'ui-monospace, monospace',
                    pointerEvents: 'none',
                }}
            >
                {label} · FFT 2048 · {minDb}..{maxDb} dB
            </div>
        </div>
    );
}
