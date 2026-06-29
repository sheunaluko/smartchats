/**
 * Shared OpenAI Chat-Completions-compatible streaming adapter.
 *
 * Use this as the backing implementation for any provider that exposes the
 * OpenAI Chat Completions wire format (xAI / Grok, Groq, Together, DeepSeek,
 * OpenRouter, Mistral, etc.). The provider only needs to supply:
 *   - baseURL — the API root (https://api.x.ai/v1, etc.)
 *   - providerName — the cortex Provider tag attached to LLMResponse
 *   - apiKey — resolved from env or request override by the caller
 *
 * What's normalized here:
 *   - text_format ({ type, name, strict, schema }) → Chat Completions
 *     response_format ({ type:'json_schema', json_schema:{name,strict,schema} })
 *   - stream_options.include_usage → final-chunk usage rollup → LLMResponse.usage
 *   - cached input tokens from prompt_tokens_details.cached_tokens (when present)
 *
 * If a future provider needs anything provider-specific (custom headers, a
 * differently-shaped response_format, extra request params), add a config
 * field here rather than duplicating the entire ~150-line stream loop.
 */

import OpenAI from 'openai'
import type {
    LLMStreamRequest,
    LLMStreamResponse,
    LLMResponse,
    Provider,
} from '../types.js'

export interface ChatCompletionsStreamConfig {
    /** Base URL passed to the OpenAI SDK client. Required. */
    baseURL: string
    /** Provider tag for the returned LLMResponse.provider field. */
    providerName: Provider
    /** Resolved API key (already env-vs-request-override resolved by caller). */
    apiKey: string
    /**
     * Set false for providers that reject `stream_options.include_usage`.
     * When false, usage rollup is best-effort from finish-chunk only.
     */
    includeUsage?: boolean
}

/**
 * Translate our shared text_format shape into Chat Completions
 * response_format. Returns undefined when no structured output requested.
 *
 * text_format: { type:'json_schema', name, strict, schema }
 *   → response_format: { type:'json_schema', json_schema:{ name, strict, schema } }
 *
 * Exported so adapters that don't use the full base (e.g. custom transport)
 * can still reuse the translation.
 */
export function toChatCompletionsResponseFormat(
    text_format: LLMStreamRequest['text_format'],
): { type: 'json_schema', json_schema: { name: string, strict: boolean, schema: Record<string, any> } } | undefined {
    if (!text_format?.schema) return undefined
    return {
        type: 'json_schema',
        json_schema: {
            name: text_format.name,
            strict: text_format.strict,
            schema: text_format.schema,
        },
    }
}

export function handleChatCompletionsStreamRequest(
    request: LLMStreamRequest,
    config: ChatCompletionsStreamConfig,
): LLMStreamResponse {
    const client = new OpenAI({ apiKey: config.apiKey, baseURL: config.baseURL })

    const { model, input, max_tokens, temperature, stop, text_format } = request
    const start = Date.now()

    const messages: OpenAI.ChatCompletionMessageParam[] = input.map((m) => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
    }))

    const response_format = toChatCompletionsResponseFormat(text_format)

    let fullText = ''
    let resolveAggregated: (value: LLMResponse) => void
    let rejectAggregated: (reason: any) => void

    const aggregated = new Promise<LLMResponse>((resolve, reject) => {
        resolveAggregated = resolve
        rejectAggregated = reject
    })

    const includeUsage = config.includeUsage !== false

    const stream: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
            let streamStarted = false
            const buffer: string[] = []
            let done = false
            let error: any = null
            let waitResolve: (() => void) | null = null

            async function ensureStream() {
                if (streamStarted) return
                streamStarted = true

                try {
                    const completionStream = await client.chat.completions.create({
                        model,
                        messages,
                        ...(max_tokens && { max_tokens }),
                        ...(temperature != null && { temperature }),
                        ...(stop && { stop }),
                        ...(response_format && { response_format }),
                        stream: true,
                        ...(includeUsage && { stream_options: { include_usage: true } }),
                    })

                    ;(async () => {
                        let finishReason: string | null = null
                        let usage: any = null

                        try {
                            for await (const chunk of completionStream) {
                                const delta = chunk.choices?.[0]?.delta?.content
                                if (delta) {
                                    fullText += delta
                                    buffer.push(delta)
                                    if (waitResolve) {
                                        const resolve = waitResolve
                                        waitResolve = null
                                        resolve()
                                    }
                                }
                                if (chunk.choices?.[0]?.finish_reason) {
                                    finishReason = chunk.choices[0].finish_reason
                                }
                                if (chunk.usage) {
                                    usage = chunk.usage
                                }
                            }

                            const latency_ms = Date.now() - start
                            const cached_input_tokens =
                                usage?.prompt_tokens_details?.cached_tokens ?? 0

                            resolveAggregated({
                                output_text: fullText,
                                usage: {
                                    input_tokens: usage?.prompt_tokens || 0,
                                    output_tokens: usage?.completion_tokens || 0,
                                    cached_input_tokens,
                                },
                                model,
                                provider: config.providerName,
                                finish_reason: finishReason || 'stop',
                                latency_ms,
                                raw: { usage, finish_reason: finishReason },
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

                        await new Promise<void>((resolve) => {
                            waitResolve = resolve
                        })
                    }
                },
            }
        },
    }

    return { stream, aggregated }
}
