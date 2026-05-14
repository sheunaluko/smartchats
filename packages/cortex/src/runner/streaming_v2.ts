/**
 * Streaming Runner (v1) — Protocol V4
 *
 * Uses a delimited text stream so responses stream to TTS sentence-by-sentence
 * and thoughts trail at the end.
 *
 * Delimiter Protocol (V4):
 *   <<<RESPONSE>>> [spoken text] <<<CODE>>> [js] <<<THOUGHTS>>> [reasoning]
 *
 * - RESPONSE: Spoken text → emits response_chunk events (streams to TTS)
 * - CODE: JavaScript → buffered and executed when stream completes
 * - THOUGHTS: Reasoning text → trails at end for observability
 *
 * Must have at least RESPONSE or CODE. THOUGHTS is required but comes last.
 * Completion logic:
 *   CODE present → execute + continue loop. No CODE → turn complete.
 */

import type { Runner, RunnerContext, RunnerPromptFormat } from './types.js'
import { CortexCancelledError } from './types.js'
import type { ContextModule } from '../system_context_manager.js'
import type { CodeOutput, CodeExecutionResult } from '../types.js'
import { logger } from 'smartchats-common'

const log = logger.get_logger({ id: 'runner:stream_v2' })

// ── Section Delimiter ──

const DEFAULT_DELIMITER_PREFIX = '<<<'
const DEFAULT_DELIMITER_SUFFIX = '>>>'

type SectionType = 'START' | 'THOUGHTS' | 'RESPONSE' | 'CODE'

const SECTIONS: SectionType[] = ['START', 'RESPONSE', 'CODE', 'THOUGHTS']

function makeDelimiter(section: SectionType): string {
    return `${DEFAULT_DELIMITER_PREFIX}${section}${DEFAULT_DELIMITER_SUFFIX}`
}

// ── Stream Parser ──

interface StreamParserCallbacks {
    onThoughtChunk?: (text: string) => void
    onResponseChunk?: (text: string) => void
}

interface ParsedSections {
    thoughts: string
    response: string
    code: string
}

export class StreamParser {
    private buffer = ''
    private currentSection: SectionType | null = null
    private sections: Record<SectionType, string> = {
        START: '',
        THOUGHTS: '',
        RESPONSE: '',
        CODE: ''
    }
    private thoughtsStarted = false
    hasResponse = false
    private callbacks: StreamParserCallbacks

    constructor(callbacks: StreamParserCallbacks = {}) {
        this.callbacks = callbacks
    }

    /**
     * Feed a text chunk into the parser.
     * Fires callbacks as sections are detected.
     */
    feed(chunk: string): void {
        // Once we're in THOUGHTS section (last), everything is thoughts (no more delimiter scanning)
        if (this.thoughtsStarted) {
            this.sections.THOUGHTS += chunk
            this.callbacks.onThoughtChunk?.(chunk)
            return
        }

        this.buffer += chunk

        // Scan buffer for delimiters
        this._scanBuffer()
    }

    private _scanBuffer(): void {
        while (true) {
            // Look for the next delimiter in the buffer
            const delimIdx = this.buffer.indexOf(DEFAULT_DELIMITER_PREFIX)

            if (delimIdx === -1) {
                // No full '<<<' found — but the buffer may end with a partial
                // prefix ('<' or '<<') that could complete with the next chunk.
                // Retain that suffix; flush only the safe portion.
                let keep = 0
                if (this.buffer.endsWith('<<')) keep = 2
                else if (this.buffer.endsWith('<')) keep = 1

                const flushEnd = this.buffer.length - keep
                if (flushEnd > 0 && this.currentSection) {
                    this._appendToSection(this.currentSection, this.buffer.slice(0, flushEnd))
                }
                this.buffer = keep > 0 ? this.buffer.slice(-keep) : ''
                return
            }

            // Check if we have a complete delimiter
            const afterPrefix = this.buffer.indexOf(DEFAULT_DELIMITER_SUFFIX, delimIdx + DEFAULT_DELIMITER_PREFIX.length)

            if (afterPrefix === -1) {
                // Incomplete delimiter — flush everything before it, keep the rest
                if (delimIdx > 0 && this.currentSection) {
                    this._appendToSection(this.currentSection, this.buffer.slice(0, delimIdx))
                }
                this.buffer = this.buffer.slice(delimIdx)
                return
            }

            // Extract the section name between <<< and >>>
            const sectionName = this.buffer.slice(
                delimIdx + DEFAULT_DELIMITER_PREFIX.length,
                afterPrefix
            ).trim() as SectionType

            // Flush content before the delimiter to current section
            if (delimIdx > 0 && this.currentSection) {
                this._appendToSection(this.currentSection, this.buffer.slice(0, delimIdx))
            }

            // Move past the delimiter
            this.buffer = this.buffer.slice(afterPrefix + DEFAULT_DELIMITER_SUFFIX.length)

            // Switch to new section
            if (SECTIONS.includes(sectionName)) {
                this.currentSection = sectionName

                if (sectionName === 'RESPONSE') {
                    this.hasResponse = true
                }

                if (sectionName === 'THOUGHTS') {
                    this.thoughtsStarted = true
                    // Everything remaining in buffer is thoughts (last section)
                    this.sections.THOUGHTS += this.buffer
                    if (this.buffer) this.callbacks.onThoughtChunk?.(this.buffer)
                    this.buffer = ''
                    return
                }
            }
        }
    }

    private _appendToSection(section: SectionType, text: string): void {
        this.sections[section] += text

        if (section === 'THOUGHTS' && text) {
            this.callbacks.onThoughtChunk?.(text)
        }

        if (section === 'RESPONSE' && text) {
            this.callbacks.onResponseChunk?.(text)
        }
    }

    /**
     * Finalize parsing — returns all accumulated sections.
     */
    finalize(): ParsedSections {
        // Flush any remaining buffer
        if (this.buffer && this.currentSection) {
            this.sections[this.currentSection] += this.buffer
            this.buffer = ''
        }

        // Strip <<<END>>> from thoughts (model generates it per prompt instructions,
        // but since it's the last section the parser doesn't consume it as a delimiter)
        const END_DELIM = `${DEFAULT_DELIMITER_PREFIX}END${DEFAULT_DELIMITER_SUFFIX}`
        let thoughts = this.sections.THOUGHTS.trim()
        if (thoughts.endsWith(END_DELIM)) {
            thoughts = thoughts.slice(0, -END_DELIM.length).trim()
        }

        return {
            thoughts,
            response: this.sections.RESPONSE.trim(),
            code: this.sections.CODE.trim()
        }
    }
}

// ── Streaming Output Format (replaces CodeOutput JSON schema) ──

const STREAMING_OUTPUT_FORMAT_TYPES = `
You respond with a DELIMITED TEXT STREAM (NOT JSON). Use section delimiters to separate your response into parts:

Format:
<<<START>>> <<<RESPONSE>>> [spoken text] and/or <<<CODE>>> [JavaScript] <<<THOUGHTS>>> [reasoning] <<<END>>>

Sections (in order):

0. <<<START>>> (REQUIRED, always first) — Signals the beginning of your response. You MUST start every response with this delimiter.

1. <<<RESPONSE>>> (OPTIONAL) — Your spoken response to the user. Streams directly to speech as you generate it.
   - This text is spoken out loud sentence-by-sentence as it arrives — keep it conversational and concise.
   - Do NOT use respond_to_user() — use this section instead.

2. <<<CODE>>> (OPTIONAL) — JavaScript code to execute in the sandbox.
   - All the same rules apply: use unqualified assignments, etc.
   - DO NOT wrap code in backticks or code blocks — just write raw JavaScript.
   - Do NOT call respond_to_user() — use the <<<RESPONSE>>> section for spoken responses.

3. <<<THOUGHTS>>> (REQUIRED, always last before END) — Your reasoning about what you did and why.

4. <<<END>>> (REQUIRED, always after THOUGHTS) — Signals the end of your response. You MUST end every response with this delimiter. Never generate anything after it.

RULES:
- You MUST begin every response with <<<START>>> and end with <<<END>>>. Generate EXACTLY ONE cycle per response.
- THOUGHTS is required and MUST be the last section before <<<END>>>.
- You MUST include at least RESPONSE or CODE (or both) — UNLESS you are passing (see below).
- If CODE is present → code executes and the agentic loop continues (you'll get the result and respond next turn).
- If only RESPONSE (no CODE) → turn is complete (your response has been spoken).
- RESPONSE + CODE is valid: your response streams to speech while code executes in parallel.
  Use this for "Let me look that up..." patterns where you want to speak while working.
- PASS (thoughts-only): If there is nothing to do — e.g. a subprocess result was already relayed to the user, or the current context requires no action — respond with ONLY <<<START>>> <<<THOUGHTS>>> [your reasoning] <<<END>>>. This silently ends the turn with no speech or code execution.
`

const STREAMING_OUTPUT_FORMAT_EXAMPLES = `
[Example] Simple greeting (RESPONSE only → turn complete):
<<<START>>> <<<RESPONSE>>> Hey there! How can I help you today? <<<THOUGHTS>>> User greeted me, responding directly. <<<END>>>

[Example] Knowledge search turn 1 (CODE present → loop continues):
<<<START>>> <<<CODE>>> results = await retrieve_declarative_knowledge({query: "tidyscripts", limit: 5});
return results; <<<THOUGHTS>>> User asked about tidyscripts. Need to search first, then respond next turn. <<<END>>>

[Example] Knowledge search turn 2 (RESPONSE only → turn complete):
<<<START>>> <<<RESPONSE>>> I found 3 entries about tidyscripts. The main one describes it as a TypeScript utility library for web and Node development. <<<THOUGHTS>>> Found results in last_result. There are 3 entries about tidyscripts. <<<END>>>

[Example] Verbal status + code (RESPONSE + CODE → speaks while executing, loop continues):
<<<START>>> <<<RESPONSE>>> Let me look that up for you right now. <<<CODE>>> results = await retrieve_declarative_knowledge({query: "tidyscripts architecture", limit: 5});
return results; <<<THOUGHTS>>> Told the user I'm looking it up while I search in parallel. <<<END>>>

[Example] Empathy response (RESPONSE only → turn complete):
<<<START>>> <<<RESPONSE>>> That sounds really tough. I'm here if you want to talk about it. <<<THOUGHTS>>> User shared something difficult. Responded with empathy. <<<END>>>

[Example] Pass — nothing to do (thoughts-only → silent turn complete):
<<<START>>> <<<THOUGHTS>>> Re-invoked after subprocess completion, but I already relayed the result to the user in the previous turn. Nothing to do. <<<END>>>
`

// ── History Record ──

export interface StreamingLLMRecord {
    timestamp: number
    raw: string
    parsed: ParsedSections
    model: string
    latency_ms: number
}

// ── Streaming Runner Options ──

export interface StreamingRunnerOptions {
    /**
     * The streaming LLM call function.
     * Must return { stream: AsyncIterable<string>, data: Promise<any> }
     */
    streamingLlmCallFn: (args: {
        model: string
        input: any[]
        max_tokens?: number
        temperature?: number
        stop?: string[]
    }) => Promise<{
        stream: AsyncIterable<string>
        data: Promise<any>
    }>

    /** Log every raw chunk to console (togglable at runtime via runner.verbose) */
    verbose?: boolean
}

// ── Streaming Runner ──

export class StreamingRunner implements Runner {
    readonly id = 'streaming_v2'
    private streamingLlmCallFn: StreamingRunnerOptions['streamingLlmCallFn']
    history: StreamingLLMRecord[] = []
    verbose: boolean

    constructor(options: StreamingRunnerOptions) {
        this.streamingLlmCallFn = options.streamingLlmCallFn
        this.verbose = options.verbose ?? false
    }

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
            // No output_structure — streaming uses text-based protocol, not JSON schema
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
            return await this._runStreaming(ctx, maxLoops)
        } finally {
            if (ctx.insights) {
                ctx.insights.endChain()
            }
        }
    }

    private async _runStreaming(ctx: RunnerContext, loop: number): Promise<string> {
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

        ctx.log(`[Streaming LLM Call] model=${model}, provider=${ctx.provider}`)
        ctx.logEvent(`Streaming | Provider: ${ctx.provider} | Model: ${model}`)

        const fetchStart = Date.now()

        this._checkCancelled(ctx)

        // Start streaming call
        const { stream, data } = await this.streamingLlmCallFn({
            model,
            input: messages,
        })

        // Prevent unhandled rejection if stream is cancelled before data resolves
        data.catch(() => {})

        // Parse stream with callbacks for immediate events
        const parser = new StreamParser({
            onThoughtChunk: (chunk) => {
                ctx.emitEvent({ type: 'thought_chunk', chunk })
            },
            onResponseChunk: (chunk) => {
                ctx.emitEvent({ type: 'response_chunk', chunk, ts: Date.now() })
            }
        })

        // Consume the stream
        let firstChunkTs: number | null = null
        let rawText = ''
        for await (const chunk of stream) {
            this._checkCancelled(ctx)
            if (!firstChunkTs) firstChunkTs = Date.now()
            rawText += chunk
            if (this.verbose) log(`[chunk] ${chunk.slice(0, 80)}`)
            ctx.emitEvent({ type: 'stream_chunk', chunk, ts: Date.now() })
            parser.feed(chunk)
        }

        const fetchEnd = Date.now()
        const llmLatency = fetchEnd - fetchStart

        // Finalize parsing
        const parsed = parser.finalize()
        ctx.emitEvent({ type: 'stream_end', ts: Date.now(), latency_ms: llmLatency })
        ctx.log(`Stream complete: thoughts=${parsed.thoughts.length}chars, response=${parsed.response.length}chars, code=${parsed.code.length}chars`)

        // Record raw LLM response for debugging (window.COR.runner.history)
        this.history.push({ timestamp: Date.now(), raw: rawText, parsed, model, latency_ms: llmLatency })

        // Wait for aggregated response (usage/billing data)
        let aggregatedData: any = {}
        try {
            aggregatedData = await data
        } catch (err) {
            ctx.log(`Warning: aggregated data promise rejected: ${err}`)
        }

        // Extract usage
        const usage = aggregatedData.usage || {}
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

        // Add as cortex message (format-consistent with sync runner)
        ctx.addCortexMessage(JSON.stringify(output))

        // Emit full thought — the store replaces the streaming ⏳ entry with this clean version
        ctx.emitEvent({ type: 'thought', thought: output.thoughts })

        // Add LLM invocation to insights
        if (ctx.insights) {
            ctx.insights.addLLMInvocation({
                model: ctx.model,
                provider: ctx.provider,
                mode: 'streaming_code_generation',
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
                    timing: {
                        client_round_trip_ms: llmLatency,
                        time_to_first_chunk_ms: firstChunkTs ? firstChunkTs - fetchStart : null,
                    },
                },
            }).catch((err: any) => {
                ctx.log(`Error adding insights event: ${err}`)
            })
        }

        // ── Completion logic (V4 protocol) ──
        // CODE present → execute + continue agentic loop
        // No CODE, RESPONSE present → turn complete
        // RESPONSE text is always streamed to TTS when present (via response_chunk events during parsing)

        const hasResponse = parser.hasResponse
        const hasCode = !!parsed.code

        // Emit response_complete when RESPONSE section was present
        // (response text already streamed to TTS via response_chunk events)
        if (hasResponse) {
            ctx.emitEvent({ type: 'response_complete', response: parsed.response, ts: Date.now(), server_tts: aggregatedData.tts || null })
        }

        // Case 1: No CODE — turn complete (response already spoken)
        if (hasResponse && !hasCode) {
            ctx.log(`RESPONSE-only turn complete: "${parsed.response.slice(0, 80)}..."`)
            return parsed.response
        }

        // Case 2: No RESPONSE and no CODE — thoughts-only "pass" (silent turn complete)
        if (!hasResponse && !hasCode) {
            ctx.log(`Thoughts-only pass (no-op): "${parsed.thoughts.slice(0, 80)}"`)
            return "done"
        }

        // Case 3: CODE present — execute code + continue loop
        this._checkCancelled(ctx)

        // Emit code execution start
        ctx.emitEvent({
            type: 'code_execution_start',
            code: output.code,
            executionId: `exec_${Date.now()}`
        })

        // Execute code in sandbox
        const startTime = Date.now()
        const result = await ctx.runCodeOutput(output)
        const duration = Date.now() - startTime

        // Emit code execution complete
        ctx.emitEvent({
            type: 'code_execution_complete',
            status: result.error ? 'error' : 'success',
            error: result.error,
            duration,
            result: result.result
        })

        // Insights for execution
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
                    has_response: hasResponse,
                    response: parsed.response || null,
                    result,
                    runner: this.id,
                }
            }).catch((err: any) => {
                ctx.log(`Error adding execution insights event: ${err}`)
            })
        }

        // Check for legacy respond_to_user completion (backward compat with sync runner sandbox)
        const executionFailed = result.error
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

        // Legacy respond_to_user completion (if LLM still calls it)
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

        // Continue looping (CODE present — agentic loop continues)
        if (loop > 0) {
            this._checkCancelled(ctx)
            ctx.log(`Continuing streaming LLM invocation:: [loops remaining: ${loop}] - Error=${result.error}`)
            return await this._runStreaming(ctx, loop - 1)
        } else if (loop === 0) {
            this._checkCancelled(ctx)
            ctx.log(`Loop limit reached, adding instruction message`)
            const loopLimitMessage: CodeExecutionResult = {
                name: "system_message",
                error: false,
                result: "Loop limit reached. You must now include a <<<RESPONSE>>> section with your response to the user."
            }
            ctx.addUserResultInput(loopLimitMessage)
            return await this._runStreaming(ctx, -1)
        } else {
            ctx.log(`Final loop limit reached, forcing stop`)
            return "done"
        }
    }
}
