/**
 * Anthropic Claude provider handler
 * Supports both unstructured and structured (JSON schema) output
 */

import Anthropic from '@anthropic-ai/sdk'
import type { LLMRequest, LLMResponse } from '../types.js'
import { transformSchemaForClaude } from '../util/schema_transform.js'

export async function handleAnthropicRequest(request: LLMRequest): Promise<LLMResponse> {
  const client = new Anthropic(request.apiKey ? { apiKey: request.apiKey } : undefined)

  const { model, input, max_tokens = 4096, temperature, schema, schema_name } = request

  // Claude requires system as a top-level parameter, not in messages array
  // Use array format: cache_control on the first (large, static) block only.
  // Dynamic state blocks (session timers, turn counts) go in separate blocks
  // without cache_control so they don't invalidate the cached prefix.
  const systemMessages = input.filter(m => m.role === 'system')
  const system = systemMessages.length > 0
    ? systemMessages.map((m, i) => ({
        type: 'text' as const,
        text: m.content,
        ...(i === 0 ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }))
    : undefined
  // Anthropic prefix-cache strategy.
  //
  // 1. ALL non-system message content is wrapped in array-of-block form
  //    `[{type:'text', text: ...}]`, even when no cache_control is attached.
  //    Reason: Anthropic's cache prefix matching is shape-sensitive — a
  //    message whose content is `string` on one call won't match the same
  //    text wrapped as `[{type:'text', text}]` on the next call. Mixing
  //    shapes across turns silently breaks the cache. Keeping every
  //    message in the same shape lets the cumulative prefix match cleanly.
  //
  // 2. We place a single `cache_control: ephemeral` marker on the LAST
  //    non-system message. Combined with the marker on the first system
  //    block above, we use 2 of Anthropic's allowed 4 markers per request.
  //    The deepest breakpoint from call N is what call N+1 matches
  //    against; intermediate breakpoints from call N don't help call N+1.
  //    Extra markers would just write redundant cache entries without
  //    deepening any match — empirically validated by comparing
  //    "mark last 3" vs "mark last 1" with the same shape: same cache hit.
  const nonSystemMessages = input.filter(m => m.role !== 'system')
  const lastIdx = nonSystemMessages.length - 1
  const messages = nonSystemMessages.map((m, i) => {
    const marked = i === lastIdx
    return {
      role: m.role as 'user' | 'assistant',
      content: [
        {
          type: 'text' as const,
          text: m.content,
          ...(marked ? { cache_control: { type: 'ephemeral' as const } } : {}),
        },
      ],
    }
  })

  const start = Date.now()

  if (schema) {
    // Structured output
    const claudeSchema = transformSchemaForClaude(schema)
    const response = await (client as any).beta.messages.create({
      model,
      max_tokens,
      betas: ['structured-outputs-2025-11-13'],
      ...(temperature !== undefined && { temperature }),
      ...(system && { system }),
      messages,
      output_format: {
        type: 'json_schema',
        schema: claudeSchema,
      },
    })

    const latency_ms = Date.now() - start

    // Anthropic splits input into: input_tokens (uncached) + cache_creation + cache_read
    // Normalize to match OpenAI semantics: input_tokens = total, cached = reads only
    const cacheRead1 = response.usage.cache_read_input_tokens || 0
    const cacheCreation1 = response.usage.cache_creation_input_tokens || 0

    return {
      output_text: response.content[0]?.type === 'text' ? response.content[0].text : '',
      usage: {
        input_tokens: response.usage.input_tokens + cacheCreation1 + cacheRead1,
        output_tokens: response.usage.output_tokens,
        cached_input_tokens: cacheRead1,
        cache_creation_input_tokens: cacheCreation1,
      },
      model: response.model,
      provider: 'anthropic',
      finish_reason: response.stop_reason || 'end_turn',
      latency_ms,
      raw: response,
    }
  } else {
    // Unstructured output
    const response = await client.messages.create({
      model,
      max_tokens,
      ...(temperature !== undefined && { temperature }),
      ...(system && { system }),
      messages,
    })

    const latency_ms = Date.now() - start

    // Normalize Anthropic token semantics (same as above)
    const cacheRead2 = (response.usage as any).cache_read_input_tokens || 0
    const cacheCreation2 = (response.usage as any).cache_creation_input_tokens || 0

    return {
      output_text: response.content[0]?.type === 'text' ? response.content[0].text : '',
      usage: {
        input_tokens: response.usage.input_tokens + cacheCreation2 + cacheRead2,
        output_tokens: response.usage.output_tokens,
        cached_input_tokens: cacheRead2,
        cache_creation_input_tokens: cacheCreation2,
      },
      model: response.model,
      provider: 'anthropic',
      finish_reason: response.stop_reason || 'end_turn',
      latency_ms,
      raw: response,
    }
  }
}
