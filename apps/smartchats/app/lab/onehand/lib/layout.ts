/**
 * QWERTY-mirrored 3-arc layout, projected onto the user's calibrated
 * hand geometry and adjusted by per-row tunings.
 *
 *   outer arc → Q W E R T Y U I O P ⌫     (BACK at the right end)
 *   middle arc → A S D F G H J K L ⏎      (ENTER at the right end)
 *   inner arc  → Z X C V B N M ⇧           (SHIFT at the right end)
 *   thumb     → SPACE only, at the calibrated thumb point
 *
 * BACK / ENTER / SHIFT live where QWERTY mental-model already puts
 * them (right of P, L, M respectively) — same finger zone (pinky
 * area) as their physical-keyboard equivalents.
 *
 * Tunings rigid-shift each row (offsetX/Y), scale the angular span
 * (spacingScale) and key radius (sizeScale) so the user can fine-tune
 * after calibration without redoing the hand-geometry capture.
 */

import { OnehandCalibration, LayoutGeometry, deriveLayoutGeometry } from './calibration';
import {
    CommandKeyTuning,
    LayoutTunings,
    RowTuning,
    defaultTunings,
} from './tunings';
import { FingerName, KeyDef, KeyKind, VIEW_HEIGHT, VIEW_WIDTH } from './types';

export const LAYOUT_ID = 'qwerty_arc';
export const LAYOUT_REV = 3;

// Letter+command row composition. Last item per row is the command
// at QWERTY's natural position. SPACE lives on the thumb.
const ROW_OUTER = ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'BACK'];
const ROW_MIDDLE = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'ENTER'];
const ROW_INNER = ['Z', 'X', 'C', 'V', 'B', 'N', 'M', 'SHIFT'];
const COMMAND_LABELS = new Set(['SPACE', 'BACK', 'ENTER', 'SHIFT']);

function isCommandLabel(label: string): boolean {
    return COMMAND_LABELS.has(label);
}

function polar(cx: number, cy: number, r: number, angleDeg: number): { x: number; y: number } {
    const rad = (angleDeg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy - r * Math.sin(rad) };
}

function assignFinger(angleDeg: number, geometry: LayoutGeometry): FingerName {
    const fa = geometry.fingerAngles;
    const candidates: Array<[FingerName, number]> = [
        ['pinky', fa.pinky],
        ['ring', fa.ring],
        ['middle', fa.middle],
        ['index', fa.index],
    ];
    let best: FingerName = 'pinky';
    let bestGap = Infinity;
    for (const [name, fingerAngle] of candidates) {
        const gap = Math.abs(angleDeg - fingerAngle);
        if (gap < bestGap) {
            bestGap = gap;
            best = name;
        }
    }
    return best;
}

function keyRadiusForArc(arcRadius: number, angularSpanDeg: number, keyCount: number): number {
    if (keyCount <= 0) return 60;
    const arcLengthPx = (arcRadius * (angularSpanDeg * Math.PI)) / 180;
    const slotPx = arcLengthPx / keyCount;
    return Math.max(28, (slotPx * 0.82) / 2);
}

function buildArcKeys(
    items: string[],
    arc: 'outer' | 'middle' | 'inner',
    geometry: LayoutGeometry,
    tuning: RowTuning,
): KeyDef[] {
    const arcGeom = geometry[arc];
    const n = items.length;
    const baseSpan = arcGeom.angleEnd - arcGeom.angleStart;
    const span = baseSpan * tuning.spacingScale;
    const centerAngle = (arcGeom.angleEnd + arcGeom.angleStart) / 2;
    const tunedStart = centerAngle - span / 2;
    const tunedEnd = centerAngle + span / 2;
    const keyR = keyRadiusForArc(arcGeom.radius, span, n) * tuning.sizeScale;
    const cx = geometry.palm.x + tuning.offsetX;
    const cy = geometry.palm.y + tuning.offsetY;
    const out: KeyDef[] = [];
    for (let i = 0; i < n; i++) {
        const t = n === 1 ? 0.5 : i / (n - 1);
        const angle = tunedEnd - (tunedEnd - tunedStart) * t;
        const { x, y } = polar(cx, cy, arcGeom.radius, angle);
        const finger = assignFinger(angle, geometry);
        const primary = items[i];
        const kind: KeyKind = isCommandLabel(primary) ? 'command' : 'letter';
        out.push({
            id: `${arc}_${i}`,
            finger,
            arc,
            kind,
            primary,
            x,
            y,
            r: keyR,
        });
    }
    return out;
}

const SPACE_BASE_RADIUS = 84;

function buildSpaceKey(geometry: LayoutGeometry, tuning: CommandKeyTuning): KeyDef {
    const center = geometry.thumb.center;
    return {
        id: 'thumb_space',
        finger: 'thumb',
        arc: 'thumb',
        kind: 'command',
        primary: 'SPACE',
        x: center.x + tuning.offsetX,
        y: center.y + tuning.offsetY,
        r: SPACE_BASE_RADIUS * tuning.sizeScale,
    };
}

export interface BuiltLayout {
    keys: KeyDef[];
    geometry: LayoutGeometry;
    palmDeadzoneRadius: number;
}

export function buildLayout(cal: OnehandCalibration, tunings: LayoutTunings = defaultTunings()): BuiltLayout {
    const geometry = deriveLayoutGeometry(cal);
    const keys = [
        ...buildArcKeys(ROW_OUTER, 'outer', geometry, tunings.outer),
        ...buildArcKeys(ROW_MIDDLE, 'middle', geometry, tunings.middle),
        ...buildArcKeys(ROW_INNER, 'inner', geometry, tunings.inner),
        buildSpaceKey(geometry, tunings.space),
    ];
    const palmDeadzoneRadius = geometry.inner.radius * 0.32;
    return { keys, geometry, palmDeadzoneRadius };
}

/**
 * Touch hit-test. Generous radius (1.35× the visual key radius)
 * gives forgiving tap targets without overlap.
 */
export function hitTestKey(
    keys: KeyDef[],
    palmDeadzone: { x: number; y: number; r: number },
    vx: number,
    vy: number,
): KeyDef | null {
    const dpx = vx - palmDeadzone.x;
    const dpy = vy - palmDeadzone.y;
    if (dpx * dpx + dpy * dpy < palmDeadzone.r * palmDeadzone.r) {
        return null;
    }
    let best: KeyDef | null = null;
    let bestDist = Infinity;
    for (const key of keys) {
        const dx = vx - key.x;
        const dy = vy - key.y;
        const d2 = dx * dx + dy * dy;
        const cutoff = key.r * 1.35;
        if (d2 < cutoff * cutoff && d2 < bestDist) {
            best = key;
            bestDist = d2;
        }
    }
    return best;
}

export function normalize(vx: number, vy: number): { x: number; y: number } {
    return { x: vx / VIEW_WIDTH, y: vy / VIEW_HEIGHT };
}
