/**
 * xAI / Grok non-streaming provider handler.
 *
 * Mirrors openai.ts but points at the xAI base URL. xAI's REST API is
 * OpenAI-SDK-compatible (chat.completions.create), so the body shape
 * carries through unchanged.
 */

import OpenAI from 'openai'
import type { LLMRequest, LLMResponse } from '../types.js'

const XAI_BASE_URL = 'https://api.x.ai/v1'

export async function handleXaiRequest(request: LLMRequest): Promise<LLMResponse> {
    const { model, input, max_tokens, temperature, apiKey: rawKey } = request

    const apiKey = rawKey ?? process.env['XAI_API_KEY']
    if (!apiKey) {
        throw new Error('xAI provider requires XAI_API_KEY (env or request.apiKey)')
    }

    const client = new OpenAI({ apiKey, baseURL: XAI_BASE_URL })

    const messages: OpenAI.ChatCompletionMessageParam[] = input.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
    }))

    const start = Date.now()
    const completion = await client.chat.completions.create({
        model,
        messages,
        ...(max_tokens && { max_tokens }),
        ...(temperature != null && { temperature }),
        stream: false,
    })
    const latency_ms = Date.now() - start

    const choice = completion.choices?.[0]
    const usage = completion.usage
    const cached_input_tokens = (usage as any)?.prompt_tokens_details?.cached_tokens ?? 0

    return {
        output_text: choice?.message?.content ?? '',
        usage: {
            input_tokens: usage?.prompt_tokens || 0,
            output_tokens: usage?.completion_tokens || 0,
            cached_input_tokens,
        },
        model,
        provider: 'xai',
        finish_reason: choice?.finish_reason || 'stop',
        latency_ms,
        raw: { usage, finish_reason: choice?.finish_reason },
    }
}
