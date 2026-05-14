/**
 * LLM Service types
 */

export type Provider = 'openai' | 'anthropic' | 'gemini'

export interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LLMRequest {
  model: string
  input: Message[]
  max_tokens?: number
  temperature?: number

  // Structured output (optional — if present, uses structured endpoint)
  schema?: Record<string, any>
  schema_name?: string

  // BYO API key (optional — overrides server key)
  apiKey?: string
}

export interface LLMUsage {
  input_tokens: number
  output_tokens: number
  cached_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface LLMResponse {
  output_text: string
  usage: LLMUsage
  model: string
  provider: Provider
  finish_reason: string
  latency_ms: number
  raw?: any
}

/* Streaming types */

export interface LLMStreamRequest {
  model: string
  input: Message[]
  max_tokens?: number
  temperature?: number
  apiKey?: string
  stop?: string[]
  text_format?: { type: 'json_schema', name: string, strict: boolean, schema: Record<string, any> }
}

export interface LLMStreamResponse {
  /** Yields text deltas as they arrive from the provider */
  stream: AsyncIterable<string>
  /** Resolves when the stream completes with full response + usage data */
  aggregated: Promise<LLMResponse>
}
