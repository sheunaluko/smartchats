import { describe, it, expect } from 'vitest';
import {
    getProceduralInstructions,
    updateProceduralInstruction,
    deleteProceduralInstruction,
    searchProceduralInstructions,
    getInitInstructions,
    updateInitInstruction,
    insertProceduralInstruction,
    insertInitInstruction,
} from '../../src/queries/index.js';

// Both instruction kinds live in the `cortex` table, separated by a type
// predicate, and load in registration order via `lts ASC` so the sequence
// survives bundle export/import.

describe('getProceduralInstructions', () => {
    it('filters to the procedural_instruction type and orders by lts ASC', () => {
        const spec = getProceduralInstructions();
        expect(spec.query).toContain("type = 'procedural_instruction'");
        expect(spec.query).toContain('ORDER BY lts ASC');
    });

    it('adds and binds a category filter when given', () => {
        const spec = getProceduralInstructions({ category: 'tone' });
        expect(spec.query).toContain('category = $category');
        expect(spec.variables.category).toBe('tone');
    });
});

describe('getInitInstructions', () => {
    it('filters to the init type and orders by lts ASC', () => {
        const spec = getInitInstructions();
        expect(spec.query).toContain("type = 'init'");
        expect(spec.query).toContain('ORDER BY lts ASC');
    });
});

describe('updateProceduralInstruction / updateInitInstruction', () => {
    it('returns null when nothing is settable (no patch field, no embedding)', () => {
        expect(updateProceduralInstruction({ recordId: 'cortex:x', patch: {} })).toBeNull();
        expect(updateInitInstruction({ recordId: 'cortex:x', patch: {} })).toBeNull();
    });

    it('strips the record-id prefix into $key', () => {
        const spec = updateProceduralInstruction({ recordId: 'cortex:abc', patch: { content: 'hi' } })!;
        expect(spec.variables.key).toBe('abc');
    });

    it('omits an explicit updated_at — the cortex schema auto-bumps it via VALUE time::now()', () => {
        const spec = updateProceduralInstruction({ recordId: 'cortex:abc', patch: { content: 'hi' } })!;
        expect(spec.query).not.toContain('updated_at');
    });

    it('accepts a sibling embedding as a settable field', () => {
        const spec = updateInitInstruction({ recordId: 'cortex:abc', patch: {}, embedding: [0.1] })!;
        expect(spec.query).toContain('embedding = $embedding');
    });
});

describe('searchProceduralInstructions', () => {
    it('runs a type-scoped KNN search with a default effort of 40', () => {
        const spec = searchProceduralInstructions({ embedding: [0.1], limit: 5 });
        expect(spec.query).toContain("type = 'procedural_instruction'");
        expect(spec.query).toContain('embedding <|5,40|> $embedding');
        expect(spec.query).toContain('ORDER BY distance');
    });
});

describe('deleteProceduralInstruction', () => {
    it('strips the record-id prefix before deleting', () => {
        expect(deleteProceduralInstruction('cortex:abc').variables.key).toBe('abc');
    });
});

describe('insert builders', () => {
    it('tags a procedural instruction with its cortex type', () => {
        const spec = insertProceduralInstruction({ content: 'always greet warmly', category: null, embedding: [0.1] });
        expect(spec.query).toContain("type: 'procedural_instruction'");
    });

    it('tags an init instruction with its cortex type', () => {
        const spec = insertInitInstruction({ content: 'load the weather', category: null, embedding: [0.1] });
        expect(spec.query).toContain("type: 'init'");
    });
});
