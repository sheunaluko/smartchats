import { describe, it, expect } from 'vitest';
import { buildKnowledgeInsertQuery, searchEntitiesByName } from '../../src/queries/index.js';

describe('buildKnowledgeInsertQuery', () => {
    const spec = buildKnowledgeInsertQuery({
        entities: [{ name: 'Alice', embedding: [0.1, 0.2] }],
        relations: [{ name: 'knows', sourceName: 'Alice', targetName: 'Bob', kind: 'social', embedding: [0.3] }],
        lts: '2026-05-30T12:00:00Z',
    });

    it('creates entities with inlined embedding and a fake-UTC lts', () => {
        expect(spec.query).toContain('CREATE user_entities CONTENT { name: "Alice"');
        expect(spec.query).toContain('embedding: [0.1,0.2]');
        expect(spec.query).toContain("lts: d'2026-05-30T12:00:00Z'");
    });

    it('denormalizes both endpoint names onto the relation edge', () => {
        expect(spec.query).toContain('RELATE');
        expect(spec.query).toContain('sourceName: "Alice"');
        expect(spec.query).toContain('targetName: "Bob"');
        expect(spec.query).toContain('name: "knows"');
        expect(spec.query).toContain('kind: "social"');
    });

    it('inlines embeddings rather than binding them (variables stay empty)', () => {
        expect(spec.variables).toEqual({});
    });

    it('emits just a terminator when there is nothing to insert', () => {
        expect(buildKnowledgeInsertQuery({ entities: [], relations: [], lts: '2026-05-30T12:00:00Z' }).query).toBe(';');
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
