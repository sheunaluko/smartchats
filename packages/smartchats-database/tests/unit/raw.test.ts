import { describe, it, expect } from 'vitest';
import { buildRawQuery, NonReadOnlyQueryError } from '../../src/queries/index.js';

describe('buildRawQuery — allowed read-only forms', () => {
    it('passes SELECT through with its variables', () => {
        const spec = buildRawQuery('SELECT * FROM sessions WHERE label = $l', { l: 'x' });
        expect(spec.query).toBe('SELECT * FROM sessions WHERE label = $l');
        expect(spec.variables).toEqual({ l: 'x' });
    });

    it('allows RETURN and LET (non-mutating)', () => {
        expect(() => buildRawQuery('RETURN 1')).not.toThrow();
        expect(() => buildRawQuery('LET $x = 1')).not.toThrow();
    });

    it('is case-insensitive on the prefix', () => {
        expect(buildRawQuery('select 1').query).toBe('select 1');
    });

    it('trims leading whitespace before both the check and the emitted query', () => {
        expect(buildRawQuery('   SELECT 1').query).toBe('SELECT 1');
    });

    it('defaults variables to an empty object', () => {
        expect(buildRawQuery('SELECT 1').variables).toEqual({});
    });
});

describe('buildRawQuery — rejected mutating forms', () => {
    it.each(['UPDATE x SET y = 1', 'CREATE x', 'DELETE x', 'REMOVE TABLE x', 'INSERT INTO x {}', 'DEFINE TABLE x'])(
        'throws NonReadOnlyQueryError for %s',
        (q) => {
            expect(() => buildRawQuery(q)).toThrow(NonReadOnlyQueryError);
        },
    );
});
