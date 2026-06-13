/**
 * Grid keyboard layout primitives.
 *
 * Keys are positioned in normalized percentages of the container so
 * the keyboard expands to fill any orientation or container size —
 * portrait, landscape, tablet, laptop — without per-orientation
 * forks. The variant just decides where each key sits as a fraction
 * of the available area.
 */

export type GridKeyKind = 'letter' | 'command';

export interface GridKeyDef {
    id: string;
    primary: string;
    kind: GridKeyKind;
    /** Left edge in percentage of container width [0..100]. */
    leftPct: number;
    /** Top edge in percentage of container height [0..100]. */
    topPct: number;
    /** Width in percentage of container width. */
    widthPct: number;
    /** Height in percentage of container height. */
    heightPct: number;
}

export interface GridLayout {
    id: string;
    name: string;
    blurb: string;
    keys: GridKeyDef[];
}
