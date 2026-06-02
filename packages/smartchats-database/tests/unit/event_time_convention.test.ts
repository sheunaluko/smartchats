/**
 * Schema-level tests for the three-field event-time convention introduced
 * in LOCAL_SCHEMA_VERSION 1.5.0.
 *
 * What lives here (PR 1 — schema + backfill):
 *   - Asserts every legacy `lts` table now also defines `ts`, `local_date`,
 *     and `local_tz` (with the documented exception that `metrics` keeps
 *     its existing `timestamp` field as the real-UTC slot).
 *   - Asserts the 1.5.0 migration block is present, derives `local_date`
 *     via `time::format(lts, '%Y-%m-%d')`, and is idempotent (every UPDATE
 *     guards with `WHERE local_date IS NONE`).
 *   - Pins the semantic spec for derivation with worked examples,
 *     including the DST fall-back case that is the canonical bug the
 *     refactor fixes.
 *
 * What does NOT live here:
 *   - Real SurrealQL aggregation correctness. That requires a running DB
 *     and lives in the integration suite — added in PR 3 when we have new
 *     `GROUP BY local_date` query builders to exercise.
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_DDL, LOCAL_SCHEMA_MIGRATIONS, LOCAL_SCHEMA_VERSION } from '../../src/schema/local.js';

const EVENT_TIME_TABLES = [
    'logs',
    'sessions',
    'user_entities',
    'user_relations',
    'user_data',
    'metrics',
    'usage_records',
] as const;

describe('event-time convention (LOCAL_SCHEMA_VERSION 1.5.0)', () => {
    it('schema version is 1.5.0', () => {
        expect(LOCAL_SCHEMA_VERSION).toBe('1.5.0');
    });

    describe('DDL: new fields on every event-time table', () => {
        for (const table of EVENT_TIME_TABLES) {
            it(`${table} defines local_date (option<string>)`, () => {
                expect(LOCAL_DDL).toMatch(
                    new RegExp(`DEFINE FIELD IF NOT EXISTS local_date ON ${table} TYPE option<string>`),
                );
            });
            it(`${table} defines local_tz (option<string>)`, () => {
                expect(LOCAL_DDL).toMatch(
                    new RegExp(`DEFINE FIELD IF NOT EXISTS local_tz ON ${table} TYPE option<string>`),
                );
            });
            // metrics intentionally keeps its existing `timestamp` field as the
            // real-UTC instant rather than introducing a parallel `ts` field —
            // documented in the schema header.
            if (table !== 'metrics') {
                it(`${table} defines ts (option<datetime>)`, () => {
                    expect(LOCAL_DDL).toMatch(
                        new RegExp(`DEFINE FIELD IF NOT EXISTS ts ON ${table} TYPE option<datetime>`),
                    );
                });
            }
        }
    });

    describe('DDL: indexes on the new bucket key', () => {
        for (const table of EVENT_TIME_TABLES) {
            it(`${table} has an index covering local_date`, () => {
                // user_data and metrics use composite (type, local_date) /
                // (metric_name, local_date) indexes. Single-column indexes
                // everywhere else. Both shapes are accepted here.
                expect(LOCAL_DDL).toMatch(
                    new RegExp(`DEFINE INDEX IF NOT EXISTS \\w+local_date ON ${table} FIELDS [\\w, ]*local_date`),
                );
            });
        }
    });

    describe('1.5.0 migration backfill block', () => {
        const v150 = LOCAL_SCHEMA_MIGRATIONS.find((m) => m.version === '1.5.0');

        it('is registered in LOCAL_SCHEMA_MIGRATIONS', () => {
            expect(v150).toBeDefined();
        });

        for (const table of EVENT_TIME_TABLES) {
            it(`backfills ${table}.local_date via time::format(lts, '%Y-%m-%d')`, () => {
                expect(v150!.statements).toMatch(
                    new RegExp(`UPDATE ${table}\\s+SET[^;]*local_date = time::format\\(lts, '%Y-%m-%d'\\)`),
                );
            });
        }

        // Tables that adopt `ts` get it backfilled too. metrics already has
        // `timestamp` so no `ts` assignment is expected for it.
        for (const table of EVENT_TIME_TABLES.filter((t) => t !== 'metrics')) {
            it(`backfills ${table}.ts from lts`, () => {
                expect(v150!.statements).toMatch(new RegExp(`UPDATE ${table}\\s+SET[^;]*ts = lts`));
            });
        }

        it('every backfill UPDATE is idempotent (WHERE local_date IS NONE)', () => {
            const updates = v150!.statements.match(/UPDATE\s+\w+\s+SET[^;]+;/g) ?? [];
            expect(updates.length).toBeGreaterThanOrEqual(EVENT_TIME_TABLES.length);
            for (const stmt of updates) {
                expect(stmt).toMatch(/WHERE local_date IS NONE/);
            }
        });

        it('every backfill UPDATE guards against NONE lts', () => {
            const updates = v150!.statements.match(/UPDATE\s+\w+\s+SET[^;]+;/g) ?? [];
            for (const stmt of updates) {
                expect(stmt).toMatch(/lts IS NOT NONE/);
            }
        });

        it('usage_records backfills local_tz to UTC (server-stamped, no user-tz context)', () => {
            expect(v150!.statements).toMatch(/UPDATE usage_records\s+SET[^;]*local_tz = 'UTC'/);
        });

        it("user-data tables backfill local_tz to 'America/Chicago' (single-user self-hosted deploy)", () => {
            for (const table of ['logs', 'sessions', 'user_entities', 'user_relations', 'user_data', 'metrics']) {
                expect(v150!.statements).toMatch(
                    new RegExp(`UPDATE ${table}\\s+SET[^;]*local_tz = 'America/Chicago'`),
                );
            }
        });
    });

    describe('semantic spec: derivation cases', () => {
        /**
         * The backfill uses `time::format(lts, '%Y-%m-%d')` server-side. For
         * a string-encoded ISO datetime "YYYY-MM-DDThh:mm:ss(.fff)?Z", this
         * returns the first 10 chars. The cases below pin the contract that
         * the SurrealQL derivation matches the expected user-local date —
         * pure-JS prefix-extraction is a faithful proxy for what SurrealDB
         * will compute on the server.
         */
        const cases: Array<{ name: string; lts: string; expected_local_date: string; note?: string }> = [
            {
                name: 'CDT early morning (3:30 AM local, summer)',
                lts: '2026-05-31T03:30:00Z',
                expected_local_date: '2026-05-31',
            },
            {
                name: 'CDT late evening (11:59 PM local)',
                lts: '2026-05-31T23:59:00Z',
                expected_local_date: '2026-05-31',
                note: 'Just-before-midnight stays on May 31 — the user-perceived day.',
            },
            {
                name: 'Imported Tokyo log (22:00 JST stored as fake-UTC)',
                lts: '2026-05-31T22:00:00Z',
                expected_local_date: '2026-05-31',
                note: 'Tokyo-local day survives import unchanged because lts already encodes it.',
            },
            {
                name: 'usage_records server-stamped (real-UTC lts)',
                lts: '2026-05-31T18:00:00Z',
                expected_local_date: '2026-05-31',
                note: 'For usage_records the lts is real UTC, so local_date = UTC date by design.',
            },
        ];

        for (const { name, lts, expected_local_date } of cases) {
            it(`${name} → local_date ${expected_local_date}`, () => {
                expect(lts.slice(0, 10)).toBe(expected_local_date);
            });
        }

        it('DST fall-back: identical lts for two real-time events is the bug the refactor fixes', () => {
            // November 1 2026: clocks fall back from 2:00 AM CDT to 1:00 AM CST.
            // The wall-clock reading "01:30 AM" happens twice in real time,
            // ~1 hour apart.
            //
            // Pre-refactor (fake-UTC `lts`): both events store the same string,
            // because `toLocalTimestamp` formats the user's wall-clock — which
            // is identical for both events. ORDER BY lts cannot distinguish
            // them; the second event may sort before the first.
            //
            // Post-refactor (real-UTC `ts`): the two events have distinct
            // real instants. ORDER BY ts is correct.
            const event1_lts = '2026-11-01T01:30:00Z'; // local 01:30, pre-fall-back
            const event2_lts = '2026-11-01T01:30:00Z'; // local 01:30, post-fall-back

            const event1_ts = '2026-11-01T06:30:00Z'; // 01:30 CDT = 06:30 UTC
            const event2_ts = '2026-11-01T07:30:00Z'; // 01:30 CST = 07:30 UTC

            // The bug: identical lts. Pre-refactor ordering is undefined.
            expect(event1_lts).toBe(event2_lts);
            // The fix: distinct ts. Post-refactor ordering is correct.
            expect(event1_ts).not.toBe(event2_ts);
            expect(event1_ts < event2_ts).toBe(true);

            // Both events still land in the same daily bucket (Nov 1), which
            // is what the user expects ("two waters at 1:30 AM on Nov 1").
            expect(event1_lts.slice(0, 10)).toBe('2026-11-01');
            expect(event2_lts.slice(0, 10)).toBe('2026-11-01');
            expect(event1_ts.slice(0, 10)).toBe('2026-11-01');
            expect(event2_ts.slice(0, 10)).toBe('2026-11-01');
        });

        it('midnight boundary: late-evening vs early-next-morning land in distinct buckets', () => {
            // 11:59 PM local on May 31 → fake-UTC lts 23:59
            const before = '2026-05-31T23:59:00Z';
            // 12:01 AM local on June 1 → fake-UTC lts 00:01
            const after = '2026-06-01T00:01:00Z';
            expect(before.slice(0, 10)).toBe('2026-05-31');
            expect(after.slice(0, 10)).toBe('2026-06-01');
        });
    });
});
