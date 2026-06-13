/**
 * Audio + visual feedback engine.
 *
 * iOS Safari does not expose the Vibration API, so audio is the
 * tactile substitute. Each finger gets a distinct timbre (different
 * fundamental frequency); each column within a finger gets a small
 * pitch shift so the ear can hear "which-of-two" without looking.
 *
 * One persistent AudioContext, lazy-started on first user gesture
 * (browser autoplay policy). All clicks are synthesized on the fly
 * via short ADSR envelopes on an OscillatorNode — no sample files,
 * no decode time, sub-frame latency on iPadOS Safari.
 */

import { FingerName } from './types';

let _ctx: AudioContext | null = null;

function ensureCtx(): AudioContext | null {
    if (typeof window === 'undefined') return null;
    if (_ctx) return _ctx;
    const Ctor = (window as any).AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    _ctx = new Ctor();
    return _ctx;
}

/** Wake the AudioContext on the first user gesture so subsequent
 *  clicks fire without latency. iOS Safari requires a user-gesture
 *  call before any audio plays. */
export function primeAudio(): void {
    const ctx = ensureCtx();
    if (!ctx) return;
    if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
    }
}

// Per-finger base frequencies. Picked so adjacent fingers are
// audibly distinguishable but not painful — roughly an octave span
// across all five.
const FINGER_BASE_HZ: Record<FingerName, number> = {
    thumb: 110,
    index: 220,
    middle: 320,
    ring: 480,
    pinky: 720,
};

interface ClickOpts {
    finger: FingerName;
    /** 0..1 — within-finger variation so column-1 vs column-2 sound different */
    columnTone?: number;
    /** Stereo pan, -1 (left) to 1 (right) */
    pan?: number;
    /** Loudness, 0..1 */
    gain?: number;
}

/**
 * Play a short percussive click. Synthesis: a sine oscillator with
 * a 6ms attack and ~80ms exponential decay. Fast enough to feel
 * "tactile," not so long it muds adjacent taps.
 */
export function playClick(opts: ClickOpts): void {
    const ctx = ensureCtx();
    if (!ctx || ctx.state !== 'running') {
        primeAudio();
        if (!ctx || ctx.state !== 'running') return;
    }

    const base = FINGER_BASE_HZ[opts.finger];
    const tone = opts.columnTone ?? 0;
    const freq = base * (1 + tone * 0.08); // ±8% within-finger detune

    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = freq;

    const env = ctx.createGain();
    const peak = (opts.gain ?? 0.4);
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(peak, t0 + 0.006);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);

    let last: AudioNode = env;
    // Optional pan (StereoPanner not supported on older Safari — guard).
    const panVal = opts.pan ?? 0;
    if (panVal !== 0 && typeof (ctx as any).createStereoPanner === 'function') {
        const pan = (ctx as any).createStereoPanner();
        pan.pan.value = Math.max(-1, Math.min(1, panVal));
        env.connect(pan);
        last = pan;
    }

    osc.connect(env);
    last.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.1);
}

/** Different sound for a backspace — lower, slightly bowed. */
export function playBackspace(): void {
    const ctx = ensureCtx();
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(180, t0);
    osc.frequency.exponentialRampToValueAtTime(90, t0 + 0.12);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.4, t0 + 0.008);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.14);
    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.16);
}

/** Hard-rejection thunk for taps that fall in dead-space (no key). */
export function playReject(): void {
    const ctx = ensureCtx();
    if (!ctx || ctx.state !== 'running') return;
    const t0 = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 60;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.05, t0 + 0.004);
    env.gain.exponentialRampToValueAtTime(0.001, t0 + 0.06);
    osc.connect(env);
    env.connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + 0.07);
}
