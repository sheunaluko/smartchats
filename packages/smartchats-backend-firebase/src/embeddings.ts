import type { EmbeddingsAPI, EmbedArgs, EmbedResult, BillingEnvelope } from 'smartchats-backend';
import { BackendError } from 'smartchats-backend';
import { httpsCallable } from 'firebase/functions';
import type { FirebaseBackendOptions } from './backend.js';

function wrapCallableError(fn: string, err: unknown): never {
    const message = (err as { message?: string })?.message || 'unknown error';
    throw new BackendError('server_error', `${fn} failed: ${message}`, true, err);
}

export function createEmbeddingsAPI(opts: FirebaseBackendOptions): EmbeddingsAPI {
    const openaiEmbedding_fn = httpsCallable<
        { text: string; dimensions?: number; session_id?: string },
        { success: boolean; embedding: number[]; model: string; dimensions: number; billing?: BillingEnvelope }
    >(opts.functions, 'openaiEmbedding');

    return {
        async embed({ text, dimensions }: EmbedArgs): Promise<EmbedResult> {
            try {
                const result = await openaiEmbedding_fn({
                    text,
                    ...(dimensions && { dimensions }),
                });
                const data = result.data;
                // Dispatch billing update for the live balance UI
                if (data.billing && typeof window !== 'undefined') {
                    window.dispatchEvent(new CustomEvent('smartchats:billing_update', { detail: data.billing }));
                }
                return {
                    embedding: data.embedding,
                    model: data.model,
                    dimensions: data.dimensions,
                    billing: data.billing,
                };
            } catch (err) {
                wrapCallableError('embeddings.embed', err);
            }
        },
    };
}
