/**
 * OpenAI streaming provider handler
 *
 * Uses OpenAI Responses API with stream: true.
 * Yields text deltas, resolves aggregated promise with usage data when stream completes.
 */

import OpenAI from 'openai'
import type { LLMStreamRequest, LLMStreamResponse, LLMResponse } from '../types.js'

export function handleOpenAIStreamRequestResponses(request: LLMStreamRequest): LLMStreamResponse {
    const client = new OpenAI(request.apiKey ? { apiKey: request.apiKey } : undefined)

    const { model, input, max_tokens, temperature, text_format } = request

    const start = Date.now()

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
            let responseStream: any = null
            let buffer: string[] = []
            let done = false
            let error: any = null
            let waitResolve: (() => void) | null = null

            // Start the stream lazily on first iteration
            async function ensureStream() {
                if (streamStarted) return
                streamStarted = true

                try {
                    responseStream = await (client as any).responses.create({
                        model,
                        input,
                        ...(max_tokens && { max_output_tokens: max_tokens }),
                        ...(temperature != null && { temperature }),
                        ...(text_format && { text: { format: text_format } }),
                        stream: true,
                    })

                    // Process events in background
                    ;(async () => {
                        try {
                            for await (const event of responseStream) {
                                if (event.type === 'response.output_text.delta') {
                                    const delta = event.delta || ''
                                    if (delta) {
                                        fullText += delta
                                        buffer.push(delta)
                                        if (waitResolve) {
                                            const resolve = waitResolve
                                            waitResolve = null
                                            resolve()
                                        }
                                    }
                                } else if (event.type === 'response.completed') {
                                    const response = event.response
                                    const latency_ms = Date.now() - start

                                    const cached_input_tokens =
                                        response.usage?.input_tokens_details?.cached_tokens
                                        ?? response.usage?.prompt_tokens_details?.cached_tokens
                                        ?? 0

                                    resolveAggregated({
                                        output_text: fullText,
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
                                    })
                                }
                            }
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
