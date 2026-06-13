/**
 * Hand-geometry calibration — captures real palm + finger + thumb
 * landing points and persists them so the layout can be projected
 * onto the user's actual reach geometry instead of a hardcoded
 * "typical large hand."
 *
 * Captured in viewBox coordinates (same coord system the Keyboard
 * SVG uses) so derived key positions go straight into the layout
 * builder.
 *
 * Three captures:
 *   1. Palm rest      — one tap, the point the rest of the hand
 *                       anchors to
 *   2. Fingers spread — multi-touch capture of all four fingertips
 *                       at comfortable full extension, sorted by
 *                       angle from palm so we know which is which
 *   3. Thumb rest     — one tap, the natural relaxed thumb point
 *
 * From those eight points we derive:
 *   - per-finger angle (slice anchor)
 *   - max reach radius (outer arc)
 *   - mid + inner radii (proportional pullback)
 *   - thumb fan center + sweep range
 */

import { VIEW_HEIGHT, VIEW_WIDTH } from './types';

export interface Point {
    x: number;
    y: number;
}

export interface FingerCapture extends Point {
    angleDeg: number;
    reachPx: number;
}

export interface OnehandCalibration {
    version: 1;
    capturedAt: string; // ISO
    viewWidth: number; // 1600
    viewHeight: number; // 1000
    palm: Point;
    /** Sorted by angle ascending (pinky → ring → middle → index). */
    fingers: {
        pinky: FingerCapture;
        ring: FingerCapture;
        middle: FingerCapture;
        index: FingerCapture;
    };
    thumb: Point;
}

const STORAGE_KEY = 'lab_onehand_calibration_v1';

/** Load saved calibration, or null on first run / corrupted state /
 *  viewBox-dimension mismatch (so e.g. a landscape calibration is
 *  invalidated when the layout switches to portrait). */
export function loadCalibration(): OnehandCalibration | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== 1 || !parsed.palm || !parsed.fingers || !parsed.thumb) {
            return null;
        }
        // Orientation / viewBox-dim mismatch invalidates the cache.
        if (parsed.viewWidth !== VIEW_WIDTH || parsed.viewHeight !== VIEW_HEIGHT) {
            return null;
        }
        return parsed as OnehandCalibration;
    } catch {
        return null;
    }
}

export function saveCalibration(cal: OnehandCalibration): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(cal));
    } catch (err) {
        console.warn('[onehand] saveCalibration failed:', err);
    }
}

export function clearCalibration(): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(STORAGE_KEY);
    } catch {}
}

/** Atan2 wrapper that returns degrees in [0, 360). For viewBox coords
 *  (y grows downward) we flip dy so "up" corresponds to angle 90°. */
export function angleFromPalm(palm: Point, p: Point): number {
    const dx = p.x - palm.x;
    const dy = palm.y - p.y; // flip so screen-up = positive y
    const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
    return (deg + 360) % 360;
}

export function distance(a: Point, b: Point): number {
    const dx = a.x - b.x;
    const dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Build a finalized calibration from raw captures. Sorts the four
 * finger touch points by angle (low → high) and labels them
 * pinky → ring → middle → index, which is the spatial order for a
 * right hand resting palm-low-right with fingers fanning upper-left.
 */
export function buildCalibration(args: { palm: Point; fingers: Point[]; thumb: Point }): OnehandCalibration {
    const { palm, fingers, thumb } = args;
    if (fingers.length !== 4) {
        throw new Error(`Expected 4 finger touches, got ${fingers.length}`);
    }
    const withAngle = fingers.map((f) => ({
        x: f.x,
        y: f.y,
        angleDeg: angleFromPalm(palm, f),
        reachPx: distance(palm, f),
    }));
    // Sort by angle ascending: pinky (lowest angle, closest to palm) →
    // index (highest angle, far upper-left).
    withAngle.sort((a, b) => a.angleDeg - b.angleDeg);
    const [pinky, ring, middle, index] = withAngle;
    return {
        version: 1,
        capturedAt: new Date().toISOString(),
        viewWidth: VIEW_WIDTH,
        viewHeight: VIEW_HEIGHT,
        palm,
        fingers: { pinky, ring, middle, index },
        thumb,
    };
}

// ── Layout-derivation helpers ──────────────────────────────────────────────

export interface ArcGeometry {
    radius: number;
    angleStart: number; // pinky end (low angle)
    angleEnd: number; // index end (high angle)
}

export interface LayoutGeometry {
    palm: Point;
    /** outer = qwertyuiop, middle = asdfghjkl, inner = zxcvbnm */
    outer: ArcGeometry;
    middle: ArcGeometry;
    inner: ArcGeometry;
    thumb: {
        center: Point;
        radius: number;
        angleStart: number;
        angleEnd: number;
    };
    /** Calibrated finger angle anchors — used to assign a finger to each key. */
    fingerAngles: {
        pinky: number;
        ring: number;
        middle: number;
        index: number;
    };
}

/**
 * Derive arc radii and angular ranges from calibration. Outer arc
 * sits just shy of full extension; middle and inner pull back in
 * fixed proportion. Angular range spans pinky→index with a small
 * outward pad so the first/last keys aren't right at the limits.
 */
export function deriveLayoutGeometry(cal: OnehandCalibration): LayoutGeometry {
    const { palm, fingers, thumb } = cal;
    const reaches = [fingers.pinky.reachPx, fingers.ring.reachPx, fingers.middle.reachPx, fingers.index.reachPx];
    const maxReach = Math.max(...reaches);

    // Pull outer arc slightly inside max reach for comfort.
    const outerR = maxReach * 0.94;
    const middleR = maxReach * 0.66;
    const innerR = maxReach * 0.4;

    const ANGLE_PAD = 6; // degrees of cushion past pinky/index angles
    const angleStart = fingers.pinky.angleDeg - ANGLE_PAD; // low angle (right side, near palm)
    const angleEnd = fingers.index.angleDeg + ANGLE_PAD; // high angle (upper-left)

    // Thumb fan: anchor at calibrated thumb point, sweep an arc
    // around it. Range chosen so SPACE sits at the natural rest
    // direction (toward palm) and 5 keys distribute across ±55°.
    const thumbToPalm = {
        x: palm.x - thumb.x,
        y: palm.y - thumb.y,
    };
    const thumbToPalmAngle = (Math.atan2(-thumbToPalm.y, thumbToPalm.x) * 180) / Math.PI;
    // We arrange thumb keys on the arc OPPOSITE the palm direction
    // (so they fan away from where the palm sits — the natural sweep
    // of the right thumb when curled inward).
    const thumbCenterAngle = thumbToPalmAngle + 180;
    const THUMB_SWEEP = 110; // degrees total
    const thumbRadius = Math.max(160, distance(palm, thumb) * 0.75);

    return {
        palm,
        outer: { radius: outerR, angleStart, angleEnd },
        middle: { radius: middleR, angleStart, angleEnd },
        inner: { radius: innerR, angleStart, angleEnd },
        thumb: {
            center: thumb,
            radius: thumbRadius,
            angleStart: thumbCenterAngle - THUMB_SWEEP / 2,
            angleEnd: thumbCenterAngle + THUMB_SWEEP / 2,
        },
        fingerAngles: {
            pinky: fingers.pinky.angleDeg,
            ring: fingers.ring.angleDeg,
            middle: fingers.middle.angleDeg,
            index: fingers.index.angleDeg,
        },
    };
}

/**
 * Default calibration — used as a fallback when none has been
 * captured yet, and as a "seed" so the calibration preview screen
 * has something to render before completion.
 */
export function defaultCalibration(): OnehandCalibration {
    // Portrait iPad: palm rests in lower portion of screen, fingers
    // fan upward with the index reaching upper-left.
    const palm: Point = { x: 720, y: 1380 };
    const fingers = {
        pinky: { x: 800, y: 950, angleDeg: 80, reachPx: 437 },
        ring: { x: 650, y: 820, angleDeg: 100, reachPx: 564 },
        middle: { x: 470, y: 800, angleDeg: 119, reachPx: 626 },
        index: { x: 290, y: 880, angleDeg: 140, reachPx: 662 },
    };
    return {
        version: 1,
        capturedAt: new Date(0).toISOString(),
        viewWidth: VIEW_WIDTH,
        viewHeight: VIEW_HEIGHT,
        palm,
        fingers,
        thumb: { x: 480, y: 1500 },
    };
}
