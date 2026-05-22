/**
 * Synchronous Runner (v1)
 *
 * Mechanical extraction of the existing run_llm() → handle_llm_response() loop
 * from cortex.ts. Uses structured JSON (CodeOutput schema) with full response
 * before parsing and executing.
 *
 * Zero behavioral change from the original implementation.
 */

import type { Runner, RunnerContext, RunnerPromptFormat } from './types.js'
import { CortexCancelledError } from './types.js'
import type { ContextModule } from '../system_context_manager.js'
import type { CodeOutput, CodeExecutionResult } from '../types.js'
import { CodeOutputSchema, CodeOutputSchemaName } from '../cortex.js'
import { codeOutputFormat } from '../cortex_prompt_blocks.js'
import { calculateDrift } from '../token_counter.js'
import { logger } from 'smartchats-common'

const log = logger.get_logger({ id: 'runner:sync_v1' })

function getEndpointForProvider(provider: string): string {
    switch (provider) {
        case 'anthropic': return '/api/claude_structured_response'
        case 'gemini': return '/api/gemini_structured_response'
        default: return '/api/openai_structured_response'
    }
}

export class SynchronousRunner implements Runner {
    readonly id = 'synchronous_v1'

    getPromptFormat(): RunnerPromptFormat {
        return {
            sectionOverrides: {
                outputFormat: [codeOutputFormat.types, codeOutputFormat.examples]
            }
        }
    }

    getOutputModule(): ContextModule {
        return {
            id: 'output',
            name: 'Code Output Format',
            position: 80,
            output_instructions: `${codeOutputFormat.types}\n${codeOutputFormat.examples}`,
            output_structure: CodeOutputSchema,
        }
    }

    private _checkCancelled(ctx: RunnerContext): void {
        if (ctx.signal?.aborted) throw new CortexCancelledError()
    }

    async run(ctx: RunnerContext, maxLoops: number): Promise<string> {
        if (ctx.insights) {
            await ctx.insights.startChain('agent_turn', {
                runner: this.id,
                max_loops: maxLoops,
            })
        }
        try {
            return await this._runLLM(ctx, maxLoops)
        } finally {
            if (ctx.insights) {
                ctx.insights.endChain()
            }
        }
    }

    private async _runLLM(ctx: RunnerContext, loop: number): Promise<string> {
        const messages = ctx.buildMessages()
        const model = ctx.model

        // Emit context status before LLM call
        const contextStatus = ctx.getContextStatus()
        ctx.emitEvent({ type: 'context_status', status: contextStatus })

        if (contextStatus.isAtLimit) {
            ctx.logEvent(`WARNING: Context at ${contextStatus.usagePercent}% capacity (${contextStatus.totalUsed}/${contextStatus.contextWindow} tokens)`)
        } else if (contextStatus.isApproachingLimit) {
            ctx.logEvent(`Context approaching limit: ${contextStatus.usagePercent}% (${contextStatus.totalUsed}/${contextStatus.contextWindow} tokens)`)
        }

        // Use provider-based endpoint
        const endpoint = getEndpointForProvider(ctx.provider)
        const args = {
            model,
            input: messages,
            schema: CodeOutputSchema,
            schema_name: CodeOutputSchemaName
        }

        ctx.log(`[LLM Call] model=${model}, provider=${ctx.provider}, endpoint=${endpoint}, estimated_tokens=${contextStatus.totalUsed}`)
        ctx.logEvent(`Provider: ${ctx.provider} | Model: ${model}`)

        this._checkCancelled(ctx)

        const fetch_start = Date.now()
        let result
        if (ctx.llmCallFn) {
            result = await ctx.llmCallFn(args)
        } else {
            result = await fetch(`${ctx.apiBaseUrl}${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(args)
            })
        }
        const fetch_end = Date.now()

        return await this._handleLLMResponse(ctx, result, loop, {
            start: fetch_start, end: fetch_end, elapsed: fetch_end - fetch_start
        })
    }

    private async _handleLLMResponse(
        ctx: RunnerContext,
        fetchResponseOrData: any,
        loop: number,
        fetchTiming?: { start: number; end: number; elapsed: number }
    ): Promise<string> {

        const jsonData = typeof fetchResponseOrData.json === 'function'
            ? await fetchResponseOrData.json()
            : fetchResponseOrData
        const llmLatency = fetchTiming ? fetchTiming.elapsed : 0

        // Extract server-side timing from API response
        const serverLlmMs = jsonData.server_llm_ms as number | undefined
        const vercelOverheadMs = (fetchTiming && serverLlmMs != null)
            ? fetchTiming.elapsed - serverLlmMs : undefined

        const timingContext = {
            ...(fetchTiming && { client_round_trip_ms: fetchTiming.elapsed }),
            ...(serverLlmMs != null && { server_llm_ms: serverLlmMs }),
            ...(vercelOverheadMs != null && { vercel_overhead_ms: vercelOverheadMs }),
        }

        ctx.log('Model JSON response received')

        // Handle error responses
        if (jsonData.error) {
            ctx.log(`API Error: ${jsonData.error}`)

            if (ctx.insights) {
                ctx.insights.addLLMInvocation({
                    model: ctx.model,
                    provider: ctx.provider,
                    mode: 'code_generation',
                    prompt_tokens: 0,
                    completion_tokens: 0,
                    latency_ms: llmLatency,
                    status: 'error',
                    error: jsonData.error,
                    context: { timing: timingContext },
                }).catch((err: any) => {
                    ctx.log(`Error adding insights event: ${err}`)
                })
            }

            throw new Error(jsonData.error)
        }

        // Handle both old (prompt_tokens/completion_tokens) and new (input_tokens/output_tokens) API formats
        const usage = jsonData.usage || {}
        const prompt_tokens = usage.prompt_tokens ?? usage.input_tokens
        const completion_tokens = usage.completion_tokens ?? usage.output_tokens
        const total_tokens = usage.total_tokens

        // Extract cached input tokens (provider-agnostic)
        const cached_input_tokens =
            usage.cache_read_input_tokens            // Claude (raw)
            ?? usage.cached_input_tokens             // Normalized (llm_service)
            ?? usage.prompt_tokens_details?.cached_tokens  // OpenAI Chat API
            ?? usage.input_tokens_details?.cached_tokens   // OpenAI Responses API
            ?? 0
        // Cache-creation (write) tokens — Anthropic only. Billed at 1.25× base.
        const cache_creation_input_tokens =
            usage.cache_creation_input_tokens
            ?? 0

        if (total_tokens) {
            ctx.logEvent(`Token Usage=${total_tokens}`)
        }

        // Check estimation drift against actual token count
        if (prompt_tokens) {
            const contextStatus = ctx.getContextStatus()
            const drift = calculateDrift(contextStatus.totalUsed, prompt_tokens)
            if (drift > 0.15) {
                ctx.log(`Token estimate drift: ${(drift * 100).toFixed(1)}% (estimated=${contextStatus.totalUsed}, actual=${prompt_tokens})`)
            }
        }

        // Update usage stats
        if (prompt_tokens && completion_tokens) {
            ctx.updateUsage({
                input_tokens: prompt_tokens,
                output_tokens: completion_tokens,
                cached_input_tokens,
                cache_creation_input_tokens,
            })
        }

        // New Responses API returns output_text instead of choices[0].message.parsed
        let output: CodeOutput
        if (jsonData.output_text) {
            output = JSON.parse(jsonData.output_text)
        } else if (jsonData.choices?.[0]?.message?.parsed) {
            output = jsonData.choices[0].message.parsed
        } else {
            throw new Error('Unexpected response format: no output_text or parsed content')
        }

        console.log(output)
        ctx.log("Output received")

        // Add code output as cortex message
        ctx.addCortexMessage(JSON.stringify(output))

        // Emit thoughts
        ctx.emitEvent({ 'type': 'thought', 'thought': output.thoughts })

        // Add LLM invocation event to insights
        if (ctx.insights) {
            ctx.insights.addLLMInvocation({
                model: ctx.model,
                provider: ctx.provider,
                mode: 'code_generation',
                prompt_tokens: prompt_tokens || 0,
                completion_tokens: completion_tokens || 0,
                latency_ms: llmLatency,
                status: 'success',
                context: {
                    loop,
                    messages_count: ctx.messages.length,
                    output,
                    cached_input_tokens,
                    cache_creation_input_tokens,
                    timing: timingContext,
                },
            }).catch((err: any) => {
                ctx.log(`Error adding insights event: ${err}`)
            })
        }

        // Emit code execution start event
        ctx.emitEvent({
            type: 'code_execution_start',
            code: output.code,
            executionId: `exec_${Date.now()}`
        })

        // Execute code in sandbox
        this._checkCancelled(ctx)
        const startTime = Date.now()
        const result = await ctx.runCodeOutput(output)
        const duration = Date.now() - startTime

        // Emit code execution complete event
        ctx.emitEvent({
            type: 'code_execution_complete',
            status: result.error ? 'error' : 'success',
            error: result.error,
            duration,
            result: result.result
        })

        // Add execution event to insights
        if (ctx.insights) {
            const functionCalls = result.events?.filter((e: any) => e.type === 'function_start')?.length || 0
            const variableAssignments = result.events?.filter((e: any) => e.type === 'variable_set')?.length || 0
            const logsCount = result.events?.filter((e: any) => e.type === 'log')?.length || 0

            ctx.insights.addExecution({
                execution_type: 'code_sandbox',
                status: result.error ? 'error' : 'success',
                duration_ms: duration,
                error: result.error,
                function_calls: functionCalls,
                variables_assigned: variableAssignments,
                logs_count: logsCount,
                context: {
                    code_length: output.code.length,
                    thoughts: output.thoughts,
                    code: output.code,
                    result,
                }
            }).catch((err: any) => {
                ctx.log(`Error adding execution insights event: ${err}`)
            })
        }

        // Check if execution succeeded
        const executionFailed = result.error

        // Check if the LAST function call was respond_to_user
        let lastFunctionCallWasRespondToUser = false
        let lastFunctionCallEvent: any = null
        if (!executionFailed && result.events && result.events.length > 0) {
            const functionStartEvents = result.events.filter((e: any) => e.type === 'function_start')
            if (functionStartEvents.length > 0) {
                lastFunctionCallEvent = functionStartEvents[functionStartEvents.length - 1]
                lastFunctionCallWasRespondToUser = lastFunctionCallEvent.data?.name === 'respond_to_user'
                ctx.log(`Last function call: ${lastFunctionCallEvent.data?.name}`)
            }
        }

        // Strip events before adding to LLM context
        const resultForLLM = {
            name: result.name,
            error: result.error,
            result: result.result
        }
        ctx.addUserResultInput(resultForLLM)

        // Only consider it done if execution succeeded and last function call was respond_to_user
        const isComplete = !executionFailed && lastFunctionCallWasRespondToUser

        if (isComplete) {
            if (lastFunctionCallEvent?.data?.args && lastFunctionCallEvent.data.args.length > 0) {
                const firstArg = lastFunctionCallEvent.data.args[0]
                const responseText = typeof firstArg === 'object' && firstArg.response
                    ? firstArg.response
                    : firstArg
                return responseText
            }
            return "done"
        }

        // Code didn't call respond_to_user or failed, LLM needs to continue
        if (loop > 0) {
            this._checkCancelled(ctx)
            ctx.log(`Continuing LLM invocation::  [loops remaining: ${loop}] - Error=${result.error}`)
            return await this._runLLM(ctx, loop - 1)
        } else if (loop === 0) {
            this._checkCancelled(ctx)
            ctx.log(`Loop limit reached without respond_to_user, adding instruction message`)
            const loopLimitMessage: CodeExecutionResult = {
                name: "system_message",
                error: false,
                result: "Loop limit reached. You must now call respond_to_user with the current status of the task."
            }
            ctx.addUserResultInput(loopLimitMessage)
            return await this._runLLM(ctx, -1)
        } else {
            ctx.log(`Final loop limit reached without respond_to_user, forcing stop`)
            return "done"
        }
    }
}
