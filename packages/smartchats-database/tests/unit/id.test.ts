import { describe, it, expect } from 'vitest';
import { RecordId } from 'surrealdb';
import { stringifyRecordId, parseRecordIdArg } from '../../src/id.js';

describe('stringifyRecordId', () => {
    it('passes through canonical strings unchanged', () => {
        expect(stringifyRecordId('todos:abc123')).toBe('todos:abc123');
    });

    it('handles a SurrealDB RecordId class instance via toString()', () => {
        const rid = new RecordId('todos', 'abc123');
        expect(stringifyRecordId(rid)).toBe('todos:abc123');
    });

    it('handles a plain { tb, id } object (cloud JSON round-trip)', () => {
        expect(stringifyRecordId({ tb: 'logs', id: 'xyz' })).toBe('logs:xyz');
    });

    it('handles a plain object with numeric id', () => {
        expect(stringifyRecordId({ tb: 'todos', id: 42 })).toBe('todos:42');
    });

    it('returns null for empty objects (would stringify to "[object Object]")', () => {
        expect(stringifyRecordId({})).toBeNull();
    });

    it('returns null for null / undefined', () => {
        expect(stringifyRecordId(null)).toBeNull();
        expect(stringifyRecordId(undefined)).toBeNull();
    });

    it('returns null for non-string primitives', () => {
        expect(stringifyRecordId(123)).toBeNull();
        expect(stringifyRecordId(true)).toBeNull();
    });
});

describe('parseRecordIdArg', () => {
    it('passes through non-empty strings', () => {
        expect(parseRecordIdArg('todos:abc')).toBe('todos:abc');
    });

    it('trims whitespace', () => {
        expect(parseRecordIdArg('  logs:xyz  ')).toBe('logs:xyz');
    });

    it('rejects empty strings', () => {
        expect(parseRecordIdArg('')).toBeNull();
        expect(parseRecordIdArg('   ')).toBeNull();
    });

    it('rejects non-string inputs (the LLM misfire case)', () => {
        expect(parseRecordIdArg({})).toBeNull();
        expect(parseRecordIdArg({ tb: 'todos', id: 'abc' })).toBeNull();
        expect(parseRecordIdArg(null)).toBeNull();
        expect(parseRecordIdArg(undefined)).toBeNull();
        expect(parseRecordIdArg(42)).toBeNull();
        expect(parseRecordIdArg(true)).toBeNull();
    });
});
