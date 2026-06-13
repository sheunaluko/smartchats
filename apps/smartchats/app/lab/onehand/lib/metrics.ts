/**
 * Live HUD math — rolling WPM and accuracy from an in-memory tap log.
 *
 * Pure functions on a tap array. Kept stateless so callers (the
 * Keyboard / HUD components) can hold the array however they like
 * and recompute on each render without worrying about side effects.
 */

import { TapEvent } from './types';

/**
 * Net WPM over the most recent `windowMs` milliseconds of taps.
 * "Net" applies the standard 5×-per-error correction so a burst of
 * backspaces tanks the number — matches the QWERTY-research
 * convention for a single trustworthy throughput scalar.
 *
 * Returns 0 when there's not enough data (no committing taps in
 * the window).
 */
export function rollingNetWpm(taps: TapEvent[], nowMs: number, windowMs = 10_000): number {
    if (taps.length === 0) return 0;
    const cutoff = nowMs - windowMs;
    let chars = 0;
    let errors = 0;
    let firstTs = Infinity;
    let lastTs = -Infinity;
    for (const t of taps) {
        if (t.t_rel_ms < cutoff) continue;
        if (t.is_backspace) {
            errors += 1;
            continue;
        }
        if (t.committed_char.length === 0) continue;
        chars += 1;
        if (t.t_rel_ms < firstTs) firstTs = t.t_rel_ms;
        if (t.t_rel_ms > lastTs) lastTs = t.t_rel_ms;
    }
    if (chars === 0) return 0;
    const minutes = Math.max(lastTs - firstTs, 1) / 60_000;
    if (minutes <= 0) return 0;
    const netChars = Math.max(0, chars - 5 * errors);
    return netChars / 5 / minutes;
}

/**
 * Accuracy across the most recent N taps: 1 − (backspaces / total).
 * Bounded sample so it stays responsive when the user changes pace.
 */
export function rollingAccuracy(taps: TapEvent[], sample = 60): number {
    if (taps.length === 0) return 1;
    const slice = taps.slice(-sample);
    const errors = slice.filter((t) => t.is_backspace).length;
    return Math.max(0, 1 - errors / slice.length);
}
