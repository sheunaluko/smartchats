import type {
    LLMAPI,
    LLMCallArgs,
    LLMStreamResult,
    LLMTTSExtras,
    LLMTTSStreamResult,
} from 'smartchats-backend';
import {
    BackendError,
    postStream,
    toServerArgs,
    createLLMStreamResult,
    createLLMTTSStreamResult,
} from 'smartchats-backend';
import type { FirebaseBackendOptions } from './backend.js';

async function authHeaders(opts: FirebaseBackendOptions): Promise<Record<string, string>> {
    const token = await opts.getIdToken();
    if (!token) throw new BackendError('invalid_request', 'No auth token — user must be signed in for LLM calls');
    return {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
    };
}

export function createLLMAPI(opts: FirebaseBackendOptions): LLMAPI {
    const llmStreamUrl = `${opts.httpStreamBaseUrl}/llmStreamHttp`;
    const llmTtsStreamUrl = `${opts.httpStreamBaseUrl}/llmTtsStreamHttp`;

    async function warmOne(url: string, headers: Record<string, string>): Promise<void> {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({ warmup: true }),
            });
            await response.text().catch(() => undefined); // drain
        } catch {
            // Best-effort — swallow
        }
    }

    return {
        async warmup(): Promise<void> {
            const headers = await authHeaders(opts).catch(() => null);
            if (!headers) return; // Not signed in — skip silently
            await Promise.all([warmOne(llmStreamUrl, headers), warmOne(llmTtsStreamUrl, headers)]);
        },

        async stream(args: LLMCallArgs): Promise<LLMStreamResult> {
            const response = await postStream(
                llmStreamUrl,
                toServerArgs(args),
                await authHeaders(opts),
                args.signal,
            );
            return createLLMStreamResult(response);
        },

        async streamWithTTS(args: LLMCallArgs & LLMTTSExtras): Promise<LLMTTSStreamResult> {
            const { voice, speed, instructions, ...llmArgs } = args;
            const body = {
                ...toServerArgs(llmArgs),
                tts: true,
                voice,
                ...(speed !== undefined && { speed }),
                ...(instructions && { instructions }),
            };
            const response = await postStream(
                llmTtsStreamUrl,
                body,
                await authHeaders(opts),
                args.signal,
            );
            return createLLMTTSStreamResult(response, args);
        },
    };
}
