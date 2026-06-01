import { describe, it, expect } from 'vitest';
import {
    listLogs,
    searchLogsSemantic,
    updateLog,
    getLogCategories,
} from '../../src/queries/index.js';

describe('listLogs', () => {
    it('defaults the limit to 20 and clamps it to the 1..100 range', () => {
        expect(listLogs({}).query).toMatch(/LIMIT 20$/);
        expect(listLogs({ limit: 9999 }).query).toMatch(/LIMIT 100$/);
        expect(listLogs({ limit: 0 }).query).toMatch(/LIMIT 1$/);
    });

    it('sorts by lts DESC so order survives bundle export/import', () => {
        expect(listLogs({}).query).toContain('ORDER BY lts DESC');
    });

    it('emits no WHERE clause for a bare recent-N query', () => {
        expect(listLogs({}).query).not.toContain('WHERE');
    });

    it('guards content type before lowercasing it — logs is SCHEMALESS and content may be NONE or a non-string', () => {
        const { query } = listLogs({ searchText: 'foo' });
        expect(query).toContain('type::is_string(content)');
        expect(query.indexOf('type::is_string(content)')).toBeLessThan(query.indexOf('string::lowercase(content)'));
    });

    it('trims and binds the search term as $search_text', () => {
        expect(listLogs({ searchText: '  foo  ' }).variables.search_text).toBe('foo');
    });

    it('lowercases the category filter before binding it', () => {
        expect(listLogs({ category: 'Work' }).variables.category).toBe('work');
    });

    it('falls back to a "true" baseline when only an lts fragment is present', () => {
        const { query } = listLogs({ ltsFilter: " AND lts >= d'2026-01-01T00:00:00Z'" });
        expect(query).toContain('WHERE true');
        expect(query).toContain("AND lts >= d'2026-01-01T00:00:00Z'");
    });
});

describe('searchLogsSemantic', () => {
    it('builds the KNN operator with the row count and a default effort of 40', () => {
        const spec = searchLogsSemantic({ embedding: [0.1], limit: 5 });
        expect(spec.query).toContain('embedding <|5,40|> $embedding');
        expect(spec.query).toContain('ORDER BY distance');
    });

    it('honors a custom effort', () => {
        expect(searchLogsSemantic({ embedding: [0.1], limit: 5, effort: 80 }).query).toContain('embedding <|5,80|>');
    });

    it('adds a category predicate as a second-stage filter', () => {
        const spec = searchLogsSemantic({ embedding: [0.1], limit: 5, category: 'health' });
        expect(spec.query).toContain('category = $category');
        expect(spec.variables.category).toBe('health');
    });
});

describe('updateLog', () => {
    it('returns null when the patch sets nothing', () => {
        expect(updateLog({ recordId: 'logs:x', patch: {} })).toBeNull();
    });

    it('strips the record-id prefix into $log_id and always bumps updated_at', () => {
        const spec = updateLog({ recordId: 'logs:abc', patch: { content: 'hi' } })!;
        expect(spec.variables.log_id).toBe('abc');
        expect(spec.query).toContain('updated_at = time::now()');
    });

    it('casts an lts patch to datetime', () => {
        const spec = updateLog({ recordId: 'logs:abc', patch: { lts: '2026-05-30T12:00:00Z' } })!;
        expect(spec.query).toContain('lts = <datetime> $lts');
    });
});

describe('getLogCategories', () => {
    it('aggregates counts per category, most-used first', () => {
        expect(getLogCategories().query).toBe(
            'SELECT category, count() AS count FROM logs GROUP BY category ORDER BY count DESC',
        );
    });
});
