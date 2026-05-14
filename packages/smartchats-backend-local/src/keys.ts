import type { KeysAPI, BYOKeys, BYOKeyPreviews, LLMProvider } from 'smartchats-backend';
import type { LocalBackendOptions } from './backend.js';
import { jsonRequest } from './http.js';

export function createKeysAPI(opts: LocalBackendOptions): KeysAPI {
    return {
        async save(keys: BYOKeys): Promise<{ configured: LLMProvider[] }> {
            const body = await jsonRequest<{ configured: LLMProvider[]; warning?: string }>(
                opts,
                '/keys',
                { method: 'POST', body: JSON.stringify({ keys }) },
            );
            return { configured: body.configured ?? [] };
        },

        async delete(provider: LLMProvider): Promise<void> {
            await jsonRequest<{ ok: boolean }>(opts, `/keys/${provider}`, { method: 'DELETE' });
        },

        async getConfigured(): Promise<BYOKeyPreviews> {
            return jsonRequest<BYOKeyPreviews>(opts, '/keys', { method: 'GET' });
        },
    };
}
