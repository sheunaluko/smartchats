import type { Level } from '../types.js';
import { lintLevel } from './lint.js';
import { buildLevel } from './build.js';
import { unitLevel } from './unit.js';
import { integrationLevel } from './integration.js';
import { e2eLevel } from './e2e.js';

/** All defined levels in run order. */
export const ALL_LEVELS: readonly Level[] = [
    lintLevel,
    buildLevel,
    unitLevel,
    integrationLevel,
    e2eLevel,
];

/** Lookup by short name (`lint`, `build`, etc.) */
export function findLevel(name: string): Level | undefined {
    return ALL_LEVELS.find((l) => l.name === name);
}
