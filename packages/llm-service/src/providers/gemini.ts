/**
 * Google Gemini provider handler
 * Unstructured: native @google/genai SDK
 * Structured: OpenAI SDK in compatibility mode
 */

import { GoogleGenAI } from '@google/genai'
import OpenAI from 'openai'
import type { LLMRequest, LLMResponse } from '../types.js'

export async function handleGeminiRequest(request: LLMRequest): Promise<LLMResponse> {
  const { model, input, max_tokens, temperature, schema, schema_name, apiKey } = request

  const geminiKey = apiKey || process.env['GEMINI_API_KEY'] || ''

  const start = Date.now()

  if (schema) {
    // Structured output via OpenAI SDK compatibility mode
    const client = new OpenAI({
      apiKey: geminiKey,
      baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
    })

    const response = await (client as any).beta.chat.completions.parse({
      model,
      messages: input,
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: schema_name || 'response',
          schema,
          strict: true,
        },
      },
    })

    const latency_ms = Date.now() - start
    const parsed = response.choices[0]?.message?.parsed

    // Gemini via OpenAI compat mode: cached tokens use the Chat Completions format
    // I'm not 100% certain Gemini's OpenAI compatibility layer exposes cached token details.
    // If it does, it would follow OpenAI Chat API convention: usage.prompt_tokens_details.cached_tokens
    const cached_input_tokens =
      response.usage?.prompt_tokens_details?.cached_tokens ?? 0

    return {
      output_text: parsed ? JSON.stringify(parsed) : '',
      usage: {
        input_tokens: response.usage?.prompt_tokens || 0,
        output_tokens: response.usage?.completion_tokens || 0,
        cached_input_tokens,
      },
      model: response.model || model,
      provider: 'gemini',
      finish_reason: response.choices[0]?.finish_reason || 'stop',
      latency_ms,
      raw: response,
    }
  } else {
    // Unstructured output via native Gemini SDK
    const ai = new GoogleGenAI({ apiKey: geminiKey })

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
    if (temperature !== undefined) generationConfig.temperature = temperature

    const requestConfig: any = { model, contents }
    if (systemMessage) {
      requestConfig.systemInstruction = systemMessage.content
    }
    if (Object.keys(generationConfig).length > 0) {
      requestConfig.generationConfig = generationConfig
    }

    const response = await ai.models.generateContent(requestConfig)

    const latency_ms = Date.now() - start

    // Native Gemini SDK: cached tokens live at usageMetadata.cachedContentTokenCount
    // I'm not 100% certain this is the correct field name — it may vary by SDK version.
    // The @google/genai SDK docs reference cachedContentTokenCount for context caching.
    const cached_input_tokens =
      response.usageMetadata?.cachedContentTokenCount ?? 0

    return {
      output_text: response.text || '',
      usage: {
        input_tokens: response.usageMetadata?.promptTokenCount || 0,
        output_tokens: response.usageMetadata?.candidatesTokenCount || 0,
        cached_input_tokens,
      },
      model,
      provider: 'gemini',
      finish_reason: response.candidates?.[0]?.finishReason || 'stop',
      latency_ms,
      raw: response,
    }
  }
}
