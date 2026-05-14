import type { KeysAPI, BYOKeys, BYOKeyPreviews, LLMProvider } from 'smartchats-backend';
import { BackendError } from 'smartchats-backend';
import { httpsCallable } from 'firebase/functions';
import type { FirebaseBackendOptions } from './backend.js';

function wrapCallableError(fn: string, err: unknown): never {
    const message = (err as { message?: string })?.message || 'unknown error';
    throw new BackendError('server_error', `${fn} failed: ${message}`, true, err);
}

export function createKeysAPI(opts: FirebaseBackendOptions): KeysAPI {
    const saveBYOKeys_fn = httpsCallable<
        { keys: BYOKeys },
        { configured: LLMProvider[] }
    >(opts.functions, 'saveBYOKeys');

    const deleteBYOKey_fn = httpsCallable<
        { provider: LLMProvider },
        { ok: boolean }
    >(opts.functions, 'deleteBYOKey');

    const getBalance_fn = httpsCallable<
        Record<string, never>,
        { byoKeys?: Partial<Record<LLMProvider, string | null>> }
    >(opts.functions, 'getBalance');

    return {
        async save(keys: BYOKeys): Promise<{ configured: LLMProvider[] }> {
            try {
                const result = await saveBYOKeys_fn({ keys });
                return { configured: result.data.configured ?? [] };
            } catch (err) {
                wrapCallableError('keys.save', err);
            }
        },

        async delete(provider: LLMProvider): Promise<void> {
            try {
                await deleteBYOKey_fn({ provider });
            } catch (err) {
                wrapCallableError('keys.delete', err);
            }
        },

        /**
         * No dedicated cloud fn — piggyback on getBalance which carries
         * masked key previews (`sk-****1234` or null per provider).
         */
        async getConfigured(): Promise<BYOKeyPreviews> {
            try {
                const result = await getBalance_fn({});
                const raw = result.data.byoKeys ?? {};
                return {
                    openai: raw.openai ?? null,
                    anthropic: raw.anthropic ?? null,
                    google: raw.google ?? null,
                };
            } catch (err) {
                wrapCallableError('keys.getConfigured', err);
            }
        },
    };
}
