import { describe, it, expect } from 'vitest';
import { getByoKey, upsertByoKey, deleteByoKey } from '../../src/queries/index.js';

describe('getByoKey', () => {
    it('selects a single provider row and binds the provider name', () => {
        const spec = getByoKey('openai');
        expect(spec.query).toBe('SELECT api_key FROM byo_api_keys WHERE provider = $provider LIMIT 1');
        expect(spec.variables).toEqual({ provider: 'openai' });
    });
});

describe('upsertByoKey', () => {
    it('uses the provider name as the record key so there is one row per provider', () => {
        const spec = upsertByoKey({ provider: 'anthropic', key: 'sk-test' });
        expect(spec.query).toContain("UPSERT type::record('byo_api_keys', $provider)");
        expect(spec.query).toContain('updated_at = time::now()');
        expect(spec.variables).toEqual({ provider: 'anthropic', key: 'sk-test' });
    });
});

describe('deleteByoKey', () => {
    it('deletes the single provider-keyed row', () => {
        const spec = deleteByoKey('google');
        expect(spec.query).toBe("DELETE type::record('byo_api_keys', $provider)");
        expect(spec.variables).toEqual({ provider: 'google' });
    });
});
