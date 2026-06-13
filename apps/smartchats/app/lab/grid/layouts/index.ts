/**
 * Five distinct grid-keyboard variants the user can switch between
 * in-app to feel out which arrangement works best for their hand
 * and grip.
 *
 *  A · classic       — straight QWERTY 3 rows + full-width SPACE
 *  B · thumb_left    — letters above, big SPACE on the left of a command row
 *  C · left_rail     — SPACE as a tall column on the left edge
 *  D · with_numbers  — adds a top number row to classic
 *  E · compact_right — Classic pinned to the right 65% (one-hand reach)
 *
 * All five share the same QWERTY mental model. Only the placement
 * of SPACE / BACK / ENTER / SHIFT (and the optional number row)
 * differs.
 */

import { GridKeyDef, GridKeyKind, GridLayout } from './types';

const COMMAND_LABELS = new Set(['SPACE', 'BACK', 'ENTER', 'SHIFT']);
const isCmd = (label: string): GridKeyKind => (COMMAND_LABELS.has(label) ? 'command' : 'letter');

/** Distribute `items` evenly across a row band. */
function row(
    items: string[],
    top: number,
    height: number,
    opts: { leftOffset?: number; totalWidth?: number; prefix?: string } = {},
): GridKeyDef[] {
    const leftOffset = opts.leftOffset ?? 0;
    const totalWidth = opts.totalWidth ?? 100;
    const prefix = opts.prefix ?? '';
    const each = totalWidth / items.length;
    return items.map((label, i) => ({
        id: `${prefix}${label.toLowerCase()}_${i}`,
        primary: label,
        kind: isCmd(label),
        leftPct: leftOffset + i * each,
        topPct: top,
        widthPct: each,
        heightPct: height,
    }));
}

// ─── A · Classic ──────────────────────────────────────────────────────────
// Q-P plus BACK on top, A-L plus ENTER on home, SHIFT-Z-...-M on bottom
// letter row, full-width SPACE at the bottom. Closest to muscle memory.
const CLASSIC: GridLayout = {
    id: 'classic',
    name: 'Classic',
    blurb: 'Standard QWERTY rows with a full-width space bar.',
    keys: [
        ...row(['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'BACK'], 0, 25),
        ...row(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'ENTER'], 25, 25),
        ...row(['SHIFT', 'Z', 'X', 'C', 'V', 'B', 'N', 'M'], 50, 25),
        ...row(['SPACE'], 75, 25),
    ],
};

// ─── B · Thumb-Left SPACE ─────────────────────────────────────────────────
// Letter-only rows above, dedicated command row at the bottom with a wide
// SPACE on the left (60%) so the right-hand thumb hits it without reaching.
const THUMB_LEFT: GridLayout = {
    id: 'thumb_left',
    name: 'Thumb-Left',
    blurb: 'Wide space bar on the left side of a dedicated command row.',
    keys: [
        ...row(['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], 0, 25),
        ...row(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'], 25, 25),
        ...row(['Z', 'X', 'C', 'V', 'B', 'N', 'M'], 50, 25),
        { id: 'space', primary: 'SPACE', kind: 'command', leftPct: 0, topPct: 75, widthPct: 60, heightPct: 25 },
        { id: 'enter', primary: 'ENTER', kind: 'command', leftPct: 60, topPct: 75, widthPct: 13.33, heightPct: 25 },
        { id: 'shift', primary: 'SHIFT', kind: 'command', leftPct: 73.33, topPct: 75, widthPct: 13.33, heightPct: 25 },
        { id: 'back', primary: 'BACK', kind: 'command', leftPct: 86.66, topPct: 75, widthPct: 13.34, heightPct: 25 },
    ],
};

// ─── C · Left Rail SPACE ──────────────────────────────────────────────────
// SPACE is a tall vertical column on the left edge — the right-hand thumb
// hits it without any letter-row interference. Other commands wrap the
// SPACE column. Letters get the right 84%.
const LEFT_RAIL: GridLayout = {
    id: 'left_rail',
    name: 'Left Rail',
    blurb: 'Vertical space column on the left edge, letters on the right.',
    keys: [
        { id: 'back', primary: 'BACK', kind: 'command', leftPct: 0, topPct: 0, widthPct: 16, heightPct: 14 },
        { id: 'space', primary: 'SPACE', kind: 'command', leftPct: 0, topPct: 14, widthPct: 16, heightPct: 56 },
        { id: 'enter', primary: 'ENTER', kind: 'command', leftPct: 0, topPct: 70, widthPct: 16, heightPct: 14 },
        { id: 'shift', primary: 'SHIFT', kind: 'command', leftPct: 0, topPct: 84, widthPct: 16, heightPct: 16 },
        ...row(['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'], 0, 33.33, { leftOffset: 16, totalWidth: 84 }),
        ...row(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L'], 33.33, 33.33, { leftOffset: 16, totalWidth: 84 }),
        ...row(['Z', 'X', 'C', 'V', 'B', 'N', 'M'], 66.66, 33.34, { leftOffset: 16, totalWidth: 84 }),
    ],
};

// ─── D · With Numbers ─────────────────────────────────────────────────────
// Classic plus a top numeric row. Useful whenever the user is typing
// addresses, codes, or anything mixed-numeric — no layer toggle needed.
const WITH_NUMBERS: GridLayout = {
    id: 'with_numbers',
    name: 'Numbers',
    blurb: 'Classic plus a number row across the top.',
    keys: [
        ...row(['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], 0, 20),
        ...row(['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'BACK'], 20, 20),
        ...row(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'ENTER'], 40, 20),
        ...row(['SHIFT', 'Z', 'X', 'C', 'V', 'B', 'N', 'M'], 60, 20),
        ...row(['SPACE'], 80, 20),
    ],
};

// ─── E · Compact-Right ────────────────────────────────────────────────────
// Same as Classic but the whole keyboard hugs the right 65% of the
// container, leaving an empty margin on the left so a one-handed
// right-side grip doesn't have to reach across.
const COMPACT_RIGHT: GridLayout = {
    id: 'compact_right',
    name: 'Compact ▶',
    blurb: 'Classic keys pinned to the right 65% — easier one-hand reach.',
    keys: [
        ...row(['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P', 'BACK'], 0, 25, { leftOffset: 35, totalWidth: 65 }),
        ...row(['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'ENTER'], 25, 25, { leftOffset: 35, totalWidth: 65 }),
        ...row(['SHIFT', 'Z', 'X', 'C', 'V', 'B', 'N', 'M'], 50, 25, { leftOffset: 35, totalWidth: 65 }),
        ...row(['SPACE'], 75, 25, { leftOffset: 35, totalWidth: 65 }),
    ],
};

export const LAYOUTS: GridLayout[] = [CLASSIC, THUMB_LEFT, LEFT_RAIL, WITH_NUMBERS, COMPACT_RIGHT];

export const LAYOUTS_BY_ID: Record<string, GridLayout> = Object.fromEntries(
    LAYOUTS.map((l) => [l.id, l]),
);

export const DEFAULT_LAYOUT_ID = CLASSIC.id;
