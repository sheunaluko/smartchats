import { describe, it, expect } from 'vitest';
import { probeTableExists } from '../../src/queries/index.js';

describe('probeTableExists', () => {
    it('binds the table name through type::table and caps at one row', () => {
        const spec = probeTableExists('sessions');
        expect(spec.query).toBe('SELECT * FROM type::table($t) LIMIT 1');
        expect(spec.variables).toEqual({ t: 'sessions' });
    });
});
