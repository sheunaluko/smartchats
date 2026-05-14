/**
 * Default module factories for SystemContextManager
 *
 * Converts each section from cortex_prompt_blocks.ts into a ContextModule factory.
 * The actual prompt text stays the same — we're just repackaging it.
 */

import type { ContextModule } from './system_context_manager.js'
import { sections, codeOutputFormat } from './cortex_prompt_blocks.js'

// ── Core instruction modules ──

export function createIntroModule(agentName?: string): ContextModule {
    const sectionFn = sections.intro as (agentName?: string) => string
    return {
        id: 'intro',
        name: 'Intro',
        position: 0,
        system_msg: sectionFn(agentName),
    }
}

export function createCodeGenModule(): ContextModule {
    // NOTE: codeGeneration section takes function infos, but in SCM mode
    // functions are rendered separately by build(). We include the instructions
    // portion only (without function JSON). The function JSON block is handled
    // by build() collecting from module.functions.
    //
    // We call codeGeneration with an empty array — the "Available Functions:"
    // line at the bottom will show "[]" which gets overridden by the
    // AVAILABLE FUNCTIONS section rendered by build().
    const sectionFn = sections.codeGeneration as (fns: any[]) => string
    return {
        id: 'code_generation',
        name: 'Code Generation',
        position: 10,
        system_msg: sectionFn([]),
    }
}

export function createDynamicFunctionsModule(): ContextModule {
    return {
        id: 'dynamic_functions',
        name: 'Dynamic Functions',
        position: 30,
        system_msg: sections.dynamicFunctions as string,
    }
}

export function createKnowledgeGraphModule(): ContextModule {
    return {
        id: 'knowledge_graph',
        name: 'Knowledge Graph',
        position: 40,
        system_msg: sections.knowledgeGraph as string,
    }
}

export function createResponseGuidanceModule(guidance?: string): ContextModule {
    const sectionFn = sections.responseGuidance as (guidance?: string) => string
    return {
        id: 'response_guidance',
        name: 'Response Guidance',
        position: 90,
        system_msg: sectionFn(guidance),
    }
}

// ── Streaming-aware code gen (removes respond_to_user conflict) ──

export function createStreamingCodeGenModule(): ContextModule {
    return {
        id: 'code_generation',
        name: 'Code Generation',
        position: 10,
        system_msg: `You generate JavaScript code that executes in a sandboxed environment.

All cortex functions are async and available in global scope. Call them directly in your code.

CRITICAL RULES:
1. Always call functions with a SINGLE OBJECT parameter containing named properties
   Example: await compute_embedding({text: "hello"})
   NOT: await compute_embedding("hello")

2. You can use console.log() for debugging - all logs will be returned to you in the result
   Example: console.log("Processing query:", userQuery);

3. A 'workspace' object is available for persisting state between executions
   Example: workspace.counter = (workspace.counter || 0) + 1;

4. A 'last_result' variable contains the result from the previous code execution
   - On the first execution, last_result is null
   - Use this to reference previous computation results
   Example: if (last_result) { console.log("Previous result was:", last_result); }

5. IMPORTANT: Use UNQUALIFIED ASSIGNMENTS for variables (no const/let/var)
   This enables variable tracking in the UI for observability.
   CORRECT: query = "What is AI?";
   CORRECT: results = await retrieve_declarative_knowledge({query: query});
   WRONG: const query = "What is AI?";
   WRONG: let results = await retrieve_declarative_knowledge({query: query});

   Exception: You can use const/let/var inside function definitions IF NEEDED

6. Write natural async JavaScript code with control flow, error handling, etc.

7. NEVER use blocking loops or busy-waits (e.g. while(Date.now() - start < N) {}).
   These freeze the thread and break the runtime. For delays, ALWAYS use:
   await new Promise(resolve => setTimeout(resolve, milliseconds));

8. IMPORTANT - Turn-Based Execution:
   This is a turn-based system. You CANNOT see results until the NEXT turn.

   Pattern when calling functions:

   // Turn 1: Execute and return (set code field, DO NOT respond yet)
   results = await retrieve_declarative_knowledge({query: "AI"});
   return results;

   // Turn 2: Use last_result, respond via the response field
   // response: "I found 3 entries about AI: ..."

   To pass data to the next turn:
   - Return it directly (becomes last_result in next turn)
   - Store in workspace (persists across multiple turns)
   - Use console.log() only for ancillary debug info, not the main return value

   You must SEE the data before you can accurately describe it to the user`,
    }
}

// ── Output format modules (swapped by runners) ──

export function createCodeOutputModule(): ContextModule {
    return {
        id: 'output',
        name: 'Code Output Format',
        position: 80,
        output_instructions: `${codeOutputFormat.types}\n${codeOutputFormat.examples}`,
    }
}

export function createStreamingOutputModule(): ContextModule {
    // The streaming output format text is defined inline in streaming_v2.ts.
    // Runners provide their own output module via getOutputModule(), so this
    // factory is a convenience for manual construction.
    return {
        id: 'output',
        name: 'Streaming Output Format',
        position: 80,
        // Placeholder — StreamingRunner.getOutputModule() provides the real content
        output_instructions: '',
    }
}
