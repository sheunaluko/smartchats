import { describe, it, expect } from 'vitest';
import { listUsageRecords, getUsageRecordsSince, insertUsageRecord } from '../../src/queries/index.js';

describe('listUsageRecords', () => {
    it('orders by ts DESC so the newest call is the first row of page one', () => {
        expect(listUsageRecords({ limit: 25 }).query).toContain('ORDER BY ts DESC');
    });

    it('binds the page size as $limit', () => {
        const spec = listUsageRecords({ limit: 25 });
        expect(spec.query).toMatch(/LIMIT \$limit$/);
        expect(spec.variables).toEqual({ limit: 25 });
    });

    it('adds the cursor predicate and binds it when startAfter is given', () => {
        const spec = listUsageRecords({ limit: 10, startAfter: '2026-05-01T00:00:00Z' });
        expect(spec.query).toContain('WHERE ts < <datetime> $startAfter');
        expect(spec.variables.startAfter).toBe('2026-05-01T00:00:00Z');
    });

    it('omits the cursor entirely on the first page', () => {
        const spec = listUsageRecords({ limit: 10 });
        expect(spec.query).not.toContain('WHERE');
        expect(spec.variables.startAfter).toBeUndefined();
    });
});

describe('getUsageRecordsSince', () => {
    it('casts the bound since value to a datetime', () => {
        const spec = getUsageRecordsSince('2026-05-01T00:00:00Z');
        expect(spec.query).toContain('ts >= <datetime> $since');
        expect(spec.variables).toEqual({ since: '2026-05-01T00:00:00Z' });
    });
});

describe('insertUsageRecord', () => {
    const base = {
        model: 'gpt-4o',
        provider: 'openai',
        inputTokens: 10,
        outputTokens: 20,
        cachedInputTokens: 5,
        costUsd: 0.001,
        requestType: 'llm',
    };

    it('omits session_id when null — SurrealDB option<string> rejects a bound NULL and ERRs the whole CREATE', () => {
        const spec = insertUsageRecord({ ...base, sessionId: null });
        expect(spec.query).not.toContain('session_id');
        expect(spec.variables.sid).toBeUndefined();
    });

    it('sets and binds session_id when present', () => {
        const spec = insertUsageRecord({ ...base, sessionId: 'sessions:abc' });
        expect(spec.query).toContain('session_id = $sid');
        expect(spec.variables.sid).toBe('sessions:abc');
    });

    it('stamps the self-hosted observability constants (no credits charged, local origin)', () => {
        const spec = insertUsageRecord({ ...base, sessionId: null });
        expect(spec.query).toContain('credits_charged = 0');
        expect(spec.query).toContain("charged_from = 'local'");
    });

    it('server-stamps the event-time triple, bucketing by UTC day', () => {
        // The local server has no user-tz context, so usage rows bucket by UTC
        // day by design; local_tz = 'UTC' is what documents that on the row.
        const spec = insertUsageRecord({ ...base, sessionId: null });
        expect(spec.query).toContain('ts = time::now()');
        expect(spec.query).toContain("local_date = time::format(time::now(), '%Y-%m-%d')");
        expect(spec.query).toContain("local_tz = 'UTC'");
    });

    it('binds the token and cost fields under their short names', () => {
        const spec = insertUsageRecord({ ...base, sessionId: null });
        expect(spec.variables).toMatchObject({
            model: 'gpt-4o',
            provider: 'openai',
            in: 10,
            out: 20,
            cached: 5,
            cost: 0.001,
            type: 'llm',
        });
    });
});
