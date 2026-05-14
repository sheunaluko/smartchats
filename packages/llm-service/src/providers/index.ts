/**
 * Provider routing — dispatches LLM requests to the correct handler
 */

import type { LLMRequest, LLMResponse, LLMStreamRequest, LLMStreamResponse, Provider } from '../types.js'
import { handleAnthropicRequest } from './anthropic.js'
import { handleOpenAIRequest } from './openai.js'
import { handleGeminiRequest } from './gemini.js'
import { handleOpenAIStreamRequestResponses as handleOpenAIStreamRequest } from './openai_stream_responses.js'
import { handleAnthropicStreamRequest } from './anthropic_stream.js'
import { handleGeminiStreamRequest } from './gemini_stream.js'
import { getModelInfo } from 'cortex'

export { handleAnthropicRequest, handleOpenAIRequest, handleGeminiRequest, handleOpenAIStreamRequest, handleAnthropicStreamRequest, handleGeminiStreamRequest }

/**
 * Returns the provider for a given model name.
 */
export function getProviderForModel(model: string): Provider {
  const info = getModelInfo(model)
  return info.provider
}

/**
 * Routes an LLM request to the correct provider handler.
 */
export async function handleLLMRequest(request: LLMRequest): Promise<LLMResponse> {
  const provider = getProviderForModel(request.model)

  switch (provider) {
    case 'anthropic':
      return handleAnthropicRequest(request)
    case 'openai':
      return handleOpenAIRequest(request)
    case 'gemini':
      return handleGeminiRequest(request)
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}

/**
 * Routes an LLM streaming request to the correct provider handler.
 */
export function handleLLMStreamRequest(request: LLMStreamRequest): LLMStreamResponse {
  const provider = getProviderForModel(request.model)

  switch (provider) {
    case 'openai':
      return handleOpenAIStreamRequest(request)
    case 'anthropic':
      return handleAnthropicStreamRequest(request)
    case 'gemini':
      return handleGeminiStreamRequest(request)
    default:
      throw new Error(`Unsupported provider: ${provider}`)
  }
}
