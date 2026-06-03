import { describe, it, expect } from 'vitest';
import { IMPORT_STRIP_FIELDS, buildImportQuery } from '../../src/queries/index.js';

describe('IMPORT_STRIP_FIELDS', () => {
    it('strips both physical timestamp fields (never migrated across DBs)', () => {
        expect(IMPORT_STRIP_FIELDS.has('created_at')).toBe(true);
        expect(IMPORT_STRIP_FIELDS.has('updated_at')).toBe(true);
    });

    it('strips legacy pre-v1.0.0 event-time fields (lts, metrics.timestamp)', () => {
        // Pre-v1.0.0 bundles carry these legacy fields; the importer drops
        // them silently. Conversion to the v1.0.0 shape (deriving ts +
        // local_date + local_tz from lts/timestamp) happens BEFORE the
        // importer, in operations/convert_legacy_bundle.ts.
        expect(IMPORT_STRIP_FIELDS.has('lts')).toBe(true);
        expect(IMPORT_STRIP_FIELDS.has('timestamp')).toBe(true);
    });
});

describe('buildImportQuery — normal record table (UPSERT path)', () => {
    const spec = buildImportQuery('logs', 'k1', {
        id: 'logs:k1',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-02T00:00:00Z',
        owner: 'someone',
        text: 'hello',
    })!;

    it('emits an UPSERT against type::record', () => {
        expect(spec.query.startsWith('UPSERT type::record($table_name, $key)')).toBe(true);
        expect(spec.variables.table_name).toBe('logs');
        expect(spec.variables.key).toBe('k1');
    });

    it('strips id / created_at / updated_at / owner from the payload', () => {
        expect(spec.query).not.toMatch(/created_at\s*=/);
        expect(spec.query).not.toMatch(/updated_at\s*=/);
        expect(spec.query).not.toMatch(/owner\s*=/);
    });

    it('keeps a normal field and binds its value', () => {
        expect(spec.query).toContain('text = $v0');
        expect(spec.variables.v0).toBe('hello');
    });

    it('casts ISO datetime strings with <datetime>', () => {
        // `ts` is the v1.0.0 event-time column; legacy `lts` is now stripped.
        const dt = buildImportQuery('logs', 'k', { ts: '2026-05-30T12:00:00Z' })!;
        expect(dt.query).toContain('ts = <datetime> $v0');
        expect(dt.variables.v0).toBe('2026-05-30T12:00:00Z');
    });

    it('skips fields whose names are not identifier-shaped', () => {
        const q = buildImportQuery('logs', 'k', { 'bad-field': 'x', good: 'y' })!;
        expect(q.query).not.toContain('bad-field');
        expect(q.query).toContain('good = $v0');
    });
});

describe('buildImportQuery — RELATION table (RELATE path)', () => {
    it('routes user_relations to RELATE and splits in/out endpoints', () => {
        const spec = buildImportQuery('user_relations', 'rk', {
            in: 'user_entities:a',
            out: 'user_entities:b',
            name: 'knows',
        })!;
        expect(spec.query).toContain('RELATE');
        expect(spec.variables.in_table).toBe('user_entities');
        expect(spec.variables.in_key).toBe('a');
        expect(spec.variables.out_table).toBe('user_entities');
        expect(spec.variables.out_key).toBe('b');
    });

    it('returns null for a malformed relation row (missing in/out)', () => {
        expect(buildImportQuery('user_relations', 'rk', { name: 'x' })).toBeNull();
    });
});
