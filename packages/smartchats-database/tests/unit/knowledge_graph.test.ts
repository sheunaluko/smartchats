import { describe, it, expect } from 'vitest';
import { buildKnowledgeInsertQuery, searchEntitiesByName } from '../../src/queries/index.js';
import type { EventTimeFields } from '../../src/types.js';

describe('buildKnowledgeInsertQuery', () => {
    const eventTime: EventTimeFields = {
        ts: '2026-05-30T17:00:00Z',
        local_date: '2026-05-30',
        local_tz: 'America/Chicago',
    };
    const args = {
        entities: [{ name: 'Alice', embedding: [0.1, 0.2] }],
        relations: [{ name: 'knows', sourceName: 'Alice', targetName: 'Bob', kind: 'social', embedding: [0.3] }],
        ...eventTime,
    };
    const spec = buildKnowledgeInsertQuery(args);

    it('creates entities with inlined embedding', () => {
        expect(spec.query).toContain('CREATE user_entities CONTENT { name: "Alice"');
        expect(spec.query).toContain('embedding: [0.1,0.2]');
    });

    it('writes the v1.0.0 event-time triple on entities', () => {
        expect(spec.query).toContain("ts: d'2026-05-30T17:00:00Z'");
        expect(spec.query).toContain('local_date: "2026-05-30"');
        expect(spec.query).toContain('local_tz: "America/Chicago"');
        expect(spec.query).not.toContain('lts:');
    });

    it('denormalizes both endpoint names onto the relation edge', () => {
        expect(spec.query).toContain('RELATE');
        expect(spec.query).toContain('sourceName: "Alice"');
        expect(spec.query).toContain('targetName: "Bob"');
        expect(spec.query).toContain('name: "knows"');
        expect(spec.query).toContain('kind: "social"');
    });

    it('writes the same event-time triple on relations', () => {
        const relateIdx = spec.query.indexOf('RELATE');
        const after = spec.query.slice(relateIdx);
        expect(after).toContain("ts: d'2026-05-30T17:00:00Z'");
        expect(after).toContain('local_date: "2026-05-30"');
        expect(after).toContain('local_tz: "America/Chicago"');
    });

    it('inlines embeddings rather than binding them (variables stay empty)', () => {
        expect(spec.variables).toEqual({});
    });

    it('emits just a terminator when there is nothing to insert', () => {
        expect(buildKnowledgeInsertQuery({ entities: [], relations: [], ...eventTime }).query).toBe(';');
    });
});

describe('searchEntitiesByName', () => {
    it('guards NULL names before lowercasing them', () => {
        const { query } = searchEntitiesByName({ query: 'Foo' });
        expect(query).toContain('name != NONE');
        expect(query.indexOf('name != NONE')).toBeLessThan(query.indexOf('string::lowercase(name)'));
    });

    it('lowercases the bound search term', () => {
        expect(searchEntitiesByName({ query: 'Foo' }).variables).toEqual({ search: 'foo' });
    });

    it('defaults the limit to 20 and clamps oversized to 100', () => {
        expect(searchEntitiesByName({ query: 'x' }).query).toMatch(/LIMIT 20$/);
        expect(searchEntitiesByName({ query: 'x', limit: 9999 }).query).toMatch(/LIMIT 100$/);
    });
});
