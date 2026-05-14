/**
 * Synchronous Runner V2 — Delimited Text Protocol, Non-Streaming
 *
 * Uses the same delimited text protocol as StreamingRunner (V4):
 *   <<<RESPONSE>>> [spoken text] <<<CODE>>> [js] <<<THOUGHTS>>> [reasoning]
 *
 * But calls ctx.llmCallFn (regular non-streaming) instead of streamingLlmCallFn.
 * Designed for child/forked processes that don't need real-time TTS streaming.
 */

import type { Runner, RunnerContext, RunnerPromptFormat } from './types.js'
import { CortexCancelledError } from './types.js'
import type { ContextModule } from '../system_context_manager.js'
import type { CodeOutput, CodeExecutionResult } from '../types.js'
import { StreamParser } from './streaming_v2.js'
import { logger } from 'smartchats-common'

const log = logger.get_logger({ id: 'runner:sync_v2' })

// Re-use the same output module content as StreamingRunner
const STREAMING_OUTPUT_FORMAT_TYPES = `
You respond with a DELIMITED TEXT STREAM (NOT JSON). Use section delimiters to separate your response into parts:

Format:
<<<RESPONSE>>> [spoken text] and/or <<<CODE>>> [JavaScript] <<<THOUGHTS>>> [reasoning]

Sections (in order):

1. <<<RESPONSE>>> (OPTIONAL) — Your spoken response to the user. Streams directly to speech as you generate it.
   - This text is spoken out loud sentence-by-sentence as it arrives — keep it conversational and concise.
   - Do NOT use respond_to_user() — use this section instead.

2. <<<CODE>>> (OPTIONAL) — JavaScript code to execute in the sandbox.
   - All the same rules apply: use unqualified assignments, etc.
   - DO NOT wrap code in backticks or code blocks — just write raw JavaScript.
   - Do NOT call respond_to_user() — use the <<<RESPONSE>>> section for spoken responses.

3. <<<THOUGHTS>>> (REQUIRED, always last) — Your reasoning about what you did and why.

RULES:
- THOUGHTS is required and MUST be the last section.
- You MUST include at least RESPONSE or CODE (or both).
- If CODE is present → code executes and the agentic loop continues (you'll get the result and respond next turn).
- If only RESPONSE (no CODE) → turn is complete (your response has been spoken).
- RESPONSE + CODE is valid: your response streams to speech while code executes in parallel.
  Use this for "Let me look that up..." patterns where you want to speak while working.
`

const STREAMING_OUTPUT_FORMAT_EXAMPLES = `
[Example] Simple greeting (RESPONSE only → turn complete):
<<<RESPONSE>>> Hey there! How can I help you today? <<<THOUGHTS>>> User greeted me, responding directly.

[Example] Knowledge search turn 1 (CODE present → loop continues):
<<<CODE>>> results = await retrieve_declarative_knowledge({query: "photosynthesis", limit: 5});
return results; <<<THOUGHTS>>> User asked about photosynthesis. Need to search first, then respond next turn.

[Example] Knowledge search turn 2 (RESPONSE only → turn complete):
<<<RESPONSE>>> I found 3 entries about photosynthesis. The main one summarizes the light-dependent reactions in plants. <<<THOUGHTS>>> Found results in last_result. There are 3 entries about photosynthesis.

[Example] Verbal status + code (RESPONSE + CODE → speaks while executing, loop continues):
<<<RESPONSE>>> Let me look that up for you right now. <<<CODE>>> results = await retrieve_declarative_knowledge({query: "photosynthesis enzymes", limit: 5});
return results; <<<THOUGHTS>>> Told the user I'm looking it up while I search in parallel.

[Example] Empathy response (RESPONSE only → turn complete):
<<<RESPONSE>>> That sounds really tough. I'm here if you want to talk about it. <<<THOUGHTS>>> User shared something difficult. Responded with empathy.
`

export class SynchronousRunnerV2 implements Runner {
    readonly id = 'synchronous_v2'

    getPromptFormat(): RunnerPromptFormat {
        return {
            sectionOverrides: {
                outputFormat: [STREAMING_OUTPUT_FORMAT_TYPES, STREAMING_OUTPUT_FORMAT_EXAMPLES]
            }
        }
    }

    getOutputModule(): ContextModule {
        return {
            id: 'output',
            name: 'Streaming Output Format',
            position: 80,
            output_instructions: `${STREAMING_OUTPUT_FORMAT_TYPES}\n${STREAMING_OUTPUT_FORMAT_EXAMPLES}`,
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
            return await this._run(ctx, maxLoops)
        } finally {
            if (ctx.insights) {
                ctx.insights.endChain()
            }
        }
    }

    private async _run(ctx: RunnerContext, loop: number): Promise<string> {
        const messages = ctx.buildMessages()
        const model = ctx.model

        // Emit context status
        const contextStatus = ctx.getContextStatus()
        ctx.emitEvent({ type: 'context_status', status: contextStatus })

        if (contextStatus.isAtLimit) {
            ctx.logEvent(`WARNING: Context at ${contextStatus.usagePercent}% capacity`)
        } else if (contextStatus.isApproachingLimit) {
            ctx.logEvent(`Context approaching limit: ${contextStatus.usagePercent}%`)
        }

        ctx.log(`[SyncV2 LLM Call] model=${model}, provider=${ctx.provider}`)
        ctx.logEvent(`SyncV2 | Provider: ${ctx.provider} | Model: ${model}`)

        const fetchStart = Date.now()

        this._checkCancelled(ctx)

        // Regular (non-streaming) LLM call — no schema, free text output
        if (!ctx.llmCallFn) {
            throw new Error('SynchronousRunnerV2 requires ctx.llmCallFn')
        }

        const result = await ctx.llmCallFn({
            model,
            input: messages,
            // No schema/schema_name — free text output with delimited protocol
        })

        const fetchEnd = Date.now()
        const llmLatency = fetchEnd - fetchStart

        // Handle error responses
        const jsonData = typeof result.json === 'function' ? await result.json() : result

        if (jsonData.error) {
            ctx.log(`API Error: ${jsonData.error}`)
            throw new Error(jsonData.error)
        }

        // Extract the text output
        const rawText = jsonData.output_text || ''

        // Parse using StreamParser (feed all at once, then finalize)
        const parser = new StreamParser()
        parser.feed(rawText)
        const parsed = parser.finalize()

        ctx.log(`SyncV2 complete: thoughts=${parsed.thoughts.length}chars, response=${parsed.response.length}chars, code=${parsed.code.length}chars`)

        // Extract usage
        const usage = jsonData.usage || {}
        const prompt_tokens = usage.prompt_tokens ?? usage.input_tokens ?? 0
        const completion_tokens = usage.completion_tokens ?? usage.output_tokens ?? 0
        const cached_input_tokens = usage.cached_input_tokens ?? 0

        if (prompt_tokens && completion_tokens) {
            ctx.updateUsage(prompt_tokens, completion_tokens, cached_input_tokens)
        }

        // Store as CodeOutput-compatible format in message history
        const output: CodeOutput = {
            thoughts: parsed.thoughts,
            code: parsed.code,
            response: parsed.response || undefined,
        }

        ctx.addCortexMessage(JSON.stringify(output))
        ctx.emitEvent({ type: 'thought', thought: output.thoughts })

        // Add LLM invocation to insights
        if (ctx.insights) {
            ctx.insights.addLLMInvocation({
                model: ctx.model,
                provider: ctx.provider,
                mode: 'synchronous_v2_code_generation',
                prompt_tokens,
                completion_tokens,
                latency_ms: llmLatency,
                status: 'success',
                context: {
                    loop,
                    runner: this.id,
                    has_response: parser.hasResponse,
                    response: parsed.response || null,
                    messages_count: ctx.messages.length,
                    output,
                    cached_input_tokens,
                    timing: { client_round_trip_ms: llmLatency },
                },
            }).catch((err: any) => {
                ctx.log(`Error adding insights event: ${err}`)
            })
        }

        // ── Completion logic (same as StreamingRunner) ──
        const hasResponse = parser.hasResponse
        const hasCode = !!parsed.code

        if (hasResponse) {
            ctx.emitEvent({ type: 'response_complete', response: parsed.response, ts: Date.now(), server_tts: null })
        }

        // RESPONSE only → done
        if (hasResponse && !hasCode) {
            ctx.log(`RESPONSE-only turn complete: "${parsed.response.slice(0, 80)}..."`)
            return parsed.response
        }

        // No RESPONSE and no CODE → malformed
        if (!hasResponse && !hasCode) {
            ctx.log('No RESPONSE or CODE section in response')
            const noOutputResult: CodeExecutionResult = {
                name: 'code_execution',
                error: false,
                result: 'No RESPONSE or CODE section was generated. You must include at least one.'
            }
            ctx.addUserResultInput(noOutputResult)

            if (loop > 0) {
                this._checkCancelled(ctx)
                return await this._run(ctx, loop - 1)
            }
            return "done"
        }

        // CODE present → execute + continue loop
        this._checkCancelled(ctx)

        ctx.emitEvent({
            type: 'code_execution_start',
            code: output.code,
            executionId: `exec_${Date.now()}`
        })

        const startTime = Date.now()
        const execResult = await ctx.runCodeOutput(output)
        const duration = Date.now() - startTime

        ctx.emitEvent({
            type: 'code_execution_complete',
            status: execResult.error ? 'error' : 'success',
            error: execResult.error,
            duration,
            result: execResult.result
        })

        // Insights for execution
        if (ctx.insights) {
            const functionCalls = execResult.events?.filter((e: any) => e.type === 'function_start')?.length || 0
            const variableAssignments = execResult.events?.filter((e: any) => e.type === 'variable_set')?.length || 0
            const logsCount = execResult.events?.filter((e: any) => e.type === 'log')?.length || 0

            ctx.insights.addExecution({
                execution_type: 'code_sandbox',
                status: execResult.error ? 'error' : 'success',
                duration_ms: duration,
                error: execResult.error,
                function_calls: functionCalls,
                variables_assigned: variableAssignments,
                logs_count: logsCount,
                context: {
                    code_length: output.code.length,
                    thoughts: output.thoughts,
                    code: output.code,
                    has_response: hasResponse,
                    response: parsed.response || null,
                    result: execResult,
                    runner: this.id,
                }
            }).catch((err: any) => {
                ctx.log(`Error adding execution insights event: ${err}`)
            })
        }

        // Legacy respond_to_user check
        const executionFailed = execResult.error
        let lastFunctionCallWasRespondToUser = false
        let lastFunctionCallEvent: any = null
        if (!executionFailed && execResult.events && execResult.events.length > 0) {
            const functionStartEvents = execResult.events.filter((e: any) => e.type === 'function_start')
            if (functionStartEvents.length > 0) {
                lastFunctionCallEvent = functionStartEvents[functionStartEvents.length - 1]
                lastFunctionCallWasRespondToUser = lastFunctionCallEvent.data?.name === 'respond_to_user'
                ctx.log(`Last function call: ${lastFunctionCallEvent.data?.name}`)
            }
        }

        // Strip events before adding to LLM context
        const resultForLLM = {
            name: execResult.name,
            error: execResult.error,
            result: execResult.result
        }
        ctx.addUserResultInput(resultForLLM)

        // Legacy respond_to_user completion
        if (!executionFailed && lastFunctionCallWasRespondToUser) {
            if (lastFunctionCallEvent?.data?.args && lastFunctionCallEvent.data.args.length > 0) {
                const firstArg = lastFunctionCallEvent.data.args[0]
                const responseText = typeof firstArg === 'object' && firstArg.response
                    ? firstArg.response
                    : firstArg
                return responseText
            }
            return "done"
        }

        // Continue looping
        if (loop > 0) {
            this._checkCancelled(ctx)
            ctx.log(`Continuing SyncV2 LLM invocation:: [loops remaining: ${loop}] - Error=${execResult.error}`)
            return await this._run(ctx, loop - 1)
        } else if (loop === 0) {
            this._checkCancelled(ctx)
            ctx.log(`Loop limit reached, adding instruction message`)
            const loopLimitMessage: CodeExecutionResult = {
                name: "system_message",
                error: false,
                result: "Loop limit reached. You must now include a <<<RESPONSE>>> section with your response to the user."
            }
            ctx.addUserResultInput(loopLimitMessage)
            return await this._run(ctx, -1)
        } else {
            ctx.log(`Final loop limit reached, forcing stop`)
            return "done"
        }
    }
}
