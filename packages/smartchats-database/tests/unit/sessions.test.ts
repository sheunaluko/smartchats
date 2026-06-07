import { describe, it, expect } from 'vitest';
import { listSessions, searchSessions, loadSession } from '../../src/queries/index.js';

describe('listSessions', () => {
    it('defaults the limit to 50', () => {
        expect(listSessions().query).toMatch(/LIMIT 50$/);
    });

    it('orders by ts DESC (real-UTC instant, monotonic across DST and travel)', () => {
        expect(listSessions().query).toContain('ORDER BY ts DESC');
    });

    it('projects the v1.0.0 event-time triple (ts, local_date, local_tz)', () => {
        const q = listSessions().query;
        expect(q).toContain('ts');
        expect(q).toContain('local_date');
        expect(q).toContain('local_tz');
    });

    it('clamps an oversized limit down to 200', () => {
        expect(listSessions({ limit: 9999 }).query).toMatch(/LIMIT 200$/);
    });

    it('clamps a zero/negative limit up to 1', () => {
        expect(listSessions({ limit: 0 }).query).toMatch(/LIMIT 1$/);
        expect(listSessions({ limit: -5 }).query).toMatch(/LIMIT 1$/);
    });
});

describe('searchSessions', () => {
    it('guards NULL labels before lowercasing them (string::lowercase(NULL) would ERR)', () => {
        const { query } = searchSessions({ query: 'foo' });
        expect(query).toContain('label != NONE');
        expect(query.indexOf('label != NONE')).toBeLessThan(query.indexOf('string::lowercase(label)'));
    });

    it('binds the search term as $q', () => {
        expect(searchSessions({ query: 'foo' }).variables).toEqual({ q: 'foo' });
    });

    it('defaults the limit to 20 and clamps oversized to 100', () => {
        expect(searchSessions({ query: 'x' }).query).toMatch(/LIMIT 20$/);
        expect(searchSessions({ query: 'x', limit: 9999 }).query).toMatch(/LIMIT 100$/);
    });
});

describe('loadSession', () => {
    it('strips the table prefix off a full record id', () => {
        expect(loadSession('sessions:abc123').variables.key).toBe('abc123');
    });

    it('returns a bare id unchanged when there is no prefix', () => {
        expect(loadSession('abc123').variables.key).toBe('abc123');
    });

    it('preserves colons inside the key (splits on the first colon only)', () => {
        expect(loadSession('sessions:a:b').variables.key).toBe('a:b');
    });

    it('always targets the sessions table via type::record', () => {
        expect(loadSession('sessions:abc').query).toBe("SELECT * FROM type::record('sessions', $key)");
    });
});
