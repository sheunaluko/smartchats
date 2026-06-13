/**
 * Hand-reach map: a sandbox to record where each part of the right
 * hand actually lands on the screen. Step-by-step capture (palm,
 * thumb, index, middle, ring, pinky) produces a structured map we
 * can inspect and use to drive later layout decisions.
 */

export type FingerKey = 'palm' | 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

export const FINGER_ORDER: FingerKey[] = ['palm', 'thumb', 'index', 'middle', 'ring', 'pinky'];

export const FINGER_LABELS: Record<FingerKey, string> = {
    palm: 'Palm',
    thumb: 'Thumb',
    index: 'Index finger',
    middle: 'Middle finger',
    ring: 'Ring finger',
    pinky: 'Pinky',
};

export const FINGER_COLORS: Record<FingerKey, string> = {
    palm: '#e8e8e8',
    thumb: '#f0c060',
    index: '#5fb3d4',
    middle: '#84c66e',
    ring: '#e8729c',
    pinky: '#a884e8',
};

export interface TouchPoint {
    /** Viewport-relative x in CSS pixels. */
    x: number;
    /** Viewport-relative y in CSS pixels. */
    y: number;
    /** Half-width of the touch ellipse if Safari exposes it; 0 otherwise. */
    radiusX: number;
    radiusY: number;
    /** Milliseconds since the current step started recording. */
    tRel: number;
}

export interface HandMap {
    version: 1;
    capturedAt: string;
    viewportW: number;
    viewportH: number;
    orientation: 'portrait' | 'landscape';
    devicePixelRatio: number;
    fingers: Record<FingerKey, TouchPoint[]>;
}

export interface FingerStats {
    count: number;
    bbox: { minX: number; minY: number; maxX: number; maxY: number } | null;
    centroid: { x: number; y: number } | null;
    /** Average touch radius across captured points (helpful for palm). */
    avgRadius: number;
}

export function emptyHandMap(): HandMap {
    return {
        version: 1,
        capturedAt: '',
        viewportW: 0,
        viewportH: 0,
        orientation: 'portrait',
        devicePixelRatio: 1,
        fingers: {
            palm: [],
            thumb: [],
            index: [],
            middle: [],
            ring: [],
            pinky: [],
        },
    };
}

export function computeStats(points: TouchPoint[]): FingerStats {
    if (points.length === 0) {
        return { count: 0, bbox: null, centroid: null, avgRadius: 0 };
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let sumX = 0;
    let sumY = 0;
    let sumR = 0;
    for (const p of points) {
        if (p.x < minX) minX = p.x;
        if (p.y < minY) minY = p.y;
        if (p.x > maxX) maxX = p.x;
        if (p.y > maxY) maxY = p.y;
        sumX += p.x;
        sumY += p.y;
        sumR += (p.radiusX + p.radiusY) / 2;
    }
    const n = points.length;
    return {
        count: n,
        bbox: { minX, minY, maxX, maxY },
        centroid: { x: sumX / n, y: sumY / n },
        avgRadius: sumR / n,
    };
}
