/**
 * OpenAI provider handler
 * Supports both unstructured (Responses API) and structured output
 */

import OpenAI from 'openai'
import type { LLMRequest, LLMResponse } from '../types.js'

export async function handleOpenAIRequest(request: LLMRequest): Promise<LLMResponse> {
  const client = new OpenAI(request.apiKey ? { apiKey: request.apiKey } : undefined)

  const { model, input, max_tokens, temperature, schema, schema_name } = request

  const start = Date.now()

  if (schema) {
    // Structured output via Responses API
    const response = await (client as any).responses.create({
      model,
      input,
      text: {
        format: {
          type: 'json_schema',
          name: schema_name || 'response',
          schema,
          strict: true,
        },
      },
    })

    const latency_ms = Date.now() - start

    // OpenAI Responses API: cached tokens live at usage.input_tokens_details.cached_tokens
    // I'm not 100% certain this is the exact field path for the Responses API SDK response object.
    // The Chat Completions API uses usage.prompt_tokens_details.cached_tokens instead.
    // If this doesn't work, inspect response.usage via logging to find the correct path.
    const cached_input_tokens =
      response.usage?.input_tokens_details?.cached_tokens
      ?? response.usage?.prompt_tokens_details?.cached_tokens
      ?? 0

    return {
      output_text: response.output_text || '',
      usage: {
        input_tokens: response.usage?.input_tokens || 0,
        output_tokens: response.usage?.output_tokens || 0,
        cached_input_tokens,
      },
      model: response.model || model,
      provider: 'openai',
      finish_reason: response.stop_reason || 'stop',
      latency_ms,
      raw: response,
    }
  } else {
    // Unstructured output via Responses API
    // Extract system/user messages for the Responses API format
    const systemMsg = input.find(m => m.role === 'system')
    const userMsgs = input.filter(m => m.role !== 'system')
    const instructions = systemMsg?.content || ''
    const inputText = userMsgs.map(m => m.content).join('\n')

    const response = await (client as any).responses.create({
      model,
      instructions,
      input: inputText,
    })

    const latency_ms = Date.now() - start

    const cached_input_tokens =
      response.usage?.input_tokens_details?.cached_tokens
      ?? response.usage?.prompt_tokens_details?.cached_tokens
      ?? 0

    return {
      output_text: response.output_text || '',
      usage: {
        input_tokens: response.usage?.input_tokens || 0,
        output_tokens: response.usage?.output_tokens || 0,
        cached_input_tokens,
      },
      model: response.model || model,
      provider: 'openai',
      finish_reason: response.stop_reason || 'stop',
      latency_ms,
      raw: response,
    }
  }
}
