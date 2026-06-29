/**
 * xAI / Grok streaming provider — thin wrapper around the shared
 * OpenAI-Chat-Completions adapter.
 *
 * xAI exposes the OpenAI Chat Completions wire format at https://api.x.ai/v1
 * with full structured-output support via response_format json_schema. All
 * the streaming-loop logic lives in `_chat_completions_stream.ts` so adding
 * another OpenAI-compatible provider (Groq, Together, DeepSeek, OpenRouter,
 * Mistral) is the same ~10-line wrapper.
 */

import type { LLMStreamRequest, LLMStreamResponse } from '../types.js'
import { handleChatCompletionsStreamRequest } from './_chat_completions_stream.js'

const XAI_BASE_URL = 'https://api.x.ai/v1'

export function handleXaiStreamRequest(request: LLMStreamRequest): LLMStreamResponse {
    const apiKey = request.apiKey ?? process.env['XAI_API_KEY']
    if (!apiKey) {
        throw new Error('xAI provider requires XAI_API_KEY (env or request.apiKey)')
    }
    return handleChatCompletionsStreamRequest(request, {
        baseURL: XAI_BASE_URL,
        providerName: 'xai',
        apiKey,
    })
}
