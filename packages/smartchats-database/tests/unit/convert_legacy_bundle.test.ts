/**
 * Unit tests for the one-shot legacy bundle converter.
 *
 * Pre-v1.0.0 bundles have `lts` (and `metrics.timestamp`) but lack the
 * v1.0.0 event-time triple. `convertLegacyBundle` derives the new
 * fields and strips the legacy ones so the result imports cleanly into
 * a v1.0.0 destination.
 */

import { describe, it, expect } from 'vitest';
import { convertLegacyBundle } from '../../src/operations/convert_legacy_bundle.js';
import type { Bundle } from '../../src/operations/types.js';

function legacyBundle(tables: Bundle['tables']): Bundle {
    return {
        version: 1,
        exportedAt: '2026-05-01T00:00:00Z',
        source: 'cloud',
        userId: 'test-user',
        tables,
        // No schemaVersion — simulates pre-v1.0.0 export.
    };
}

describe('convertLegacyBundle', () => {
    describe('user-data tables (lts was fake-UTC local wall-clock)', () => {
        const bundle = legacyBundle({
            logs: [
                {
                    id: 'logs:abc',
                    content: 'hello',
                    lts: '2026-05-30T08:00:00Z',
                    local_tz: 'America/Chicago',
                },
            ],
        });
        const result = convertLegacyBundle(bundle);

        it('marks the bundle as legacy', () => {
            expect(result.wasLegacy).toBe(true);
        });

        it('sets schemaVersion to 1.0.0', () => {
            expect(result.bundle.schemaVersion).toBe('1.0.0');
        });

        it('derives ts from lts', () => {
            const row = (result.bundle.tables.logs as Array<Record<string, unknown>>)[0];
            expect(row.ts).toBe('2026-05-30T08:00:00Z');
        });

        it('derives local_date as the YYYY-MM-DD prefix of lts', () => {
            const row = (result.bundle.tables.logs as Array<Record<string, unknown>>)[0];
            expect(row.local_date).toBe('2026-05-30');
        });

        it('preserves local_tz when present on the legacy row', () => {
            const row = (result.bundle.tables.logs as Array<Record<string, unknown>>)[0];
            expect(row.local_tz).toBe('America/Chicago');
        });

        it('strips the legacy lts field', () => {
            const row = (result.bundle.tables.logs as Array<Record<string, unknown>>)[0];
            expect(row.lts).toBeUndefined();
        });
    });

    describe('metrics (legacy carried BOTH lts=fake-UTC AND timestamp=real-UTC)', () => {
        const result = convertLegacyBundle(legacyBundle({
            metrics: [
                {
                    id: 'metrics:m1',
                    metric_name: 'water',
                    value: 2,
                    lts: '2026-05-30T08:00:00Z',
                    timestamp: '2026-05-30T13:00:00Z',
                    local_tz: 'America/Chicago',
                },
            ],
        }));

        it('prefers the real-UTC timestamp for the v1.0.0 ts field', () => {
            const row = (result.bundle.tables.metrics as Array<Record<string, unknown>>)[0];
            expect(row.ts).toBe('2026-05-30T13:00:00Z');
        });

        it('derives local_date from the legacy lts (which encoded user-local)', () => {
            const row = (result.bundle.tables.metrics as Array<Record<string, unknown>>)[0];
            expect(row.local_date).toBe('2026-05-30');
        });

        it('strips both legacy fields (lts + timestamp)', () => {
            const row = (result.bundle.tables.metrics as Array<Record<string, unknown>>)[0];
            expect(row.lts).toBeUndefined();
            expect(row.timestamp).toBeUndefined();
        });
    });

    describe('usage_records (legacy lts was real-UTC, server-stamped)', () => {
        const result = convertLegacyBundle(legacyBundle({
            usage_records: [
                {
                    id: 'usage_records:u1',
                    lts: '2026-05-30T13:00:00Z',
                    model: 'gpt-5.5',
                    provider: 'openai',
                },
            ],
        }));

        it('ts = lts (legacy was already real-UTC)', () => {
            const row = (result.bundle.tables.usage_records as Array<Record<string, unknown>>)[0];
            expect(row.ts).toBe('2026-05-30T13:00:00Z');
        });

        it('local_date = YYYY-MM-DD prefix of lts (UTC date — matches v1.0.0 usage_records convention)', () => {
            const row = (result.bundle.tables.usage_records as Array<Record<string, unknown>>)[0];
            expect(row.local_date).toBe('2026-05-30');
        });

        it("local_tz = 'UTC' regardless of input", () => {
            const row = (result.bundle.tables.usage_records as Array<Record<string, unknown>>)[0];
            expect(row.local_tz).toBe('UTC');
        });
    });

    describe('non-event-time tables pass through unchanged', () => {
        it('app_data rows are not modified', () => {
            const result = convertLegacyBundle(legacyBundle({
                app_data: [{ id: 'app_data:x', payload: { hello: 'world' } }],
            }));
            const row = (result.bundle.tables.app_data as Array<Record<string, unknown>>)[0];
            expect(row.id).toBe('app_data:x');
            expect(row.payload).toEqual({ hello: 'world' });
        });
    });

    describe('default tz', () => {
        it('falls back to America/Chicago when row lacks local_tz', () => {
            const result = convertLegacyBundle(legacyBundle({
                logs: [{ id: 'logs:x', lts: '2026-05-30T08:00:00Z' }],
            }));
            const row = (result.bundle.tables.logs as Array<Record<string, unknown>>)[0];
            expect(row.local_tz).toBe('America/Chicago');
        });

        it('honors assumedTz option override', () => {
            const result = convertLegacyBundle(
                legacyBundle({ logs: [{ id: 'logs:x', lts: '2026-05-30T08:00:00Z' }] }),
                { assumedTz: 'Asia/Tokyo' },
            );
            const row = (result.bundle.tables.logs as Array<Record<string, unknown>>)[0];
            expect(row.local_tz).toBe('Asia/Tokyo');
        });
    });

    describe('idempotency on v1.0.0 bundles', () => {
        it('passes through a v1.0.0 bundle unchanged', () => {
            const v1: Bundle = {
                version: 1,
                exportedAt: '2026-06-03T00:00:00Z',
                source: 'local',
                userId: 'test-user',
                schemaVersion: '1.0.0',
                tables: {
                    logs: [{ id: 'logs:x', ts: '2026-06-03T08:00:00Z', local_date: '2026-06-03', local_tz: 'America/Chicago' }],
                },
            };
            const result = convertLegacyBundle(v1);
            expect(result.wasLegacy).toBe(false);
            expect(result.bundle).toBe(v1); // same reference, no work done
        });
    });

    describe('rows missing derivation source', () => {
        it('skips event-time-table rows without lts (no way to derive)', () => {
            const result = convertLegacyBundle(legacyBundle({
                logs: [
                    { id: 'logs:ok',  content: 'ok',  lts: '2026-05-30T08:00:00Z' },
                    { id: 'logs:bad', content: 'bad' }, // no lts
                ],
            }));
            expect((result.bundle.tables.logs as unknown[]).length).toBe(1);
            const log = result.perTable.find((t) => t.table === 'logs')!;
            expect(log.converted).toBe(1);
            expect(log.skipped).toBe(1);
        });
    });
});
