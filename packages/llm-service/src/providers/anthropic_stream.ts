/**
 * Anthropic Claude streaming provider handler
 *
 * Uses Anthropic SDK with stream: true. Supports structured (JSON schema)
 * output via the beta `output_format` endpoint when `text_format` is supplied —
 * mirrors the non-streaming `anthropic.ts` behaviour so streaming runners
 * (e.g. `StreamingRunnerV3`) get the same API-level JSON enforcement that
 * OpenAI/Gemini provide. Without this, Claude can ignore the prompt-level
 * schema instructions and emit plain text, which the JSON parser then drops.
 *
 * Yields text deltas, resolves aggregated promise with usage data when stream completes.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { LLMStreamRequest, LLMStreamResponse, LLMResponse } from '../types.js'
import { transformSchemaForClaude } from '../util/schema_transform.js'

export function handleAnthropicStreamRequest(request: LLMStreamRequest): LLMStreamResponse {
  const client = new Anthropic(request.apiKey ? { apiKey: request.apiKey } : undefined)

  const { model, input, max_tokens = 4096, temperature, stop, text_format } = request

  const start = Date.now()

  // Claude requires system as a top-level parameter, not in messages array
  // Use array format: cache_control on the first (large, static) block only.
  // Dynamic state blocks (session timers, turn counts) go in separate blocks
  // without cache_control so they don't invalidate the cached prefix.
  const systemMessages = input.filter(m => m.role === 'system')
  const system = systemMessages.length > 0
    ? systemMessages.map((m, i) => ({
        type: 'text' as const,
        text: m.content,
        // Only cache the first (largest, static) system block
        ...(i === 0 ? { cache_control: { type: 'ephemeral' as const } } : {}),
      }))
    : undefined
  const messages = input
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }))

  // Shared state between stream iterator and aggregated promise
  let fullText = ''
  let resolveAggregated: (value: LLMResponse) => void
  let rejectAggregated: (reason: any) => void

  const aggregated = new Promise<LLMResponse>((resolve, reject) => {
    resolveAggregated = resolve
    rejectAggregated = reject
  })

  const stream: AsyncIterable<string> = {
    [Symbol.asyncIterator]() {
      let streamStarted = false
      let buffer: string[] = []
      let done = false
      let error: any = null
      let waitResolve: (() => void) | null = null

      async function ensureStream() {
        if (streamStarted) return
        streamStarted = true

        try {
          // When text_format.schema is supplied, route through the beta
          // structured-output endpoint so Claude emits valid JSON that the
          // streaming JSON parser can consume. Same pattern as the
          // non-streaming `anthropic.ts` provider.
          const useStructured = !!text_format?.schema
          const baseParams = {
            model,
            max_tokens,
            ...(temperature != null && { temperature }),
            ...(system && { system }),
            ...(stop && { stop_sequences: stop }),
            messages,
          }
          const messageStream = useStructured
            ? (client as any).beta.messages.stream({
                ...baseParams,
                betas: ['structured-outputs-2025-11-13'],
                output_format: {
                  type: 'json_schema',
                  schema: transformSchemaForClaude(text_format!.schema),
                },
              })
            : client.messages.stream(baseParams)

          // Process events in background
          ;(async () => {
            try {
              for await (const event of messageStream) {
                if (
                  event.type === 'content_block_delta' &&
                  event.delta.type === 'text_delta'
                ) {
                  const delta = event.delta.text || ''
                  if (delta) {
                    fullText += delta
                    buffer.push(delta)
                    if (waitResolve) {
                      const resolve = waitResolve
                      waitResolve = null
                      resolve()
                    }
                  }
                }
              }

              // Stream finished — get final message for usage
              const finalMessage = await messageStream.finalMessage()

              const latency_ms = Date.now() - start

              // Anthropic splits input into: input_tokens (uncached) + cache_creation + cache_read
              // Normalize to match OpenAI semantics: input_tokens = total, cached = reads only
              const cacheRead = (finalMessage.usage as any).cache_read_input_tokens || 0
              const cacheCreation = (finalMessage.usage as any).cache_creation_input_tokens || 0

              resolveAggregated({
                output_text: fullText,
                usage: {
                  input_tokens: finalMessage.usage.input_tokens + cacheCreation + cacheRead,
                  output_tokens: finalMessage.usage.output_tokens,
                  cached_input_tokens: cacheRead,
                  cache_creation_input_tokens: cacheCreation,
                },
                model: finalMessage.model,
                provider: 'anthropic',
                finish_reason: finalMessage.stop_reason || 'end_turn',
                latency_ms,
              })
            } catch (err) {
              error = err
              rejectAggregated(err)
            } finally {
              done = true
              if (waitResolve) {
                const resolve = waitResolve
                waitResolve = null
                resolve()
              }
            }
          })()
        } catch (err) {
          error = err
          done = true
          rejectAggregated(err)
        }
      }

      return {
        async next(): Promise<IteratorResult<string>> {
          await ensureStream()

          while (true) {
            if (buffer.length > 0) {
              return { value: buffer.shift()!, done: false }
            }
            if (error) throw error
            if (done) return { value: undefined as any, done: true }

            // Wait for more data
            await new Promise<void>(resolve => {
              waitResolve = resolve
            })
          }
        }
      }
    }
  }

  return { stream, aggregated }
}
