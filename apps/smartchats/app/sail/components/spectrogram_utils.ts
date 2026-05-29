/**
 * Shared display helpers for the 2D and 3D spectrograms.
 *
 * Both visualizations turn a `Uint8Array` of FFT magnitudes into pixels
 * (2D) or vertices (3D) using identical knobs: linear-vs-log frequency
 * axis + a min/max display range in Hz. Centralizing the mapping math
 * here keeps the two renderers behaviorally consistent — when the user
 * toggles between modes the same band of audio lights up.
 */

export type FreqScale = 'linear' | 'log';

/** Below this normalized peak magnitude, treat as silence (no pitch). */
export const PITCH_CONFIDENCE_FLOOR = 0.18;

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** Convert a frequency to "Note + octave + cents" (e.g. "A4 +12¢"). */
export function hzToNoteName(hz: number): string {
    if (hz <= 0) return '—';
    const midi = 69 + 12 * Math.log2(hz / 440);
    const rounded = Math.round(midi);
    const cents = Math.round((midi - rounded) * 100);
    const noteIdx = ((rounded % 12) + 12) % 12;
    const octave = Math.floor(rounded / 12) - 1;
    const sign = cents >= 0 ? '+' : '';
    return `${NOTE_NAMES[noteIdx]}${octave} ${sign}${cents}¢`;
}

/**
 * Find the dominant pitch in `[minHz, maxHz]` from a byte FFT magnitude
 * array. Peak-pick + parabolic interpolation for sub-bin precision +
 * a harmonic-rescue pass that prefers a lower-freq local peak when its
 * magnitude is at least `harmonicRescueThreshold` × the global peak.
 *
 * Why the rescue: bright vowels often put more energy in the 2nd/3rd
 * harmonic than in F0, so naive argmax tracks the harmonic and reports
 * an octave (or two) above the real pitch. The rescue trades a bit of
 * stability for being correct on the fundamental most of the time;
 * default 0.3 is a common-sense threshold (the F0 only needs to be 1/3
 * the strength of its biggest harmonic to win). Pass 0 to disable.
 *
 * Returns null when the chosen peak is below the confidence floor
 * (silence, unvoiced consonant, breath).
 */
export function detectPitch(
    data: Uint8Array,
    fftSize: number,
    sampleRate: number,
    minHz: number,
    maxHz: number,
    harmonicRescueThreshold: number = 0.3,
    /** Contrast exponent (≥1) applied to each bin before rescue + parabolic
     *  interp. Confidence check still uses raw magnitudes so silence
     *  detection isn't affected. Argmax is preserved under monotonic
     *  contrast, so the raw global peak is found first; rescue + interp
     *  then operate on the contrasted scale. */
    contrast: number = 1,
): { pitchHz: number; confidence: number } | null {
    const binHz = sampleRate / fftSize;
    const minBin = Math.max(1, Math.floor(minHz / binHz));
    const maxBin = Math.min((fftSize / 2) - 2, Math.ceil(maxHz / binHz));
    if (maxBin <= minBin) return null;

    // Argmax on raw data — contrast is monotonic for v ≥ 0, so applying it
    // wouldn't change the argmax. Cheaper to find raw peak then convert.
    let peakBin = -1;
    let peakRaw = 0;
    for (let i = minBin; i <= maxBin; i++) {
        if (data[i] > peakRaw) { peakRaw = data[i]; peakBin = i; }
    }
    const confidence = peakRaw / 255;
    if (peakBin < 0 || confidence < PITCH_CONFIDENCE_FLOOR) return null;

    // Contrast curve — applied BEFORE the rescue scan so a harmonic that's
    // only marginally louder than F0 gets cut down to size before the
    // rescue ratio is evaluated. At contrast=1 this is a no-op.
    const applyContrast = contrast !== 1;
    const getVal = applyContrast
        ? (raw: number) => Math.pow(raw / 255, contrast) * 255
        : (raw: number) => raw;

    // Harmonic rescue — scan strictly LEFT of the global peak for the
    // lowest local maximum whose contrasted magnitude is ≥
    // threshold × contrasted(peak). Local-max gate (≥ both neighbors)
    // avoids latching onto a noise bin that just crosses the threshold.
    if (harmonicRescueThreshold > 0 && peakBin > minBin + 1) {
        const peakC = getVal(peakRaw);
        const floor = peakC * harmonicRescueThreshold;
        for (let i = minBin + 1; i < peakBin; i++) {
            const v = getVal(data[i]);
            const vPrev = getVal(data[i - 1]);
            const vNext = getVal(data[i + 1]);
            if (v >= floor && v >= vPrev && v >= vNext) {
                peakBin = i;
                break; // lowest match wins — that's the F0 candidate
            }
        }
    }

    // Parabolic interp around the chosen bin, on the same (contrasted) scale
    // we used to pick it. Sub-bin precision so the marker doesn't jitter
    // between adjacent columns when the true pitch lies between two bins.
    let refinedBin = peakBin;
    if (peakBin > minBin && peakBin < maxBin) {
        const y1 = getVal(data[peakBin - 1]);
        const y2 = getVal(data[peakBin]);
        const y3 = getVal(data[peakBin + 1]);
        const denom = (y1 - 2 * y2 + y3);
        if (denom !== 0) {
            const offset = 0.5 * (y1 - y3) / denom;
            if (Math.abs(offset) < 1) refinedBin = peakBin + offset;
        }
    }
    return { pitchHz: refinedBin * binHz, confidence };
}

/**
 * Build a fast index function that maps a display position `t ∈ [0,1]`
 * to an FFT bin index, respecting linear vs log scale and the
 * configured Hz cutoffs. Use the returned function inside per-frame
 * paint loops — the heavy math (log clamps, bin bounds) is hoisted out.
 */
export function makeBinMapper(
    scale: FreqScale,
    minHz: number,
    maxHz: number,
    sampleRate: number,
    fftSize: number,
): (t: number) => number {
    const binCount = fftSize / 2;
    const binHz = sampleRate / fftSize;
    // Clamp + sanitize: never let minBin hit 0 (log undefined) and ensure
    // maxBin > minBin so the mapper produces a non-degenerate range.
    let minBin = Math.max(1, Math.floor(minHz / binHz));
    let maxBin = Math.min(binCount - 1, Math.ceil(maxHz / binHz));
    if (maxBin <= minBin) maxBin = Math.min(binCount - 1, minBin + 1);

    if (scale === 'log') {
        const lnMin = Math.log(minBin);
        const lnMax = Math.log(maxBin);
        const span = lnMax - lnMin;
        return (t: number) => Math.round(Math.exp(lnMin + Math.max(0, Math.min(1, t)) * span));
    } else {
        const span = maxBin - minBin;
        return (t: number) => Math.round(minBin + Math.max(0, Math.min(1, t)) * span);
    }
}
