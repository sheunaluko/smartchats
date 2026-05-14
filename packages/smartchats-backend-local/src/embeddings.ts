import type { EmbeddingsAPI, EmbedArgs, EmbedResult } from 'smartchats-backend';
import type { LocalBackendOptions } from './backend.js';
import { jsonRequest } from './http.js';

export function createEmbeddingsAPI(opts: LocalBackendOptions): EmbeddingsAPI {
    return {
        async embed({ text, dimensions, session_id }: EmbedArgs): Promise<EmbedResult> {
            return jsonRequest<EmbedResult>(opts, '/embeddings/embed', {
                method: 'POST',
                body: JSON.stringify({
                    text,
                    ...(dimensions && { dimensions }),
                    ...(session_id && { session_id }),
                }),
            });
        },
    };
}
