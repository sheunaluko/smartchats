import type {
    LLMAPI,
    LLMCallArgs,
    LLMStreamResult,
    LLMTTSExtras,
    LLMTTSStreamResult,
} from 'smartchats-backend';
import {
    postStream,
    toServerArgs,
    createLLMStreamResult,
    createLLMTTSStreamResult,
} from 'smartchats-backend';
import type { LocalBackendOptions } from './backend.js';
import { authHeaders } from './http.js';

function baseHeaders(opts: LocalBackendOptions): Record<string, string> {
    return {
        'Content-Type': 'application/json',
        ...authHeaders(opts),
    };
}

export function createLLMAPI(opts: LocalBackendOptions): LLMAPI {
    const llmStreamUrl = `${opts.baseUrl}/llm/stream`;
    const llmTtsStreamUrl = `${opts.baseUrl}/llm/streamWithTTS`;

    async function warmOne(url: string): Promise<void> {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: baseHeaders(opts),
                body: JSON.stringify({ warmup: true }),
            });
            await response.text().catch(() => undefined); // drain
        } catch {
            // Best-effort — swallow
        }
    }

    return {
        async warmup(): Promise<void> {
            await Promise.all([warmOne(llmStreamUrl), warmOne(llmTtsStreamUrl)]);
        },

        async stream(args: LLMCallArgs): Promise<LLMStreamResult> {
            const response = await postStream(
                llmStreamUrl,
                toServerArgs(args),
                baseHeaders(opts),
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
            const response = await postStream(llmTtsStreamUrl, body, baseHeaders(opts), args.signal);
            return createLLMTTSStreamResult(response, args);
        },
    };
}
