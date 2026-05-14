/**
 * Cortex API - Platform-agnostic AI agent framework
 *
 * This package provides the core Cortex agent implementation that works
 * in both browser and Node.js environments via dependency injection.
 */

// Core classes and functions
export { Cortex } from './cortex.js'
export {
  get_function_dictionary,
  get_functions_string,
  generate_system_msg,
  get_variable_hash_id,
  extractJsonSchema,
  CortexOutputResponseFormat,
  CortexOutputSchema,
  CortexOutputSchemaName,
  CodeOutputResponseFormat,
  CodeOutputSchema,
  CodeOutputSchemaName
} from './cortex.js'

// Sandbox interface and types
export type {
  SandboxExecutor,
  SandboxResult,
  SandboxLog,
  SandboxEvent,
  SandboxRuntimeEvent
} from './sandbox_interface.js'
export { DEFAULT_SANDBOX_TIMEOUT } from './sandbox_interface.js'

// Type definitions
export type {
  Provider,
  Function,
  FunctionCall,
  FunctionResult,
  CodeExecutionResult,
  UserInput,
  CortexOutput,
  CodeOutput,
  FunctionDictionary,
  SystemMessage,
  UserMessage,
  CortexMessage,
  IOMessage,
  IOMessages,
  CortexOps,
  CortexUtilities,
  TokenBreakdown,
  ContextStatus,
  UsageStats
} from './types.js'

// Model registry
export { getModelInfo, getRegisteredModels, MODEL_REGISTRY, calculateCost, getCachedInputPrice, getModelsByProvider } from './model_registry.js'
export type { ModelInfo } from './model_registry.js'

// TTS pricing (non-LLM models — byte-output semantics)
export { GPT4O_MINI_TTS_PRICING, estimateGpt4oMiniTtsCost } from './model_registry.js'
export type { TtsCostEstimate } from './model_registry.js'

// Token counting
export {
  countTokens,
  countTokensEstimate,
  countMessageTokens,
  getTokenBreakdown,
  calculateDrift,
  suggestRatioAdjustment
} from './token_counter.js'

// Channel for async communication
export { Channel } from './channel.js'

// Prompt management
export { buildPrompt, sections, syntax, codeOutputFormat, cortexOutputFormat, DEFAULT_CORTEX_SECTIONS, LEGACY_CORTEX_SECTIONS } from './cortex_prompt_blocks.js'
export type { SectionName, SectionArgs } from './cortex_prompt_blocks.js'

export { PromptManager } from './prompt_manager.js'
export type { SectionOverrides } from './prompt_manager.js'

// Runner abstraction
export { SynchronousRunner } from './runner/synchronous_v1.js'
export { StreamingRunner, StreamParser } from './runner/streaming_v2.js'
export { StreamingRunnerV3, JsonStreamParser } from './runner/streaming_v3.js'
export type { Runner, RunnerContext, RunnerPromptFormat } from './runner/types.js'
export type { StreamingRunnerOptions } from './runner/streaming_v2.js'
export type { StreamingRunnerV3Options } from './runner/streaming_v3.js'

// SystemContextManager — module-based prompt composition
export { SystemContextManager } from './system_context_manager.js'
export type { ContextModule, SCMBuildResult } from './system_context_manager.js'

// ProcessManager types (class imported internally by Cortex, not re-exported to avoid EventEmitter polyfill in browser bundles)
export type {
    CortexProcessInfo, ProcessSummary, ForkOptions, ProcessOutput,
    ProcessOutputLine, ProcessMode, ProcessStatus, CompletionMode, SandboxFactory
} from './process_manager.js'

// Default module factories
export {
  createIntroModule,
  createCodeGenModule,
  createStreamingCodeGenModule,
  createDynamicFunctionsModule,
  createKnowledgeGraphModule,
  createResponseGuidanceModule,
  createCodeOutputModule,
  createStreamingOutputModule,
} from './default_modules.js'
