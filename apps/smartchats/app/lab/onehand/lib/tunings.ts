/**
 * Layout fine-tuning layer.
 *
 * Calibration captures *hand geometry* (palm, fingertip landings,
 * thumb rest). Tunings then ride on top of that to let the user
 * nudge each row independently — shift it, widen the spacing, scale
 * the keys — after seeing how the calibrated default actually feels.
 *
 * Saved separately from the calibration so re-calibrating doesn't
 * wipe the user's tuning preferences, and so we can ship UI-driven
 * fine adjustments without ever asking the user to re-do the
 * (slower) hand-geometry capture.
 */

import { VIEW_HEIGHT, VIEW_WIDTH } from './types';

/** Adjustments applied to a whole letter row (outer / middle / inner). */
export interface RowTuning {
    /** Rigid X offset in viewBox units. */
    offsetX: number;
    /** Rigid Y offset in viewBox units. */
    offsetY: number;
    /** Multiplier on the auto-computed angular span — wider spreads keys further apart. */
    spacingScale: number;
    /** Multiplier on the auto-computed key radius. */
    sizeScale: number;
}

/** Adjustments applied to a single command key (SPACE). */
export interface CommandKeyTuning {
    offsetX: number;
    offsetY: number;
    sizeScale: number;
}

export interface LayoutTunings {
    version: 1;
    viewWidth: number;
    viewHeight: number;
    outer: RowTuning;
    middle: RowTuning;
    inner: RowTuning;
    space: CommandKeyTuning;
}

const STORAGE_KEY = 'lab_onehand_tunings_v1';

export function defaultRowTuning(): RowTuning {
    return { offsetX: 0, offsetY: 0, spacingScale: 1, sizeScale: 1 };
}

export function defaultCommandTuning(): CommandKeyTuning {
    return { offsetX: 0, offsetY: 0, sizeScale: 1 };
}

export function defaultTunings(): LayoutTunings {
    return {
        version: 1,
        viewWidth: VIEW_WIDTH,
        viewHeight: VIEW_HEIGHT,
        outer: defaultRowTuning(),
        middle: defaultRowTuning(),
        inner: defaultRowTuning(),
        space: defaultCommandTuning(),
    };
}

export function loadTunings(): LayoutTunings {
    if (typeof window === 'undefined') return defaultTunings();
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return defaultTunings();
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 1) return defaultTunings();
        // Orientation mismatch — discard so default applies on the new viewBox.
        if (parsed.viewWidth !== VIEW_WIDTH || parsed.viewHeight !== VIEW_HEIGHT) {
            return defaultTunings();
        }
        return {
            version: 1,
            viewWidth: parsed.viewWidth,
            viewHeight: parsed.viewHeight,
            outer: { ...defaultRowTuning(), ...parsed.outer },
            middle: { ...defaultRowTuning(), ...parsed.middle },
            inner: { ...defaultRowTuning(), ...parsed.inner },
            space: { ...defaultCommandTuning(), ...parsed.space },
        };
    } catch {
        return defaultTunings();
    }
}

export function saveTunings(tunings: LayoutTunings): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(tunings));
    } catch (err) {
        console.warn('[onehand] saveTunings failed:', err);
    }
}

export function clearTunings(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
}
