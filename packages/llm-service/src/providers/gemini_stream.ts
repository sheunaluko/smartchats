/**
 * Google Gemini streaming provider handler
 *
 * Uses native @google/genai SDK with generateContentStream + structured output
 * via responseMimeType: "application/json" + responseSchema.
 */

import { GoogleGenAI } from '@google/genai'
import type { LLMStreamRequest, LLMStreamResponse, LLMResponse } from '../types.js'

export function handleGeminiStreamRequest(request: LLMStreamRequest): LLMStreamResponse {
  const { model, input, max_tokens, temperature, stop, apiKey, text_format } = request

  const geminiKey = apiKey || process.env['GEMINI_API_KEY'] || ''
  const ai = new GoogleGenAI({ apiKey: geminiKey })

  const start = Date.now()

  // Extract system message
  const systemMessage = input.find(m => m.role === 'system')
  const nonSystemMessages = input.filter(m => m.role !== 'system')

  // Convert to Gemini format: role 'assistant' → 'model'
  const contents = nonSystemMessages.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : msg.role,
    parts: [{ text: msg.content }],
  }))

  const generationConfig: any = {}
  if (max_tokens) generationConfig.maxOutputTokens = max_tokens
  if (temperature != null) generationConfig.temperature = temperature
  if (stop) generationConfig.stopSequences = stop

  // Structured output: enforce JSON via responseMimeType + responseJsonSchema
  // responseJsonSchema accepts standard JSON Schema directly (no type conversion needed)
  if (text_format?.schema) {
    generationConfig.responseMimeType = 'application/json'
    generationConfig.responseJsonSchema = text_format.schema
  }

  // Shared state
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
          const config: any = {}
          if (systemMessage) {
            config.systemInstruction = systemMessage.content
          }
          Object.assign(config, generationConfig)

          const response = await ai.models.generateContentStream({
            model,
            contents,
            config,
          })

          ;(async () => {
            let usageMetadata: any = null
            let finishReason = 'stop'

            try {
              for await (const chunk of response) {
                const text = chunk.text || ''
                if (text) {
                  fullText += text
                  buffer.push(text)
                  if (waitResolve) {
                    const resolve = waitResolve
                    waitResolve = null
                    resolve()
                  }
                }
                if (chunk.usageMetadata) {
                  usageMetadata = chunk.usageMetadata
                }
                if (chunk.candidates?.[0]?.finishReason) {
                  finishReason = chunk.candidates[0].finishReason
                }
              }

              const latency_ms = Date.now() - start

              resolveAggregated({
                output_text: fullText,
                usage: {
                  input_tokens: usageMetadata?.promptTokenCount || 0,
                  output_tokens: usageMetadata?.candidatesTokenCount || 0,
                  cached_input_tokens: usageMetadata?.cachedContentTokenCount || 0,
                },
                model,
                provider: 'gemini',
                finish_reason: finishReason,
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
