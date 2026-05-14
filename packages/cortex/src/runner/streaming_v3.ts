/**
 * Streaming Runner V3 — Structured JSON Output
 *
 * Uses OpenAI Responses API structured output (json_schema format) with streaming.
 * The API enforces valid JSON at the token level, eliminating multi-cycle hallucination.
 *
 * JSON schema: { response: string|null, code: string|null, thoughts: string }
 * Field order matters: response streams to TTS first, then code, then thoughts.
 *
 * The JsonStreamParser processes incremental JSON characters, firing callbacks
 * as response/thoughts content is extracted.
 */

import type { Runner, RunnerContext, RunnerPromptFormat } from './types.js'
import { CortexCancelledError } from './types.js'
import type { ContextModule } from '../system_context_manager.js'
import type { CodeOutput, CodeExecutionResult } from '../types.js'
import { logger } from 'smartchats-common'

const log = logger.get_logger({ id: 'runner:stream_v3' })

// ── JSON Schema for structured output ──

export const STRUCTURED_OUTPUT_SCHEMA = {
    type: 'object' as const,
    properties: {
        response: { type: ['string', 'null'] as const },
        code:     { type: ['string', 'null'] as const },
        thoughts: { type: 'string' as const },
    },
    required: ['response', 'code', 'thoughts'] as const,
    additionalProperties: false as const,
}

export const STRUCTURED_OUTPUT_TEXT_FORMAT = {
    type: 'json_schema' as const,
    name: 'cortex_output',
    strict: true,
    schema: STRUCTURED_OUTPUT_SCHEMA,
}

// ── JSON Stream Parser ──

type ParserState = 'SCANNING' | 'IN_KEY' | 'BEFORE_VALUE' | 'IN_STRING_VALUE' | 'IN_NULL'

export interface JsonStreamParserCallbacks {
    onResponseChunk?: (text: string) => void
    onTextStreamDone?: () => void
    onThoughtChunk?: (text: string) => void
}

interface JsonStreamParserResult {
    response: string | null
    code: string | null
    thoughts: string
}

/**
 * Character-by-character state machine for parsing streamed JSON.
 *
 * Expects JSON matching the cortex_output schema:
 *   { "response": "...", "code": "...", "thoughts": "..." }
 *
 * Fires callbacks as content is extracted from response/thoughts fields.
 * Batches response text and flushes on sentence-ending punctuation for TTS.
 */
export class JsonStreamParser {
    private state: ParserState = 'SCANNING'
    private currentKey = ''
    private currentValue = ''
    private escape = false
    private callbacks: JsonStreamParserCallbacks

    // Accumulated field values
    private responseValue: string | null = null
    private codeValue: string | null = null
    private thoughtsValue = ''

    // Track which field is currently being parsed
    private activeField: 'response' | 'code' | 'thoughts' | null = null

    // Null value detection
    private nullBuffer = ''

    // Sentence batching for TTS
    private responseBatch = ''

    hasResponse = false
    hasCode = false

    constructor(callbacks: JsonStreamParserCallbacks = {}) {
        this.callbacks = callbacks
    }

    /**
     * Feed a chunk of streamed JSON text into the parser.
     */
    feed(chunk: string): void {
        logger.simi_debug(`[parser.feed] +${chunk.length}ch state=${this.state} field=${this.activeField} chunk=${JSON.stringify(chunk.slice(0, 80))}`)
        for (let i = 0; i < chunk.length; i++) {
            this._processChar(chunk[i])
        }
    }

    private _processChar(ch: string): void {
        switch (this.state) {
            case 'SCANNING':
                if (ch === '"') {
                    this.state = 'IN_KEY'
                    this.currentKey = ''
                }
                break

            case 'IN_KEY':
                if (ch === '"') {
                    this.state = 'BEFORE_VALUE'
                } else {
                    this.currentKey += ch
                }
                break

            case 'BEFORE_VALUE':
                if (ch === '"') {
                    // Start of string value
                    this.state = 'IN_STRING_VALUE'
                    this.currentValue = ''
                    this.escape = false
                    this.activeField = this._fieldFromKey(this.currentKey)
                } else if (ch === 'n') {
                    // Possible null
                    this.state = 'IN_NULL'
                    this.nullBuffer = 'n'
                    this.activeField = this._fieldFromKey(this.currentKey)
                }
                // Skip colons, spaces, etc.
                break

            case 'IN_STRING_VALUE':
                if (this.escape) {
                    const unescaped = this._unescape(ch)
                    this._appendToField(unescaped)
                    this.escape = false
                } else if (ch === '\\') {
                    this.escape = true
                } else if (ch === '"') {
                    // End of string value — flush any remaining batch
                    this._flushResponseBatch()
                    this._finalizeField()
                    this.state = 'SCANNING'
                } else {
                    this._appendToField(ch)
                }
                break

            case 'IN_NULL':
                this.nullBuffer += ch
                if (this.nullBuffer === 'null') {
                    // null value complete
                    this._finalizeFieldNull()
                    this.state = 'SCANNING'
                } else if (!'null'.startsWith(this.nullBuffer)) {
                    // Not a null — shouldn't happen with structured output
                    this.state = 'SCANNING'
                }
                break
        }
    }

    private _fieldFromKey(key: string): 'response' | 'code' | 'thoughts' | null {
        if (key === 'response' || key === 'code' || key === 'thoughts') return key
        return null
    }

    private _unescape(ch: string): string {
        switch (ch) {
            case 'n': return '\n'
            case 't': return '\t'
            case 'r': return '\r'
            case '"': return '"'
            case '\\': return '\\'
            case '/': return '/'
            default: return ch
        }
    }

    private _appendToField(ch: string): void {
        if (!this.activeField) return

        this.currentValue += ch

        if (this.activeField === 'response') {
            this.responseBatch += ch
            // Flush on sentence-ending punctuation followed by natural break
            if (this._isSentenceEnd(ch)) {
                this._flushResponseBatch()
            }
        } else if (this.activeField === 'thoughts') {
            this.callbacks.onThoughtChunk?.(ch)
        }
        // code: buffer silently
    }

    private _isSentenceEnd(ch: string): boolean {
        // Flush on . ! ? — the TTS will handle natural pacing
        return ch === '.' || ch === '!' || ch === '?'
    }

    private _flushResponseBatch(): void {
        if (this.responseBatch) {
            logger.simi_debug(`[parser.flush] response ${JSON.stringify(this.responseBatch.slice(0, 80))}`)
            this.callbacks.onResponseChunk?.(this.responseBatch)
            this.responseBatch = ''
        }
    }

    private _finalizeField(): void {
        if (!this.activeField) return

        switch (this.activeField) {
            case 'response':
                this.responseValue = this.currentValue
                if (this.currentValue) {
                    this.hasResponse = true
                    this.callbacks.onTextStreamDone?.()
                }
                break
            case 'code':
                this.codeValue = this.currentValue
                if (this.currentValue) this.hasCode = true
                break
            case 'thoughts':
                this.thoughtsValue = this.currentValue
                break
        }

        this.currentValue = ''
        this.activeField = null
    }

    private _finalizeFieldNull(): void {
        if (!this.activeField) return

        switch (this.activeField) {
            case 'response':
                this.responseValue = null
                break
            case 'code':
                this.codeValue = null
                break
            case 'thoughts':
                this.thoughtsValue = ''
                break
        }

        this.activeField = null
        this.nullBuffer = ''
    }

    /**
     * Finalize parsing and return accumulated field values.
     */
    finalize(): JsonStreamParserResult {
        // Finalize any field still being parsed when stream ends
        // (e.g. if stream ended before the closing quote of the code field)
        if (this.activeField && this.currentValue) {
            this._finalizeField()
        }

        // Flush any remaining response batch
        this._flushResponseBatch()

        return {
            response: this.responseValue,
            code: this.codeValue,
            thoughts: this.thoughtsValue,
        }
    }
}

// ── Output format prompt (no delimiter instructions) ──

const STRUCTURED_OUTPUT_INSTRUCTIONS = `
You respond with a JSON object containing three fields:

{
  "response": "Your spoken response to the user (or null if not responding)",
  "code": "JavaScript code to execute in the sandbox (or null if no code)",
  "thoughts": "Your reasoning about what you did and why"
}

FIELD RULES:

1. "response" (string or null) — Your spoken response to the user.
   - This text is spoken out loud via TTS — keep it conversational and concise.
   - Set to null if you have no spoken response (e.g. code-only or pass turns).
   - Do NOT call respond_to_user() — use this field instead.

2. "code" (string or null) — JavaScript code to execute in the sandbox.
   - All the same rules apply: use unqualified assignments, etc.
   - Set to null if no code execution needed.
   - Do NOT call respond_to_user() — use the "response" field for spoken responses.

3. "thoughts" (string, required) — Your reasoning about what you did and why.

COMPLETION LOGIC:
- response set + no code → turn complete (response is spoken).
- code set → code executes, agentic loop continues (you'll get the result next turn).
- response + code → response streams to TTS while code executes in parallel.
- null response + null code → thoughts-only "pass" (silent turn complete). Use when there's nothing to do.

IMPORTANT — clarifying questions:
- If you are unsure about the user's intent and need to ask a clarifying question, use response only with null code. Do NOT execute code in the same turn as a clarifying question. Wait for the user's answer, then act.

HARD RULE — optional/permission phrasing blocks execution:
- If your response contains optional or permission-seeking language ("if you want", "I can", "would you like me to", "should I", "do you want me to", "shall I", "let me know if"), you MUST set code to null. No tool calls, no CLI commands, no code execution in the same turn. Wait for an explicit yes/no from the user, then act on the next turn.

SAFETY TIERS — tool use:
- Basic read-only repo checks (pwd, git status, git rev-parse, ls) may run when the user asks to check the repo state.
- Inspecting specific file contents, reading sensitive config, or any action that modifies state (writes, deletes, git push, process spawning) requires explicit user confirmation first.

EXAMPLES:

Simple greeting (response only → turn complete):
{"response": "Hey there! How can I help you today?", "code": null, "thoughts": "User greeted me, responding directly."}

Knowledge search turn 1 (code → loop continues):
{"response": null, "code": "results = await retrieve_declarative_knowledge({query: \\"tidyscripts\\", limit: 5});\\nreturn results;", "thoughts": "User asked about tidyscripts. Need to search first."}

Knowledge search turn 2 (response only → turn complete):
{"response": "I found 3 entries about tidyscripts. The main one describes it as a TypeScript utility library.", "code": null, "thoughts": "Found results in last_result. Summarizing for user."}

Verbal status + code (response + code → speaks while executing):
{"response": "Let me look that up for you right now.", "code": "results = await retrieve_declarative_knowledge({query: \\"architecture\\", limit: 5});\\nreturn results;", "thoughts": "Told the user I'm looking it up while I search in parallel."}

Pass — nothing to do (thoughts-only → silent turn complete):
{"response": null, "code": null, "thoughts": "Re-invoked after subprocess completion, but result was already relayed."}

Clarifying question (response only → wait for user answer, no code):
{"response": "Do you want me to forward your voice directly into the CLI, or just send a text message?", "code": null, "thoughts": "User's request is ambiguous — need to clarify before acting."}
`

// ── History Record ──

export interface StreamingV3LLMRecord {
    timestamp: number
    raw: string
    parsed: JsonStreamParserResult
    model: string
    latency_ms: number
}

// ── Streaming Runner V3 Options ──

export interface StreamingRunnerV3Options {
    /**
     * The streaming LLM call function.
     * Must return { stream: AsyncIterable<string>, data: Promise<any> }
     */
    streamingLlmCallFn: (args: {
        model: string
        input: any[]
        max_tokens?: number
        temperature?: number
        text_format?: { type: 'json_schema', name: string, strict: boolean, schema: Record<string, any> }
        signal?: AbortSignal
    }) => Promise<{
        stream: AsyncIterable<string>
        data: Promise<any>
    }>

    /** Log every raw chunk to console (togglable at runtime via runner.verbose) */
    verbose?: boolean
}

// ── Streaming Runner V3 ──

export class StreamingRunnerV3 implements Runner {
    readonly id = 'streaming_v3'
    private streamingLlmCallFn: StreamingRunnerV3Options['streamingLlmCallFn']
    history: StreamingV3LLMRecord[] = []
    verbose: boolean

    constructor(options: StreamingRunnerV3Options) {
        this.streamingLlmCallFn = options.streamingLlmCallFn
        this.verbose = options.verbose ?? false
    }

    /**
     * Fire-and-forget warmup call. Hits the same backend endpoint as the
     * streaming path so the first real interaction lands on a hot worker.
     * The server short-circuits before any LLM invocation.
     */
    async warmup(): Promise<void> {
        try {
            await this.streamingLlmCallFn({ model: '', input: [], warmup: true } as any)
        } catch {
            // Swallow — warmup is best-effort
        }
    }

    getPromptFormat(): RunnerPromptFormat {
        return {
            sectionOverrides: {
                outputFormat: [STRUCTURED_OUTPUT_INSTRUCTIONS]
            }
        }
    }

    getOutputModule(): ContextModule {
        return {
            id: 'output',
            name: 'Structured JSON Output Format',
            position: 80,
            output_instructions: STRUCTURED_OUTPUT_INSTRUCTIONS,
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

        ctx.log(`[Streaming V3 LLM Call] model=${model}, provider=${ctx.provider}`)
        ctx.logEvent(`Streaming V3 | Provider: ${ctx.provider} | Model: ${model}`)

        const fetchStart = Date.now()

        this._checkCancelled(ctx)

        // Start streaming call with structured output format, passing abort signal
        let stream: AsyncIterable<string>
        let data: Promise<any>
        try {
            const result = await this.streamingLlmCallFn({
                model,
                input: messages,
                text_format: STRUCTURED_OUTPUT_TEXT_FORMAT,
                signal: ctx.signal,
            })
            stream = result.stream
            data = result.data
        } catch (err: any) {
            // fetch throws AbortError or DOMException when the signal fires
            if (ctx.signal?.aborted) throw new CortexCancelledError()
            throw err
        }

        // Prevent unhandled rejection if stream is cancelled before data resolves
        data.catch(() => {})

        // Parse stream with callbacks for immediate events
        const parser = new JsonStreamParser({
            onThoughtChunk: (chunk) => {
                ctx.emitEvent({ type: 'thought_chunk', chunk })
            },
            onResponseChunk: (chunk) => {
                ctx.emitEvent({ type: 'response_chunk', chunk, ts: Date.now() })
            },
            onTextStreamDone: () => {
                ctx.emitEvent({ type: 'text_stream_done', ts: Date.now() })
            }
        })

        // Consume the stream
        let firstChunkTs: number | null = null
        let rawText = ''
        try {
            for await (const chunk of stream) {
                this._checkCancelled(ctx)
                if (!firstChunkTs) firstChunkTs = Date.now()
                rawText += chunk
                if (this.verbose) log(`[chunk] ${chunk.slice(0, 80)}`)
                ctx.emitEvent({ type: 'stream_chunk', chunk, ts: Date.now() })
                parser.feed(chunk)
            }
        } catch (err: any) {
            if (ctx.signal?.aborted) throw new CortexCancelledError()
            throw err
        }

        const fetchEnd = Date.now()
        const llmLatency = fetchEnd - fetchStart

        // Finalize parsing
        const parsed = parser.finalize()
        ctx.emitEvent({ type: 'stream_end', ts: Date.now(), latency_ms: llmLatency })
        ctx.log(`Stream V3 complete: thoughts=${parsed.thoughts.length}chars, response=${parsed.response?.length ?? 0}chars, code=${parsed.code?.length ?? 0}chars`)

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
            code: parsed.code ?? '',
            response: parsed.response ?? undefined,
        }

        // Add as cortex message (format-consistent with sync runner)
        ctx.addCortexMessage(JSON.stringify(output))

        // Emit full thought — the store replaces the streaming entry with this clean version
        ctx.emitEvent({ type: 'thought', thought: output.thoughts })

        // Add LLM invocation to insights
        if (ctx.insights) {
            ctx.insights.addLLMInvocation({
                model: ctx.model,
                provider: ctx.provider,
                mode: 'streaming_v3_structured',
                prompt_tokens,
                completion_tokens,
                latency_ms: llmLatency,
                status: 'success',
                context: {
                    loop,
                    runner: this.id,
                    has_response: parser.hasResponse,
                    response: parsed.response,
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

        // ── Completion logic ──
        const hasResponse = parser.hasResponse
        const hasCode = parser.hasCode

        // Emit response_ready — full parsed response available before code execution
        ctx.emitEvent({ type: 'response_ready', response: parsed.response, thoughts: parsed.thoughts, hasCode, timestamp: Date.now() })

        // Emit response_complete when response was present
        if (hasResponse) {
            ctx.emitEvent({ type: 'response_complete', response: parsed.response, ts: Date.now(), server_tts: aggregatedData.tts || null })
        }

        // Case 1: No CODE — turn complete (response already spoken)
        if (hasResponse && !hasCode) {
            ctx.log(`RESPONSE-only turn complete: "${(parsed.response || '').slice(0, 80)}..."`)
            return parsed.response || 'done'
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
                    response: parsed.response,
                    result,
                    runner: this.id,
                }
            }).catch((err: any) => {
                ctx.log(`Error adding execution insights event: ${err}`)
            })
        }

        // Check for legacy respond_to_user completion (backward compat)
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

        // Continue looping (CODE present — agentic loop continues)
        if (loop > 0) {
            this._checkCancelled(ctx)
            ctx.log(`Continuing streaming V3 LLM invocation: [loops remaining: ${loop}] - Error=${result.error}`)
            return await this._runStreaming(ctx, loop - 1)
        } else if (loop === 0) {
            this._checkCancelled(ctx)
            ctx.log(`Loop limit reached, adding instruction message`)
            const loopLimitMessage: CodeExecutionResult = {
                name: "system_message",
                error: false,
                result: "Loop limit reached. You must now respond to the user with a response (set response field to a non-null string)."
            }
            ctx.addUserResultInput(loopLimitMessage)
            return await this._runStreaming(ctx, -1)
        } else {
            ctx.log(`Final loop limit reached, forcing stop`)
            return "done"
        }
    }
}
