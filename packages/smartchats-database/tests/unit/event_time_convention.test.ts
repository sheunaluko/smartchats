/**
 * Schema-level tests for the v1.0.0 event-time baseline.
 *
 * v1.0.0 is the clean baseline — no migration history, no legacy lts /
 * metrics.timestamp fields. Every event-time table carries the same
 * required triple: ts (real-UTC datetime), local_date (YYYY-MM-DD
 * string in user's tz), local_tz (IANA string). All required (no
 * `option<...>`).
 *
 * For one-off conversions of pre-v1.0.0 bundles, see
 * operations/convert_legacy_bundle.ts.
 */

import { describe, it, expect } from 'vitest';
import { LOCAL_DDL, LOCAL_SCHEMA_MIGRATIONS, LOCAL_SCHEMA_VERSION } from '../../src/schema/local.js';

// Strict event-time tables: every row carries an event timestamp, so
// ts / local_date / local_tz are REQUIRED (TYPE datetime / TYPE string).
const STRICT_EVENT_TIME_TABLES = [
    'logs',
    'sessions',
    'user_entities',
    'user_relations',
    'metrics',
    'usage_records',
] as const;

// user_data is the type-tagged mixed table — it holds both event-time
// rows (todo, todo_completion) AND pure configuration rows
// (metric_definition, log_category_definition) that have no event-time
// semantic. Event-time fields are OPTIONAL on this table.
const MIXED_TABLE = 'user_data';

describe('event-time convention (LOCAL_SCHEMA_VERSION v1.0.0 baseline)', () => {
    it('schema version is 1.0.0', () => {
        expect(LOCAL_SCHEMA_VERSION).toBe('1.0.0');
    });

    it('migration array is empty (no backfill history at the baseline)', () => {
        expect(LOCAL_SCHEMA_MIGRATIONS).toEqual([]);
    });

    describe('event-time fields are required (non-option) on strict event-time tables', () => {
        for (const table of STRICT_EVENT_TIME_TABLES) {
            it(`${table}.ts is TYPE datetime (not option<datetime>)`, () => {
                expect(LOCAL_DDL).toMatch(
                    new RegExp(`DEFINE FIELD IF NOT EXISTS ts ON ${table} TYPE datetime(?!\\<)`),
                );
            });
            it(`${table}.local_date is TYPE string (required)`, () => {
                expect(LOCAL_DDL).toMatch(
                    new RegExp(`DEFINE FIELD IF NOT EXISTS local_date ON ${table} TYPE string(?!\\<)`),
                );
            });
            it(`${table}.local_tz is TYPE string (required)`, () => {
                expect(LOCAL_DDL).toMatch(
                    new RegExp(`DEFINE FIELD IF NOT EXISTS local_tz ON ${table} TYPE string(?!\\<)`),
                );
            });
        }
    });

    describe(`user_data (mixed table) keeps event-time fields OPTIONAL`, () => {
        it('user_data.ts is option<datetime> (configuration rows like metric_definition lack it)', () => {
            expect(LOCAL_DDL).toMatch(
                new RegExp(`DEFINE FIELD IF NOT EXISTS ts ON ${MIXED_TABLE} TYPE option<datetime>`),
            );
        });
        it('user_data.local_date is option<string>', () => {
            expect(LOCAL_DDL).toMatch(
                new RegExp(`DEFINE FIELD IF NOT EXISTS local_date ON ${MIXED_TABLE} TYPE option<string>`),
            );
        });
        it('user_data.local_tz is option<string>', () => {
            expect(LOCAL_DDL).toMatch(
                new RegExp(`DEFINE FIELD IF NOT EXISTS local_tz ON ${MIXED_TABLE} TYPE option<string>`),
            );
        });
    });

    describe('legacy fields are absent from the v1.0.0 baseline', () => {
        it('no `lts` field on any table', () => {
            expect(LOCAL_DDL).not.toMatch(/DEFINE FIELD IF NOT EXISTS lts ON /);
        });
        it('no `metrics.timestamp` legacy column', () => {
            expect(LOCAL_DDL).not.toMatch(/DEFINE FIELD IF NOT EXISTS timestamp ON metrics/);
        });
        it('no `usage_records.timestamp` legacy column', () => {
            expect(LOCAL_DDL).not.toMatch(/DEFINE FIELD IF NOT EXISTS timestamp ON usage_records/);
        });
    });

    describe('indexes on the event-time bucket key', () => {
        const ALL_TABLES = [...STRICT_EVENT_TIME_TABLES, MIXED_TABLE] as const;
        for (const table of ALL_TABLES) {
            it(`${table} has an index covering local_date`, () => {
                expect(LOCAL_DDL).toMatch(
                    new RegExp(`DEFINE INDEX IF NOT EXISTS \\w+local_date ON ${table} FIELDS [\\w, ]*local_date`),
                );
            });
            it(`${table} has an index covering ts`, () => {
                expect(LOCAL_DDL).toMatch(
                    new RegExp(`DEFINE INDEX IF NOT EXISTS \\w+ts ON ${table} FIELDS [\\w, ]*ts`),
                );
            });
        }
    });
});
