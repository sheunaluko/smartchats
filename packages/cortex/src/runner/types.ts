/**
 * Runner abstraction types for Cortex
 *
 * Runners encapsulate the LLM call → parse → execute loop,
 * allowing different strategies (synchronous structured JSON, streaming delimited text, etc.)
 */

import type {
    Provider,
    IOMessages,
    CodeOutput,
    FunctionResult,
    ContextStatus,
    UsageStats,
    CodeExecutionResult
} from '../types.js'
import type { UsageForCost } from '../model_registry.js'
import type { SectionOverrides } from '../prompt_manager.js'
import type { ContextModule } from '../system_context_manager.js'

/**
 * Read-only context + delegate methods that a Runner uses to interact with Cortex.
 * Created fresh for each run() invocation via Cortex.createRunnerContext().
 */
export interface RunnerContext {
    // Read-only state
    readonly model: string
    readonly provider: Provider
    readonly messages: IOMessages
    readonly workspace: Record<string, any>
    readonly last_result: any
    readonly insights: any | null

    // Delegates back to Cortex
    buildMessages(): Array<{ role: string; content: string }>
    getContextStatus(): ContextStatus
    runCodeOutput(output: CodeOutput): Promise<FunctionResult>
    addCortexMessage(content: string): void
    addUserResultInput(result: CodeExecutionResult): void
    emitEvent(evt: any): void
    updateUsage(usage: UsageForCost): void
    logEvent(msg: string): void
    log: (...args: any[]) => void

    // LLM call function (injected from Cortex)
    llmCallFn?: (args: { model: string; input: any[]; schema?: any; schema_name?: string }) => Promise<any>
    apiBaseUrl: string

    // Cancellation signal — checked cooperatively by runners
    readonly signal?: AbortSignal
}

/**
 * How the runner wants the system prompt's outputFormat section to look.
 * Passed to PromptManager.buildWith() when the runner is set.
 */
export interface RunnerPromptFormat {
    sectionOverrides: SectionOverrides
}

/**
 * Thrown when a run is cancelled via AbortSignal.
 */
export class CortexCancelledError extends Error {
    constructor(message = 'LLM run cancelled') {
        super(message)
        this.name = 'CortexCancelledError'
    }
}

/**
 * A Runner encapsulates one strategy for the LLM call → parse → execute loop.
 */
export interface Runner {
    readonly id: string
    getPromptFormat(): RunnerPromptFormat
    getOutputModule(): ContextModule         // SCM: provides output module (id='output')
    run(ctx: RunnerContext, maxLoops: number): Promise<string>
    warmup?(): Promise<void>
}
