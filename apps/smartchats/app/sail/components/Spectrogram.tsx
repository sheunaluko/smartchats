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
import { makeBinMapper, type FreqScale } from './spectrogram_utils';

type Props = {
    /** Optional CSS height in px; if omitted, fills the parent container. */
    height?: number;
    /** dB floor — values below this clip to background. Default -100. */
    minDb?: number;
    /** dB ceiling — values above this clip to max color. Default -10. */
    maxDb?: number;
    /** Optional title shown in the top-left of the canvas. */
    label?: string;
    /** Frequency axis scale: linear (default) or log. */
    scale?: FreqScale;
    /** Lower display bound in Hz. Default 0. */
    minFreqHz?: number;
    /** Upper display bound in Hz. Default Nyquist (auto). */
    maxFreqHz?: number;
    /** Scroll-rate multiplier. 1 = one column per animation frame (default). */
    speed?: number;
    /** FFT window size. Must be a power of 2 (Web Audio spec). Default 2048
     *  → ~23 Hz/bin at 48 kHz. Larger = finer freq resolution but slower time
     *  response. Valid: 32..32768. */
    fftSize?: number;
    /** Contrast curve exponent. Raises the normalized (0-1) magnitude to
     *  this power before color mapping. 1 = linear (no change), 2 = squared
     *  (suppresses lows), 3 = cubed (strong suppression of background hiss).
     *  Endpoints (0 and 1) stay fixed. */
    contrast?: number;
};

export function Spectrogram({
    height, minDb = -100, maxDb = -10, label = 'Microphone',
    scale = 'linear', minFreqHz = 0, maxFreqHz = 24000, speed = 1, fftSize = 2048,
    contrast = 1,
}: Props) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null);
    const ctxRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const streamRef = useRef<MediaStream | null>(null);
    const rafRef = useRef<number | null>(null);
    const dataRef = useRef<Uint8Array | null>(null);
    const stoppedRef = useRef(false);

    // Live-tunable knobs — refs so the rAF loop picks up new values
    // without tearing down the mic stream.
    const scaleRef = useRef<FreqScale>(scale);
    const minHzRef = useRef(minFreqHz);
    const maxHzRef = useRef(maxFreqHz);
    const speedRef = useRef(speed);
    const contrastRef = useRef(contrast);
    useEffect(() => { scaleRef.current = scale; }, [scale]);
    useEffect(() => { minHzRef.current = minFreqHz; }, [minFreqHz]);
    useEffect(() => { maxHzRef.current = maxFreqHz; }, [maxFreqHz]);
    useEffect(() => { speedRef.current = speed; }, [speed]);
    useEffect(() => { contrastRef.current = contrast; }, [contrast]);

    // Live fftSize updates — reset AnalyserNode + reallocate the frequency
    // data buffer. Web Audio resets internal FFT state on assignment;
    // smoothing kicks back in within a few frames.
    useEffect(() => {
        const a = analyserRef.current;
        if (!a) return;
        try {
            a.fftSize = fftSize;
            dataRef.current = new Uint8Array(new ArrayBuffer(a.frequencyBinCount));
        } catch (err) {
            console.warn('[sail/spectrogram] invalid fftSize, keeping previous', fftSize, err);
        }
    }, [fftSize]);

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
                analyser.fftSize = fftSize;
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

        let scrollAccum = 0; // accumulates `speed` per frame; scroll when ≥ 1
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

            scrollAccum += speedRef.current;
            if (scrollAccum < 1) {
                // Not enough budget this frame — skip painting, keep rAF
                rafRef.current = requestAnimationFrame(draw);
                return;
            }
            // Consume exactly one column-step. Capping prevents catch-up
            // blasts on tab-resume that would jump the display forward.
            scrollAccum = Math.min(scrollAccum, 2) - 1;

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

            // Build bin mapper for this frame's scale + freq range.
            const sr = ctxRef.current?.sampleRate ?? 48000;
            const mapper = makeBinMapper(scaleRef.current, minHzRef.current, maxHzRef.current, sr, analyser.fftSize);

            // Draw new column at the right edge. Apply contrast curve to
            // suppress background noise when contrast > 1.
            const p = contrastRef.current;
            const applyContrast = p !== 1;
            for (let y = 0; y < h; y++) {
                // Map y inversely: bottom = low freq, top = high freq
                const t = (h - 1 - y) / Math.max(1, h - 1);
                const binIdx = mapper(t);
                let v = data[binIdx]; // 0..255
                if (applyContrast) v = Math.pow(v / 255, p) * 255;
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

    // Resize canvas to match container — uses ResizeObserver so the
    // canvas tracks flex-layout changes (e.g. collapsing siblings) without
    // relying on a fixed `height` prop. Falls back to the prop value if
    // no observation has happened yet.
    useEffect(() => {
        const c = canvasRef.current;
        if (!c) return;
        const ro = new ResizeObserver(entries => {
            const entry = entries[0];
            if (!entry) return;
            const w = Math.floor(entry.contentRect.width);
            const h = Math.floor(entry.contentRect.height);
            if (w > 0 && c.width !== w) c.width = w;
            if (h > 0 && c.height !== h) c.height = h;
        });
        ro.observe(c.parentElement ?? c);
        return () => ro.disconnect();
    }, []);

    return (
        <div style={{ position: 'relative', width: '100%', height: height ?? '100%' }}>
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
                {label} · FFT {fftSize} · {minDb}..{maxDb} dB
            </div>
        </div>
    );
}
