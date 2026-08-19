/**
 * Golden snapshots of every query builder's emitted SurrealQL.
 *
 * Builders are pure — args in, `{ query, variables }` out, no I/O — which
 * makes them cheap to snapshot exhaustively. The value shows up on the
 * next schema change: instead of hand-migrating assertions across a dozen
 * files, you run `vitest -u` and read one diff. That diff IS the
 * migration, and it's reviewable in a way that scattered `toContain`
 * calls are not.
 *
 * These do NOT replace the assertion-style tests alongside them. A
 * snapshot ratifies whatever the builder currently emits, bug and all, so
 * it can only tell you something CHANGED — never that the new output is
 * correct. The hand-written tests carry the intent (why weekly buckets
 * take both halves from the ISO calendar, why local_date is cast to
 * <string>); the snapshots catch drift the intent tests don't cover.
 * Review a snapshot diff, don't just accept it.
 */

import { describe, it, expect } from 'vitest';
import * as builders from '../../src/queries/index.js';
import { BUILDER_FIXTURES, NON_BUILDER_EXPORTS } from './builder_fixtures.js';

/** Every exported function that should have a golden snapshot. */
const exportedBuilders = Object.entries(builders)
    .filter(([name, value]) => typeof value === 'function' && !NON_BUILDER_EXPORTS.has(name))
    .map(([name]) => name)
    .sort();

describe('builder snapshot coverage', () => {
    it('has a fixture for every exported builder', () => {
        // Guards the gap that bit `event_time_binding_casts.test.ts`, which
        // lists its builders by explicit import: a builder added later is
        // silently uncovered. Here, adding an export without a fixture
        // fails this test and tells you exactly which one is missing.
        const missing = exportedBuilders.filter(name => !(name in BUILDER_FIXTURES));
        expect(missing).toEqual([]);
    });

    it('has no fixture for a builder that no longer exists', () => {
        const known = new Set([...exportedBuilders, ...NON_BUILDER_EXPORTS]);
        const stale = Object.keys(BUILDER_FIXTURES).filter(name => !known.has(name));
        expect(stale).toEqual([]);
    });
});

describe('builder golden snapshots', () => {
    for (const name of exportedBuilders) {
        it(`${name} emits stable SurrealQL`, () => {
            const fixture = BUILDER_FIXTURES[name];
            if (!fixture) return; // coverage test above reports this properly
            expect(fixture()).toMatchSnapshot();
        });
    }
});
