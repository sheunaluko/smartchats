/**
 * OpenAI streaming provider handler (Chat Completions API)
 *
 * Uses chat.completions.create with stream: true.
 * Supports `stop` sequences (not available in the Responses API).
 * Yields text deltas, resolves aggregated promise with usage data when stream completes.
 */

import OpenAI from 'openai'
import type { LLMStreamRequest, LLMStreamResponse, LLMResponse } from '../types.js'

export function handleOpenAIStreamRequest(request: LLMStreamRequest): LLMStreamResponse {
    const client = new OpenAI(request.apiKey ? { apiKey: request.apiKey } : undefined)

    const { model, input, max_tokens, temperature, stop } = request

    const start = Date.now()

    // Map input to Chat Completions `messages` format.
    // The Responses API accepts `input` (array of {role, content}).
    // Chat Completions uses `messages` — same shape, so map directly.
    const messages: OpenAI.ChatCompletionMessageParam[] = input.map(m => ({
        role: m.role as 'system' | 'user' | 'assistant',
        content: m.content,
    }))

    // Shared state between stream iterator and aggregated promise
    let fullText = ''
    let resolveAggregated: (value: LLMResponse) => void
    let rejectAggregated: (reason: any) => void

    const aggregated = new Promise<LLMResponse>((resolve, reject) => {
        resolveAggregated = resolve
        rejectAggregated = reject
    })

    // Create the async iterable that yields text deltas
    const stream: AsyncIterable<string> = {
        [Symbol.asyncIterator]() {
            let streamStarted = false
            let buffer: string[] = []
            let done = false
            let error: any = null
            let waitResolve: (() => void) | null = null

            // Start the stream lazily on first iteration
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
                        stream: true,
                        stream_options: { include_usage: true },
                    })

                    // Process chunks in background
                    ;(async () => {
                        let finishReason: string | null = null
                        let usage: any = null

                        try {
                            for await (const chunk of completionStream) {
                                // Text delta
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

                                // Finish reason (on the chunk where choices finish)
                                if (chunk.choices?.[0]?.finish_reason) {
                                    finishReason = chunk.choices[0].finish_reason
                                }

                                // Usage data (final chunk when stream_options.include_usage is true)
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
                                model: model,
                                provider: 'openai',
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
