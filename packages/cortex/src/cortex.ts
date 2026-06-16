/**
 * Source code for cortex AI architecture
 * Platform-agnostic implementation - works in both browser and Node.js
 */
import { zodResponseFormat } from 'openai/helpers/zod'
import { z } from "zod"
import { buildPrompt, codeOutputFormat, DEFAULT_CORTEX_SECTIONS } from "./cortex_prompt_blocks"
import type { SectionName } from "./cortex_prompt_blocks"
import { PromptManager } from "./prompt_manager"
import type { SectionOverrides } from "./prompt_manager"
import { EventEmitter } from 'events'
import { logger } from 'smartchats-common'
import * as Channel from "./channel"

// Import sandbox interface and types
import type { SandboxExecutor, SandboxLog, SandboxEvent } from "./sandbox_interface"
import { DEFAULT_SANDBOX_TIMEOUT } from './sandbox_interface.js'

// Import runner abstraction
import type { Runner, RunnerContext } from './runner/types.js'
import { SynchronousRunner } from './runner/synchronous_v1.js'

// Import SystemContextManager
import type { SystemContextManager } from './system_context_manager.js'

// Import ProcessManager
import { ProcessManager } from './process_manager.js'
import type { SandboxFactory } from './process_manager.js'

// Import local types
import type {
  Provider,
  Function,
  FunctionCall,
  FunctionResult,
  CodeExecutionResult,
  CortexOutput,
  CodeOutput,
  FunctionDictionary,
  SystemMessage,
  UserMessage,
  CortexMessage,
  IOMessage,
  IOMessages,
  CortexOps,
  UserInput,
  ContextStatus,
  TokenBreakdown,
  UsageStats
} from './types.js'

// Import token counting and model registry
import { getTokenBreakdown, calculateDrift } from './token_counter.js'
import { getModelInfo, calculateCost, type UsageForCost } from './model_registry.js'

const log = logger.get_logger({ id: 'cortex_base' }) 


/*
   
   Todo:  
   [x] implemented call chains 
   
 */


function getEndpointForProvider(provider: Provider): string {
    switch (provider) {
        case 'anthropic': return '/api/claude_structured_response';
        case 'gemini': return '/api/gemini_structured_response';
        default: return '/api/openai_structured_response';
    }
} 


const FunctionCallObject = z.object({
    name : z.string() ,
    parameters : z.union( [z.record(z.string()) , z.null() ])
})

const zrf  = z.object({
    thoughts : z.string() ,
    calls : z.array( FunctionCallObject ),
    return_indeces : z.array( z.number() )  }
)

/* CortexOutputResoponseFormat - legacy, kept for reference */
export const CortexOutputResponseFormat = zodResponseFormat( zrf,  'CortexOutput'  ) ;

/* Extract raw JSON schema for new Responses API */
export const CortexOutputSchema = CortexOutputResponseFormat.json_schema.schema;
export const CortexOutputSchemaName = 'CortexOutput';

/* New CodeOutput schema for JavaScript code generation */
const CodeOutputZod = z.object({
    thoughts: z.string(),
    code: z.string()
})

export const CodeOutputResponseFormat = zodResponseFormat(CodeOutputZod, 'CodeOutput');
export const CodeOutputSchema = CodeOutputResponseFormat.json_schema.schema;
export const CodeOutputSchemaName = 'CodeOutput';

/* Helper to extract raw JSON schema from zodResponseFormat result */
export function extractJsonSchema(zodFormat: ReturnType<typeof zodResponseFormat>) {
    return {
        schema: zodFormat.json_schema.schema,
        schema_name: zodFormat.json_schema.name
    };
}


/* create mapping of function name to the function object */ 
export function get_function_dictionary(functions : Function[]) {
    var function_dic : FunctionDictionary  = {} ;
    functions.map( (f : Function) => function_dic[f.name] = f )
    return function_dic ; 
} 

/* convert all functions into JSON string for system msg */ 
export function get_functions_string(functions : Function[]) {
    let function_infos =  functions.map( (f : Function) =>  {
	let {description, name, parameters, return_type } = f ;
	log(`Adding function: ${name}`) 
	return { description, name, parameters, return_type } 
    })

    return JSON.stringify(function_infos, null, 2) ; 

} 


/* Generates the system message from an array of function objects */
export function generate_system_msg(functions : Function[], additional_system_msg? : string) {
    // Extract function info for the prompt
    const functionInfos = functions.map(f => ({
        description: f.description,
        name: f.name,
        parameters: f.parameters,
        return_type: f.return_type
    }))

    // Build sections list, adding 'additional' only if provided
    const sectionsList: SectionName[] = additional_system_msg
        ? [...DEFAULT_CORTEX_SECTIONS, 'additional']
        : [...DEFAULT_CORTEX_SECTIONS]

    return buildPrompt({
        sections: sectionsList,
        sectionArgs: {
            functions: [functionInfos],
            outputFormat: [codeOutputFormat.types, codeOutputFormat.examples],
            ...(additional_system_msg && { additional: [additional_system_msg] })
        }
    })
} 


export async function get_variable_hash_id(v : any ) {
    // Simple hash implementation for variable IDs
    // Platform-agnostic: works in browser and Node.js
    const str = JSON.stringify({ data: v })
    let hash = 0
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i)
        hash = ((hash << 5) - hash) + char
        hash = hash & hash // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36)
}


/**
 * Defines the Cortex class, which provides a clean interface to Agent<->User IO  
 * 
 */ 
export class Cortex extends EventEmitter  {

    model : string;
    name  : string;
    provider : Provider;
    log   : any;
    functions : Function[]  ;
    system_msg : SystemMessage ;
    function_dictionary : FunctionDictionary ;
    messages  : IOMessages ;   //all messages (User and Cortex) that follow the system message

    is_running_function : boolean ; //tracks whether a function is currently being called
    function_input_ch  : Channel.Channel ;

    prompt_history : any[];

    user_output : any ;

    CortexRAM : { [k:string] : any } ;

    workspace? : { [k:string] : any } ; // Persistent workspace for sandbox executions
    last_result: any = null; // Result from previous code execution

    promptManager : PromptManager ;
    insights? : any ; // InsightsClient instance for event tracking

    sandbox: SandboxExecutor ; // Injected sandbox implementation
    apiBaseUrl: string ; // API base URL for LLM calls
    utilities: any ; // Platform-specific utilities (embedding, sounds, etc.)
    llmCallFn?: (args: { model: string; input: any[]; schema?: any; schema_name?: string }) => Promise<any> ; // Optional injectable LLM call function

    // Runner abstraction — pluggable LLM execution strategy
    runner: Runner;

    // Cancellation support
    private _runAbortController: AbortController | null = null;

    // SystemContextManager — module-based prompt composition (replaces PromptManager when set)
    scm?: SystemContextManager;
    output_structure?: any; // JSON schema for structured output (from SCM)

    // Process manager for async background processes
    processManager?: ProcessManager;

    // Usage tracking
    usage: UsageStats = {
	promptTokens: 0,
	completionTokens: 0,
	cachedInputTokens: 0,
	cacheCreationInputTokens: 0,
	totalTokens: 0,
	costUsd: 0,
	callCount: 0
    }

    constructor(ops : CortexOps) {

	super() ;

	let { model, name, functions, additional_system_msg, provider, insights, sandbox, apiBaseUrl, utilities, llmCallFn, scm } = ops  ;
	this.model = model ;
	this.name  = name ;
	this.provider = provider ?? getModelInfo(model).provider ;
	this.messages = [ ] ;
	this.is_running_function = false;
	this.function_input_ch = new Channel.Channel({name}) ;
	this.prompt_history = [ ];
	this.CortexRAM = {}
	this.last_result = null;
	this.insights = insights || null;
	this.sandbox = sandbox;
	this.utilities = utilities || {};
	this.llmCallFn = llmCallFn;

	// Set API base URL - default to window origin in browser, empty string in Node
	// (callers running outside a browser must supply apiBaseUrl explicitly).
	this.apiBaseUrl = apiBaseUrl || (typeof window !== 'undefined' ? window.location.origin : '')

	let log_instance = logger.get_logger({'id' : `cortex:${name}` }); this.log = log_instance;

	this.user_output = function(x : any) {
	    log(`User output not yet configured: received output:`)
	    log(x) ;
	}

	log("Initializing")

	if (scm) {
	    // SCM path — module-based prompt composition
	    log("Using SystemContextManager for prompt composition")
	    this.scm = scm
	    const built = scm.build()
	    this.functions = built.functions
	    this.function_dictionary = get_function_dictionary(built.functions)
	    this.output_structure = built.output_structure
	    // system_msg is generated dynamically by build_messages() via SCM
	    this.system_msg = { role: 'system', content: built.system_prompt } as SystemMessage

	    // PromptManager still created (for legacy methods like rerun_llm_with_output_format)
	    this.promptManager = new PromptManager({ sections: [], sectionArgs: {} })
	} else {
	    // Legacy PromptManager path
	    log("Generating system message via PromptManager")
	    this.functions = functions || []

	    const functionInfos = this.functions.map(f => ({
		description: f.description,
		name: f.name,
		parameters: f.parameters,
		return_type: f.return_type
	    }))

	    const sectionsList: SectionName[] = additional_system_msg
		? [...DEFAULT_CORTEX_SECTIONS, 'additional']
		: [...DEFAULT_CORTEX_SECTIONS]

	    this.promptManager = new PromptManager({
		sections: sectionsList,
		sectionArgs: {
		    codeGeneration: [functionInfos],
		    outputFormat: [codeOutputFormat.types, codeOutputFormat.examples],
		    ...(additional_system_msg && { additional: [additional_system_msg] })
		}
	    })

	    let system_msg = { role: 'system', content: this.promptManager.build() } as SystemMessage
	    this.system_msg = system_msg

	    log("Building function dictionary")
	    this.function_dictionary = get_function_dictionary(this.functions)
	}

	// Initialize default runner
	this.runner = ops.runner || new SynchronousRunner()
	log(`Initialized: model=${model}, provider=${this.provider}, runner=${this.runner.id}`)
	log("Done")

    }

    /**
     * Get current context status including token usage breakdown
     */
    getContextStatus(): ContextStatus {
	const messages = this.build_messages()
	const modelInfo = getModelInfo(this.model, this.provider)
	const breakdown = getTokenBreakdown(messages, this.provider)

	const totalUsed = breakdown.total
	const remaining = Math.max(0, modelInfo.contextWindow - totalUsed)
	const usagePercent = (totalUsed / modelInfo.contextWindow) * 100

	return {
	    model: this.model,
	    provider: this.provider,
	    contextWindow: modelInfo.contextWindow,
	    maxOutputTokens: modelInfo.maxOutputTokens,
	    breakdown,
	    totalUsed,
	    remaining,
	    usagePercent: Math.round(usagePercent * 10) / 10, // 1 decimal place
	    isApproachingLimit: usagePercent > 80,
	    isAtLimit: usagePercent > 95,
	    messageCount: this.messages.length,
	    countMethod: 'estimate'
	}
    }

    /**
     * Emit context status event
     */
    private emitContextStatus(): void {
	const status = this.getContextStatus()
	this.emit_event({ type: 'context_status', status })
    }

    /**
     * Update usage stats after an LLM call.
     * Accepts the full usage object so cache-write tokens (Anthropic 5m
     * ephemeral, 1.25× base) get billed at their correct rate via calculateCost.
     */
    updateUsage(usage: UsageForCost): void {
	const promptTokens = usage.input_tokens
	const completionTokens = usage.output_tokens
	const cachedInputTokens = usage.cached_input_tokens ?? 0
	const cacheCreationInputTokens = usage.cache_creation_input_tokens ?? 0

	this.usage.promptTokens += promptTokens
	this.usage.completionTokens += completionTokens
	this.usage.cachedInputTokens += cachedInputTokens
	this.usage.cacheCreationInputTokens += cacheCreationInputTokens
	this.usage.totalTokens += promptTokens + completionTokens
	this.usage.callCount++

	const callCost = calculateCost(this.model, usage, this.provider)
	this.usage.costUsd += callCost

	// Emit usage update event
	this.emit_event({
	    type: 'usage_update',
	    call: { promptTokens, completionTokens, cachedInputTokens, cacheCreationInputTokens, costUsd: callCost },
	    cumulative: { ...this.usage }
	})

	this.log(`Usage: +${promptTokens}/${completionTokens} tokens (${cachedInputTokens} cached, ${cacheCreationInputTokens} written), +$${callCost.toFixed(6)} | Total: ${this.usage.totalTokens} tokens, $${this.usage.costUsd.toFixed(6)}`)
    }

    /**
     * Get current usage stats
     */
    getUsage(): UsageStats {
	return { ...this.usage }
    }

    /**
     * Reset usage stats
     */
    resetUsage(): void {
	this.usage = {
	    promptTokens: 0,
	    completionTokens: 0,
	    cachedInputTokens: 0,
	    cacheCreationInputTokens: 0,
	    totalTokens: 0,
	    costUsd: 0,
	    callCount: 0
	}
	this.log('Usage stats reset')
    }

    /**
     * Create a RunnerContext that wraps this Cortex instance's state and methods.
     * The runner uses this to interact with Cortex without direct coupling.
     */
    createRunnerContext(signal?: AbortSignal): RunnerContext {
	const cortex = this
	return {
	    // Read-only state (accessed live via getters)
	    get model() { return cortex.model },
	    get provider() { return cortex.provider },
	    get messages() { return cortex.messages },
	    get workspace() { return cortex.workspace || {} },
	    get last_result() { return cortex.last_result },
	    get insights() { return cortex.insights || null },
	    get llmCallFn() { return cortex.llmCallFn },
	    get apiBaseUrl() { return cortex.apiBaseUrl },
	    get signal() { return signal },

	    // Delegates
	    buildMessages: () => cortex.build_messages(),
	    getContextStatus: () => cortex.getContextStatus(),
	    runCodeOutput: (output) => {
		cortex.set_is_running_function(true)
		return cortex.run_code_output(output).finally(() => {
		    cortex.set_is_running_function(false)
		})
	    },
	    addCortexMessage: (content) => cortex.add_cortex_message(cortex._cortex_msg(content)),
	    addUserResultInput: (result) => cortex.add_user_data_input(result, 'code_result'),
	    emitEvent: (evt) => cortex.emit_event(evt),
	    updateUsage: (usage) => cortex.updateUsage(usage),
	    logEvent: (msg) => cortex.log_event(msg),
	    log: cortex.log,
	}
    }

    /**
     * Swap the runner and rebuild the system prompt with the runner's prompt format.
     */
    setRunner(runner: Runner): void {
	this.runner = runner

	if (this.scm) {
	    // SCM path — runner provides its output module, upserts into SCM
	    const outputModule = runner.getOutputModule()
	    this.scm.add_module(outputModule)
	    // Rebuild functions/output_structure from updated SCM
	    const built = this.scm.build()
	    this.functions = built.functions
	    this.function_dictionary = get_function_dictionary(built.functions)
	    this.output_structure = built.output_structure
	    // Update cached system_msg for getContextStatus token counting
	    this.system_msg = { role: 'system', content: built.system_prompt } as SystemMessage
	} else {
	    // Legacy PromptManager path
	    const format = runner.getPromptFormat()
	    if (format.sectionOverrides) {
		this.system_msg = {
		    role: 'system',
		    content: this.promptManager.buildWith(format.sectionOverrides)
		} as SystemMessage
	    }
	}

	this.log(`Runner set to: ${runner.id}`)
    }

    async set_var(v : any )  {

	let id = await get_variable_hash_id(v) ;
	this.CortexRAM[id] = v;
	this.log(`Wrote var with id hash=${id}`)
	return id  ;
    }

    async set_var_with_id(v : any , id : string )  {

	this.CortexRAM[id] = v;
	this.log(`Wrote var with id=${id}`)
	return id  ;
    }
    
    get_var(id : string) {
	this.log(`Returning var ${id}`)	
	return this.CortexRAM[id] 
    }

    emit_event(evt : any) {
	if (evt.type !== 'stream_chunk' && evt.type !== 'thought_chunk' && evt.type !== 'response_chunk' && evt.type !== 'sandbox_event') {
	    this.log(`emitting event: ${JSON.stringify(evt)}`) ;
	}
	this.emit('event' , evt) ;
    }

    initProcessManager(sandboxFactory: SandboxFactory): ProcessManager {
	if (!this.processManager) {
	    this.processManager = new ProcessManager(this, sandboxFactory)
	    const forwardEvents = ['process_spawned', 'process_output', 'process_state_change', 'process_complete', 'process_agent_event', 'process_needs_input', 'process_idle_batch']
	    for (const evtType of forwardEvents) {
		this.processManager.on(evtType, (evt: any) => this.emit_event({ type: evtType, ...evt }))
	    }
	}
	return this.processManager
    }

    getStateSnapshot(): { cortexRAM: Record<string, any>; workspace: Record<string, any>; last_result: any } {
	return {
	    cortexRAM: { ...this.CortexRAM },
	    workspace: { ...(this.workspace || {}) },
	    last_result: this.last_result,
	}
    }

    /**
     * Run a structured completion with a custom Zod schema
     * Allows functions to invoke their own LLM completions with custom output formats
     */
    async run_structured_completion<T extends z.ZodType>(options: {
	schema: T
	schema_name: string
	messages: { role: 'system' | 'user' | 'assistant', content: string }[]
    }): Promise<z.infer<T>> {
	const { schema, schema_name, messages } = options

	this.log(`[Structured Completion] schema=${schema_name}, model=${this.model}, provider=${this.provider}`)
	this.log(`Message count: ${messages.length}`)
	this.log_event(`Structured completion: ${schema_name} | Provider: ${this.provider}`)

	// Extract raw JSON schema from Zod schema for new Responses API
	const zodFormat = zodResponseFormat(schema, schema_name)
	const { schema: jsonSchema, schema_name: schemaName } = extractJsonSchema(zodFormat)

	// Use provider-based endpoint
	const endpoint = getEndpointForProvider(this.provider);

	this.log(`Structured completion request: ${schema_name}`)

	let jsonData;
	if (this.llmCallFn) {
	    jsonData = await this.llmCallFn({ model: this.model, input: messages, schema: jsonSchema, schema_name: schemaName });
	} else {
	    const result = await fetch(`${this.apiBaseUrl}${endpoint}`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
		    model: this.model,
		    input: messages,
		    schema: jsonSchema,
		    schema_name: schemaName
		})
	    })
	    jsonData = await result.json()
	}

	this.log(`Structured completion response received`)

	if (jsonData.error) {
	    this.log(`Structured completion error: ${JSON.stringify(jsonData.error)}`)
	    this.log_event(`Structured completion failed: ${schema_name}`)
	    throw new Error(`Structured completion failed: ${jsonData.error.message || jsonData.error}`)
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
	    usage.cache_creation_input_tokens        // Claude (raw + normalized share field name)
	    ?? 0

	if (total_tokens) {
	    this.log_event(`Structured completion tokens: ${total_tokens}`)
	}
	if (prompt_tokens && completion_tokens) {
	    this.updateUsage({
		input_tokens: prompt_tokens,
		output_tokens: completion_tokens,
		cached_input_tokens,
		cache_creation_input_tokens,
	    })
	}

	// New Responses API returns output_text
	let parsed: z.infer<T>
	if (jsonData.output_text) {
	    parsed = JSON.parse(jsonData.output_text)
	} else if (jsonData.choices?.[0]?.message?.parsed) {
	    // Fallback for old API format
	    parsed = jsonData.choices[0].message.parsed
	} else {
	    throw new Error('Unexpected response format: no output_text or parsed content')
	}

	this.log(`Structured completion result received for: ${schema_name}`)
	this.log(`Structured completion parsed successfully`)

	return parsed
    }

    /**
     * Re-run LLM with a different output format using existing conversation history
     *
     * This "time travels" by:
     * 1. Taking the current message history (minus the last cortex message that triggered this call)
     * 2. Rebuilding the system prompt with section overrides via PromptManager
     * 3. Running a structured completion with the custom schema
     *
     * By default, preserves all original prompt sections. Use sectionOverrides to:
     * - Replace section args: { responseGuidance: ['Custom guidance...'] }
     * - Exclude a section entirely: { functions: null }
     *
     * Useful when a function needs the LLM to extract structured data from the conversation
     * but the main CortexOutput format isn't granular enough.
     */
    async rerun_llm_with_output_format<T extends z.ZodType>(options: {
	schema: T
	schema_name: string
	sectionOverrides?: SectionOverrides
    }): Promise<z.infer<T>> {
	const { schema, schema_name, sectionOverrides = {} } = options

	this.log(`Rerunning LLM with custom output format: ${schema_name}`)

	// Get messages and drop the last one (the cortex message that called the function)
	const messages_without_last = this.messages.slice(0, -1)
	this.log(`Using ${messages_without_last.length} messages (dropped last cortex message)`)

	// Build custom output format documentation
	const outputFormatTypes = `
You must respond with a JSON object matching this schema: ${schema_name}
The response will be validated against this structure.
`

	// Merge caller's overrides with outputFormat override
	const finalOverrides = {
	    outputFormat: [outputFormatTypes],
	    ...sectionOverrides
	}

	// Use PromptManager to build modified prompt
	const system_content = this.promptManager.buildWith(finalOverrides)

	const new_system_msg = { role: 'system' as const, content: system_content }

	// Build full message array with new system message
	const full_messages = [new_system_msg, ...messages_without_last]

	this.log(`Calling structured completion with ${full_messages.length} messages`)
	this.log(`Rerunning LLM with ${full_messages.length} messages`)

	// Use existing run_structured_completion infrastructure
	const result = await this.run_structured_completion({
	    schema,
	    schema_name,
	    messages: full_messages
	})

	this.log(`Rerun completed successfully for: ${schema_name}`)
	return result
    }

    configure_user_output(fn : any ) {
	this.log("Linking user output")
	this.user_output  = fn
    }

    /**
     * Convenience method: Send a message and run LLM in one call
     *
     * @param text - The user's message
     * @param maxLoops - Maximum function calling loops (default: 4)
     * @returns Promise<string> - The LLM response
     */
    async chat(text: string, maxLoops: number = 4): Promise<string> {
	this.add_user_text_input(text);
	this.cancel()
	const ac = new AbortController()
	this._runAbortController = ac
	const ctx = this.createRunnerContext(ac.signal)
	try {
	    return await this.runner.run(ctx, maxLoops);
	} finally {
	    if (this._runAbortController === ac) {
		this._runAbortController = null
	    }
	}
    }

    /**
     * Build the message array
     */
    build_messages() {
	if (this.scm) {
	    return this.scm.build_messages(this.messages)
	}
	return [ this.system_msg , ...this.messages ]
    } 

    /**
     * Running function
     */
    set_is_running_function(v : boolean) {
	this.log(`Function running=${v}`) ; 
	this.is_running_function  = v ; 
    }
    

    /**
     * Add UserMessage 
     */
    add_user_message(msg : UserMessage) {
	this.messages = [ ...this.messages, msg ] ; 
	this.log(`Added user message`) 
    } 

    /**
     * Add CortexMessage 
     */
    add_cortex_message(msg : CortexMessage) {
	this.messages = [ ...this.messages, msg ] ; 
	this.log(`Added cortex message`) 
    } 

    _user_msg(content : string)  { return { role :'user', content } as UserMessage }
    _cortex_msg(content : string)  { return { role :'assistant', content }   as CortexMessage }    
    
    add_user_text_input(text : string) {
	let input : UserInput = {
	    type : "text" ,
	    text  ,
	    data : null
	}
	let user_message = this._user_msg(JSON.stringify(input)) ;
	this.add_user_message(user_message)
    }

    add_user_data_input(data : any, type : string = 'code_result') {
	let input : UserInput = {
	    type ,
	    data ,
	    text : null
	}
	let user_message = this._user_msg(JSON.stringify(input))
	this.add_user_message(user_message)
    }

    /** @deprecated Use add_user_data_input */
    add_user_result_input(codeExecutionResult : CodeExecutionResult) {
	this.add_user_data_input(codeExecutionResult, 'code_result')
    }

    add_cortex_output(output : CortexOutput ) {
	let cortex_message = this._cortex_msg(JSON.stringify(output))
	this.add_cortex_message(cortex_message) 
    }
    
	
    /**
     * Cancel any in-flight LLM run. The runner will throw CortexCancelledError.
     */
    cancel(): void {
	if (this._runAbortController) {
	    this._runAbortController.abort()
	    this._runAbortController = null
	}
    }

    /**
     * Run the LLM with the specified system message, message history, and parameters
     * If loop=N, after obtaining a function response another LLM call
     * will be made automatically, until no more functions are called or until N calls have been made
     *
     * Delegates to the current runner. Kept for backward compatibility.
     */
    async run_llm(loop : number = 6) : Promise<string> {
	this.cancel()
	const ac = new AbortController()
	this._runAbortController = ac
	const ctx = this.createRunnerContext(ac.signal)
	const turnStart = Date.now()
	this.emit_event({ type: 'turn_start', model: this.model, loop, timestamp: turnStart })
	try {
	    const result = await this.runner.run(ctx, loop)
	    const turnEnd = Date.now()
	    this.emit_event({ type: 'turn_complete', result, duration_ms: turnEnd - turnStart, loops_used: loop, timestamp: turnEnd })
	    return result
	} catch (err: any) {
	    const turnEnd = Date.now()
	    this.emit_event({ type: 'turn_complete', result: undefined, duration_ms: turnEnd - turnStart, loops_used: loop, timestamp: turnEnd, error: err?.message })
	    throw err
	} finally {
	    if (this._runAbortController === ac) {
		this._runAbortController = null
	    }
	}
    }


    resolve_cortex_ram_reference(v : string) {
	//the reference starts with @
	if (v[0] == "@" ) {
	    this.log(`Detected CRAM reference ${v}`) ;
	    //search
	    let value = this.get_var( v.slice(1) ) ;
	    if (value ) {
		this.log(`Returning resolved value`)
		this.log(`Resolved CRAM reference`) 
		return value 
	    } else {
		this.log(`Reference is undefined!`) ;
		return null  //this behavior may need to be updated @check 
	    }
	} else {
	    this.log(`No CRAM ref found: passing var through`) 
	    return v 
	}
    }
    
    /*
       Converts [ name1, value, name2, value ]  into
       { name1 : value, name2 : value } 
     */
    collect_args(arg_array : string[]) {
	let args = {} as any ; 
	for (var i=0; i< arg_array.length -1 ; i++ ) {
	    if ( (i % 2 ) == 0 ) {
		//its an even index and thus a param name
		let k = arg_array[i] ; var v = null ; 

		/*
		   For collecting the value:
		   1st try json parse it
		   2nd check to see if it is a reference to CortexRAM and resolve it if so 
		 */
		
		let tmp = arg_array[i+1]
		
		try {
		    
		    v = JSON.parse(tmp)
		    
		}   catch (error : any ) {
		    
		    v = this.resolve_cortex_ram_reference(tmp) ;
		    
		}
		
		args[k] = v   ; 
	    }
	}
	return args 
    }

    resolve_args(args : any): any {
	// Handle null/undefined
	if (args === null || args === undefined) {
	    return args;
	}

	// Handle strings - most complex case
	if (typeof args === 'string') {
	    // Check for CortexRAM reference (@id)
	    if (args[0] === '@') {
		this.log(`Resolving CortexRAM reference: ${args}`);
		return this.resolve_cortex_ram_reference(args);
	    }

	    // Check for result reference ($N)
	    if (args.match(/^\$\d+$/)) {
		this.log(`Resolving result reference: ${args}`);
		const value = this.get_var(args);
		if (value !== undefined) {
		    return this.resolve_args(value);
		} else {
		    this.log(`Warning: ${args} not found in CortexRAM, returning as-is`);
		    return args;
		}
	    }

	    // Try to parse as JSON
	    try {
		const parsed = JSON.parse(args);
		// Successfully parsed - recursively resolve in case it contains references
		return this.resolve_args(parsed);
	    } catch (e) {
		// Not valid JSON - return as plain string
		return args;
	    }
	}

	// Handle arrays - recursively resolve each element
	if (Array.isArray(args)) {
	    return args.map(item => this.resolve_args(item));
	}

	// Handle objects - recursively resolve each value
	if (typeof args === 'object') {
	    const resolved: any = {};
	    for (const key in args) {
		if (args.hasOwnProperty(key)) {
		    resolved[key] = this.resolve_args(args[key]);
		}
	    }
	    return resolved;
	}

	// Handle primitives (number, boolean, etc.) - return as-is
	return args;
    }

    async run_cortex_output(co : CortexOutput): Promise<FunctionResult> {
	try {
	    const { calls, return_indeces } = co;

	    if (!calls || calls.length === 0) {
		this.log('No function calls to execute');
		return {
		    name: 'run_result',
		    error: false,
		    result: "There were no functions to execute" 
		};
	    }

	    this.log(`Executing cortex output with ${calls.length} function calls`);
	    const results: FunctionResult[] = [];

	    // Execute each call serially
	    for (let i = 0; i < calls.length; i++) {
		const call = calls[i];
		this.log(`Executing call ${i + 1}/${calls.length}: ${call.name}`);

		// Execute function (handle_function_call will resolve parameters)
		const result = await this.handle_function_call({
		    name: call.name,
		    parameters: call.parameters
		});

		results.push(result);

		// Store result for $N references
		await this.set_var_with_id(result.result, `$${i}`);

		// Fail fast on error
		if (result.error) {
		    const filtered = this.filter_results_by_indices(results, return_indeces);
		    const errorMsg = `Execution failed at call ${i + 1}/${calls.length} (${call.name}): ${result.error}`;
		    this.log(errorMsg);
		    this.log_event(errorMsg);
		    return {
			name: 'run_result',
			error: errorMsg,
			result: { results: filtered }
		    };
		}
	    }

	    // Success - filter and return
	    const filtered = this.filter_results_by_indices(results, return_indeces);
	    this.log(`All ${calls.length} calls completed successfully`);
	    this.log_event(`Run execution completed: ${calls.length} functions`);
	    this.log("Results:")
	    this.log(results)
	    this.log("Filtered results:")
	    this.log(filtered) 

	    
	    return {
		name: 'call_chain_results',
		error: false,
		result: { results: filtered }
	    };

	} catch (error: any) {
	    const errorMsg = `Unexpected error in run execution: ${error.message}`;
	    this.log(errorMsg);
	    this.log_event(errorMsg);
	    return {
		name: 'run_result',
		error: errorMsg,
		result: null 
	    };
	}
    }

    private filter_results_by_indices(results: FunctionResult[], indices: number[]): Record<number, FunctionResult> {
	// Return all if no indices specified
	if (!indices || indices.length === 0) {
	    const all: Record<number, FunctionResult> = {};
	    results.forEach((result, idx) => {
		all[idx] = result;
	    });
	    return all;
	}

	// Filter by indices
	const filtered: Record<number, FunctionResult> = {};
	indices.forEach(idx => {
	    if (idx >= 0 && idx < results.length) {
		filtered[idx] = results[idx];
	    } else {
		this.log(`Warning: return_indeces contains invalid index ${idx}`);
	    }
	});
	return filtered;
    }


    /**
     * Builds the shared util object passed to function ops.
     * Single source of truth — used by both sandbox context and direct function calls.
     */
    private build_function_util(logOverride?: any): Record<string, any> {
	return {
	    log: logOverride || this.log,
	    // `event` is the orchestrator/UI event bus — fires through
	    // cortex's EventEmitter, gets dispatched by useOrchestrator's
	    // handleEvent switch. Use this for things the UI needs to react
	    // to (workspace_update, knowledge_graph_update, etc.).
	    event: this.emit_event.bind(this),
	    // `addInsightEvent` writes a row directly to insights_events via
	    // the InsightsClient — same path cortex uses internally for
	    // llm_invocation / execution telemetry. Use this for things the
	    // monitoring layer needs to see (issues, custom audit events).
	    // Silently no-ops when insights isn't configured (e.g., tests).
	    addInsightEvent: (event_type: string, payload: Record<string, any>) => {
		try { this.insights?.addEvent?.(event_type, payload); } catch { /* never throw from telemetry */ }
	    },
	    user_output: this.user_output,
	    get_user_data: async () => {
		return await this.function_input_ch.read();
	    },
	    get_var: this.get_var.bind(this),
	    set_var: this.set_var.bind(this),
	    set_var_with_id: this.set_var_with_id.bind(this),
	    get_embedding: this.utilities.get_embedding || (async () => { throw new Error('Embedding function not configured') }),
	    handle_function_call: this.handle_function_call.bind(this),
	    collect_args: this.collect_args.bind(this),
	    resolve_args: this.resolve_args.bind(this),
	    run_cortex_output: this.run_cortex_output.bind(this),
	    run_structured_completion: this.run_structured_completion.bind(this),
	    rerun_llm_with_output_format: this.rerun_llm_with_output_format.bind(this),
	    build_system_message: buildPrompt,
	    cortex_functions: this.functions,
	    get_context_status: this.getContextStatus.bind(this),
	    get_workspace: () => this.workspace || {},
	    update_workspace: (patch: Record<string, any>) => {
		this.workspace = { ...(this.workspace || {}), ...patch };
		this.emit_event({ type: 'workspace_update', workspace: this.workspace });
		// Sync into running sandbox so code reads see live values
		if (this.sandbox?.syncWorkspace) {
		    this.sandbox.syncWorkspace(this.workspace);
		}
	    },
	    feedback: this.utilities.sounds || {
		error: () => {},
		activated: () => {},
		ok: () => {},
		success: () => {}
	    }
	};
    }

    /**
     * Builds sandbox context with all cortex functions
     */
    public build_sandbox_context(): Record<string, any> {
	const context: Record<string, any> = {};

	// Inject all enabled cortex functions
	for (const fn of this.functions) {
	    // Expect single object parameter
	    context[fn.name] = async (params: any = {}) => {
		try {
		    const ops = {
			params,
			util: this.build_function_util(),
		    };

		    // Execute function
		    const result = await fn.fn(ops);

		    // Ensure serializable
		    return structuredClone(result);
		} catch (error: any) {
		    throw new Error(error.message || String(error));
		}
	    };
	}

	// Add workspace reference - use persistent workspace from instance
	context.workspace = this.workspace || {};

	// Add last_result from previous execution (null on first run)
	context.last_result = this.last_result;

	return context;
    }

    /**
     * Executes JavaScript code in sandbox instead of running function calls
     */
    async run_code_output(output: CodeOutput): Promise<FunctionResult> {
	const { code } = output;

	// Setup event stream if sandbox supports it (browser-only)
	let cleanup: (() => void) | undefined;

	if (this.sandbox.setupEventStream) {
	    cleanup = this.sandbox.setupEventStream((event) => {
		switch (event.type) {
		    case 'log':
			const logPayload = event.payload as SandboxLog;
			this.emit_event({
			    type: 'sandbox_log',
			    level: logPayload.level,
			    args: logPayload.args,
			    timestamp: logPayload.timestamp
			});
			break;
		    case 'event':
			const eventPayload = event.payload as SandboxEvent;
			this.emit_event({
			    type: 'sandbox_event',
			    eventType: eventPayload.type,
			    data: eventPayload.data,
			    timestamp: eventPayload.timestamp
			});
			break;
		}
	    });
	}

	try {
	    // Build context with all cortex functions
	    const context = this.build_sandbox_context();

	    // Execute in sandbox using injected sandbox implementation
	    const result = await this.sandbox.execute(code, context, DEFAULT_SANDBOX_TIMEOUT);

	    this.log(`Sandbox execution complete: ok=${result.ok}, duration=${result.duration}ms`);

	    // Log all console outputs from sandbox
	    if (result.logs && result.logs.length > 0) {
		this.log(`Sandbox logs: ${result.logs.length} entries`);
	    }

	    // Extract workspace and user result from wrapped execution
	    let userResult = result.data;
	    if (result.ok && result.data?.__workspace) {
		// Update workspace from sandbox
		this.workspace = result.data.__workspace;
		this.emit_event({ type: 'workspace_update', workspace: this.workspace });
		this.log(`Workspace updated: ${Object.keys(this.workspace || {}).length} keys`);

		// Extract the actual user result
		userResult = result.data.__userResult;

		// Store for next execution's last_result
		this.last_result = structuredClone(userResult);
		this.log(`Stored last_result for next execution`);
	    }

	    return {
		name: 'code_execution',
		error: result.ok ? false : result.error || 'Unknown error',
		result: userResult,
		events: result.events || []  // Include events for loop decision
	    };
	} catch (error: any) {
	    const errorMsg = `Sandbox execution failed: ${error.message}`;
	    this.log(errorMsg);
	    this.log_event(errorMsg);

	    // Clear last_result on error
	    this.last_result = null;
	    this.log(`Cleared last_result due to execution error`);

	    return {
		name: 'code_execution',
		error: errorMsg,
		result: null,
		events: []
	    };
	} finally {
	    // Cleanup event listener if it was set up
	    if (cleanup) cleanup();
	}
    }

    async handle_llm_response(
	fetchResponseOrData : any ,
	loop : number,
	fetchTiming?: { start: number, end: number, elapsed: number }
    ) {

	/*
	   ---
	*/

	let jsonData = typeof fetchResponseOrData.json === 'function'
	    ? await fetchResponseOrData.json()
	    : fetchResponseOrData;
	const llmLatency = fetchTiming ? fetchTiming.elapsed : 0;

	// Extract server-side timing from API response
	const serverLlmMs = jsonData.server_llm_ms as number | undefined;
	const vercelOverheadMs = (fetchTiming && serverLlmMs != null)
	    ? fetchTiming.elapsed - serverLlmMs : undefined;

	const timingContext = {
	    ...(fetchTiming && { client_round_trip_ms: fetchTiming.elapsed }),
	    ...(serverLlmMs != null && { server_llm_ms: serverLlmMs }),
	    ...(vercelOverheadMs != null && { vercel_overhead_ms: vercelOverheadMs }),
	};

	this.log('Model JSON response received');
	this.prompt_history.push(jsonData) ;

	// Handle error responses
	if (jsonData.error) {
	    this.log(`API Error: ${jsonData.error}`);

	    // Add error event to insights
	    if (this.insights) {
		try {
		    await this.insights.addLLMInvocation({
			model: this.model,
			provider: this.provider,
			mode: 'code_generation',
			prompt_tokens: 0,
			completion_tokens: 0,
			latency_ms: llmLatency,
			status: 'error',
			error: jsonData.error,
			context: {
			    timing: timingContext,
			},
		    });
		} catch (err) {
		    this.log(`Error adding insights event: ${err}`);
		}
	    }

	    throw new Error(jsonData.error);
	}

	// Handle both old (prompt_tokens/completion_tokens) and new (input_tokens/output_tokens) API formats
	const usage = jsonData.usage || {};
	const prompt_tokens = usage.prompt_tokens ?? usage.input_tokens;
	const completion_tokens = usage.completion_tokens ?? usage.output_tokens;
	const total_tokens = usage.total_tokens;

	// Extract cached input tokens (provider-agnostic)
	const cached_input_tokens =
	    usage.cache_read_input_tokens            // Claude (raw)
	    ?? usage.cached_input_tokens             // Normalized (llm_service)
	    ?? usage.prompt_tokens_details?.cached_tokens  // OpenAI Chat API
	    ?? usage.input_tokens_details?.cached_tokens   // OpenAI Responses API
	    ?? 0;
	// Cache-creation (write) tokens — Anthropic only. Billed at 1.25× base.
	const cache_creation_input_tokens =
	    usage.cache_creation_input_tokens
	    ?? 0;

	if (total_tokens) {
	    this.log_event(`Token Usage=${total_tokens}`) ;
	}

	// Check estimation drift against actual token count
	if (prompt_tokens) {
	    const contextStatus = this.getContextStatus()
	    const drift = calculateDrift(contextStatus.totalUsed, prompt_tokens)
	    if (drift > 0.15) {
		this.log(`Token estimate drift: ${(drift * 100).toFixed(1)}% (estimated=${contextStatus.totalUsed}, actual=${prompt_tokens})`)
	    }
	}

	// Update usage stats
	if (prompt_tokens && completion_tokens) {
	    this.updateUsage({
		input_tokens: prompt_tokens,
		output_tokens: completion_tokens,
		cached_input_tokens,
		cache_creation_input_tokens,
	    })
	}

	// New Responses API returns output_text instead of choices[0].message.parsed
	let output: CodeOutput;
	if (jsonData.output_text) {
	    output = JSON.parse(jsonData.output_text);
	} else if (jsonData.choices?.[0]?.message?.parsed) {
	    // Fallback for old API format
	    output = jsonData.choices[0].message.parsed;
	} else {
	    throw new Error('Unexpected response format: no output_text or parsed content');
	}

	console.log(output)
	this.log("Output received");

	// Add code output as cortex message
	this.add_cortex_message(this._cortex_msg(JSON.stringify(output)));

	// Emit thoughts
	this.emit_event({'type': 'thought', 'thought' : output.thoughts})


	// Add LLM invocation event to insights
	if (this.insights) {
	    try {
		await this.insights.addLLMInvocation({
		    model: this.model,
		    provider: this.provider,
		    mode: 'code_generation',
		    prompt_tokens: prompt_tokens || 0,
		    completion_tokens: completion_tokens || 0,
		    latency_ms: llmLatency,
		    status: 'success',
		    context: {
			loop: loop,
			messages_count: this.messages.length,
			output,
			cached_input_tokens,
			cache_creation_input_tokens,
			timing: timingContext,
		    },
		    usage: this.getUsage()
		});
	    } catch (err) {
		this.log(`Error adding insights event: ${err}`);
	    }
	}
	

	// Emit code execution start event
	this.emit_event({
	    type: 'code_execution_start',
	    code: output.code,
	    executionId: `exec_${Date.now()}`
	});

	this.set_is_running_function(true) ; //function running indicator

	// Execute code in sandbox
	const startTime = Date.now();
	let result = await this.run_code_output(output);
	const duration = Date.now() - startTime;
	this.set_is_running_function(false) ;  //turn off function running indicator

	// Emit code execution complete event
	this.emit_event({
	    type: 'code_execution_complete',
	    status: result.error ? 'error' : 'success',
	    error: result.error,
	    duration: duration,
	    result: result.result,
	    ...(result.error && (result as any).diagnostics ? { diagnostics: (result as any).diagnostics } : {}),
	});

	// Add execution event to insights
	if (this.insights) {
	    try {
		// Count function calls and variable assignments from events
		const functionCalls = result.events?.filter((e: any) => e.type === 'function_start')?.length || 0;
		const variableAssignments = result.events?.filter((e: any) => e.type === 'variable_set')?.length || 0;
		const logsCount = result.events?.filter((e: any) => e.type === 'log')?.length || 0;

		await this.insights.addExecution({
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
			result , //the actual execution result
			...(result.error && (result as any).diagnostics ? { diagnostics: (result as any).diagnostics } : {}),
		    }
		});
	    } catch (err) {
		this.log(`Error adding execution insights event: ${err}`);
	    }
	}

	// Check if execution succeeded
	const executionFailed = result.error;

	// Check if the LAST function call was respond_to_user
	// This allows the agent to call respond_to_user for status updates, then continue working
	let lastFunctionCallWasRespondToUser = false;
	let lastFunctionCallEvent: any = null;
	if (!executionFailed && result.events && result.events.length > 0) {
		// Find the last function_start event
		const functionStartEvents = result.events.filter((e: any) => e.type === 'function_start');
		if (functionStartEvents.length > 0) {
			lastFunctionCallEvent = functionStartEvents[functionStartEvents.length - 1];
			lastFunctionCallWasRespondToUser = lastFunctionCallEvent.data?.name === 'respond_to_user';
			this.log(`Last function call: ${lastFunctionCallEvent.data?.name}`);
		}
	}

	// Strip events before adding to LLM context (they're for observability, not LLM consumption)
	const resultForLLM = {
		name: result.name,
		error: result.error,
		result: result.result
	};
	this.add_user_data_input(resultForLLM, 'code_result');

	// Only consider it done if execution succeeded and last function call was respond_to_user
	const isComplete = !executionFailed && lastFunctionCallWasRespondToUser;

	if (isComplete) {
	    // Extract and return the user response text from the respond_to_user call
	    if (lastFunctionCallEvent?.data?.args && lastFunctionCallEvent.data.args.length > 0) {
		const firstArg = lastFunctionCallEvent.data.args[0];
		// Handle both {response: "text"} and direct string formats
		const responseText = typeof firstArg === 'object' && firstArg.response
		    ? firstArg.response
		    : firstArg;
		return responseText;
	    }
	    // Fallback to "done" if we can't extract the response
	    return "done";
	}

	// Code didn't call respond_to_user or failed, LLM needs to continue
	if (loop > 0) {
	    // Re-invoke LLM with decremented loop counter
	    this.log(`Continuing LLM invocation::  [loops remaining: ${loop}] - Error=${result.error}`);
	    return await this.run_llm(loop - 1);
	} else if (loop === 0) {
	    // Out of loops - add simulated message instructing LLM to respond
	    this.log(`Loop limit reached without respond_to_user, adding instruction message`);
	    const loopLimitMessage: CodeExecutionResult = {
		name: "system_message",
		error: false,
		result: "Loop limit reached. You must now call respond_to_user with the current status of the task."
	    };
	    this.add_user_data_input(loopLimitMessage, 'system_message');

	    // Give LLM one final chance to respond (loop=-1 to prevent further loops)
	    return await this.run_llm(-1);
	} else {
	    // loop < 0 (safety limit reached after instruction message)
	    this.log(`Final loop limit reached without respond_to_user, forcing stop`);
	    return "done";
	}


    }

    log_event(msg: string) {
	this.emit_event({'type' : 'log' , log : msg })  		
    } 

    //allows for passing user text to an active function 
    async handle_function_input(i :any ) {
	let msg = `Sending to function_input_ch: ${i}` 
	this.log(msg)
	this.function_input_ch.write(i) ;
	this.log_event(msg) 
    } 

    async handle_function_call(fCall : FunctionCall ) {
	let { name, parameters }  = fCall ;

	// Resolve any references in parameters (idempotent - safe to call multiple times)
	parameters = this.resolve_args(parameters);

	let F = this.function_dictionary[name] ;
	var error : any  ; 
	if (! F ) {
	    error = `The function ${name} was not found`
	    this.log(error) 
	    return {
		error , 
		result :  null ,
		name 
	    }
	}

	let fn_msg = `Running function: ${name} with args=${JSON.stringify(parameters)}`
	this.log(fn_msg)
	this.log_event(fn_msg)  

	const fn_log = logger.get_logger({id : `fn:${name}`});
	const aux_parameters = this.build_function_util(fn_log);

	try {
	    let result = await F.fn({params : parameters, util : aux_parameters})
	    error = null ;
	    this.log_event(`Ran ${name} function successfully`)
	    this.log(`Ran ${name} function successfully and got result:`)
	    this.log(result) ; 
	    return {
		error,
		result,
		name 
	    }
	} catch (e : any ) {
	    error =  e.message ;
	    let error_msg = `
                [ERROR] - Error with function: ${name}: ${error}
                DO NOT proceed any further
                Instead think about what caused this error 
                Immediately report this error and your thoughts regarding the reason to the user and await further instructions 
	    `
	    this.log(error_msg)
	    this.log_event(error_msg)
	    
	    return {
		error : error_msg , 
		result : null ,
		name 
	    } 
	}


	
    }

    

    
    
    
} 
