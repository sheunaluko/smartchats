import { describe, it, expect } from 'vitest';
import {
    loadDynamicFunction,
    listDynamicFunctions,
    updateDynamicFunction,
    deleteDynamicFunction,
} from '../../src/queries/index.js';

describe('loadDynamicFunction', () => {
    it('caps at one row so a duplicate name returns only the first hit', () => {
        const spec = loadDynamicFunction('myFn');
        expect(spec.query).toContain('WHERE name = $name');
        expect(spec.query).toContain('LIMIT 1');
        expect(spec.variables).toEqual({ name: 'myFn' });
    });
});

describe('listDynamicFunctions', () => {
    it('projects the summary fields without a function body', () => {
        const q = listDynamicFunctions().query;
        expect(q).toContain('SELECT name, description, params_schema, id');
        expect(q).not.toContain('code');
    });
});

describe('updateDynamicFunction', () => {
    it('returns null when no whitelisted field and no embedding are present', () => {
        expect(updateDynamicFunction({ name: 'myFn', patch: {} })).toBeNull();
    });

    it('sets the patched field, bumps updated_at, and matches by name', () => {
        // Unlike the cortex instruction tables, cortex_dynamic_functions has no
        // VALUE time::now() clause, so the builder sets updated_at explicitly.
        const spec = updateDynamicFunction({ name: 'myFn', patch: { code: 'return 1' } })!;
        expect(spec.query).toContain('code = $code');
        expect(spec.query).toContain('updated_at = time::now()');
        expect(spec.query).toContain('WHERE name = $name');
    });
});

describe('deleteDynamicFunction', () => {
    it('deletes by name', () => {
        const spec = deleteDynamicFunction('myFn');
        expect(spec.query).toContain('DELETE FROM cortex_dynamic_functions');
        expect(spec.variables).toEqual({ name: 'myFn' });
    });
});
