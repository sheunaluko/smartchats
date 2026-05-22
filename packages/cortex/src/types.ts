/**
 * Cortex type definitions
 */

import { SandboxExecutor, SandboxEvent } from './sandbox_interface.js'
import type { Runner } from './runner/types.js'
import type { SystemContextManager } from './system_context_manager.js'

/* Provider types */
export type Provider = 'openai' | 'anthropic' | 'gemini'

/* Function types */
export type FunctionParameters = Record<string, any> | null
export type FunctionReturnType = any

export interface Function {
  description: string
  name: string
  parameters: FunctionParameters
  return_type: FunctionReturnType
  fn: (p: FunctionParameters) => FunctionReturnType
  enabled?: boolean
}

export interface FunctionCall {
  name: string
  parameters: FunctionParameters
}

export interface FunctionResult {
  name: string
  error: boolean | string
  result: FunctionReturnType
  events?: SandboxEvent[]
}

export interface CodeExecutionResult {
  name: string
  error: boolean | string
  result: FunctionReturnType
}

/* User input types */
export interface UserInput {
  type: string
  text: string | null
  data: any
}

/* Cortex output types */
export interface CortexOutput {
  thoughts: string
  calls: FunctionCall[]
  return_indeces: number[]
}

export interface CodeOutput {
  thoughts: string
  code: string
  response?: string
}

/* Function dictionary */
export type FunctionDictionary = {
  [key: string]: Function
}

/* Message types */
export interface SystemMessage {
  role: 'system'
  content: string
}

export interface UserMessage {
  role: 'user'
  content: string
}

export interface CortexMessage {
  role: 'assistant'
  content: string
}

export type IOMessage = UserMessage | CortexMessage
export type IOMessages = IOMessage[]

/* Platform-specific utilities */
export interface CortexUtilities {
  get_embedding?: (text: string) => Promise<number[]>  // Optional embedding function
  sounds?: {  // Optional sound feedback
    error: () => void
    activated: () => void
    ok: () => void
    success: () => void
  }
}

/* Cortex constructor options */
export interface CortexOps {
  model: string
  name: string
  functions?: Function[]                 // Required unless scm is provided
  additional_system_msg?: string         // Required unless scm is provided
  provider?: Provider
  insights?: any
  sandbox: SandboxExecutor  // Required sandbox implementation
  apiBaseUrl?: string      // Optional API base URL (default: browser origin or production)
  utilities?: CortexUtilities  // Optional platform-specific utilities
  llmCallFn?: (args: { model: string; input: any[]; schema?: any; schema_name?: string }) => Promise<any>  // Optional injectable LLM call function
  runner?: Runner  // Optional runner implementation (default: SynchronousRunner)
  scm?: SystemContextManager  // Optional SCM — when provided, replaces PromptManager + functions + additional_system_msg
}

/* Usage tracking types */
export interface UsageStats {
  promptTokens: number
  completionTokens: number
  cachedInputTokens: number
  cacheCreationInputTokens: number  // Anthropic 5m cache writes (1.25× base)
  totalTokens: number
  costUsd: number
  callCount: number
}

/* Token and context status types */
export interface TokenBreakdown {
  systemMessage: number
  userMessages: number
  assistantMessages: number
  total: number
}

export interface ContextStatus {
  model: string
  provider: Provider
  contextWindow: number
  maxOutputTokens: number

  // Current usage
  breakdown: TokenBreakdown
  totalUsed: number
  remaining: number
  usagePercent: number

  // Thresholds
  isApproachingLimit: boolean  // >80%
  isAtLimit: boolean           // >95%

  // Metadata
  messageCount: number
  countMethod: 'estimate'
}
