/**
 * SystemContextManager (SCM) — Module-based system prompt composition
 *
 * Replaces PromptManager with a module architecture where everything
 * (intro text, code gen rules, knowledge graph guide, auth context, output format)
 * is a module. Each module can contribute system_msg, functions, and output_instructions.
 *
 * SCM.build() composes all modules into a structured result.
 * SCM.build_messages() produces the full LLM message array with trailing state
 * for KV cache optimization.
 */

import type { Function as CortexFunction } from './types.js'

// ── Interfaces ──

export interface ContextModule {
    id: string
    name: string
    position: number              // 0-100, determines ordering within each section

    // Content (all optional — a module contributes what it has)
    system_msg?: string           // instructions/context text
    functions?: CortexFunction[]  // full function objects with callable fn
    output_instructions?: string  // how to format responses (rendered into prompt)
    output_structure?: any        // JSON schema for LLM API (NOT in prompt, passed separately)

    // Mutable scratchpad (opt-in per module)
    state?: string                // unstructured working memory, rendered as trailing message

    /**
     * Optional hook called by build_messages() before collecting state.
     * The module can mutate itself (update state, system_msg, functions, etc.).
     *
     * Current uses:
     *   - Timing module: refreshes timestamps, session duration, turn count
     *
     * Future use cases:
     *   - Context pruning: trim system_msg or drop functions based on token budget
     *   - Dynamic function registry: reload/sync function list from DB or cache
     *   - Auth refresh: check token validity and update auth status in system_msg
     *   - Workspace summary: scan workspace and build compact state summary
     *   - Conversation summarization: compress long conversations into state
     */
    beforeBuild?: () => void
}

export interface SCMBuildResult {
    system_prompt: string         // rendered text: system_msgs → function_infos → output_instructions
    functions: CortexFunction[]   // all callable function objects from all modules
    output_structure?: any        // JSON schema for LLM API, from whichever module provides it
}

// ── Helpers ──

function sectionHeader(title: string): string {
    return `\n==================================================\n${title}\n==================================================\n`
}

function estimateTokens(text: string): number {
    return Math.ceil(text.length / 4)
}

// ── SystemContextManager ──

export class SystemContextManager {
    private modules: Map<string, ContextModule> = new Map()

    // ── Module management ──

    add_module(module: ContextModule): void {
        this.modules.set(module.id, module)
    }

    remove_module(id: string): void {
        this.modules.delete(id)
    }

    update_module(id: string, patch: Partial<ContextModule>): void {
        const existing = this.modules.get(id)
        if (existing) {
            this.modules.set(id, { ...existing, ...patch })
        }
    }

    update_state(id: string, state: string): void {
        const existing = this.modules.get(id)
        if (existing) {
            existing.state = state
        }
    }

    // ── Query ──

    get_module(id: string): ContextModule | undefined {
        return this.modules.get(id)
    }

    list_modules(): ContextModule[] {
        return [...this.modules.values()].sort((a, b) => a.position - b.position)
    }

    has_module(id: string): boolean {
        return this.modules.has(id)
    }

    clone(): SystemContextManager {
        const cloned = new SystemContextManager()
        for (const [_id, mod] of this.modules) {
            cloned.add_module({
                ...mod,
                functions: mod.functions ? [...mod.functions] : undefined,
            })
        }
        return cloned
    }

    get_usage(): { totalTokenEstimate: number; modules: { id: string; tokens: number }[] } {
        const moduleStats: { id: string; tokens: number }[] = []
        let total = 0

        for (const mod of this.modules.values()) {
            let tokens = 0
            if (mod.system_msg) tokens += estimateTokens(mod.system_msg)
            if (mod.output_instructions) tokens += estimateTokens(mod.output_instructions)
            if (mod.functions) {
                const infoStr = JSON.stringify(mod.functions.map(f => ({
                    description: f.description,
                    name: f.name,
                    parameters: f.parameters,
                    return_type: f.return_type
                })))
                tokens += estimateTokens(infoStr)
            }
            if (mod.state) tokens += estimateTokens(mod.state)
            moduleStats.push({ id: mod.id, tokens })
            total += tokens
        }

        return { totalTokenEstimate: total, modules: moduleStats }
    }

    // ── Build ──

    build(): SCMBuildResult {
        const sorted = this.list_modules()

        // 1. Collect system_msgs
        const systemMsgs: string[] = []
        for (const mod of sorted) {
            if (mod.system_msg) {
                systemMsgs.push(mod.system_msg)
            }
        }

        // 2. Collect function infos from all modules and render as section
        const allFunctions: CortexFunction[] = []
        const functionInfoBlocks: string[] = []
        for (const mod of sorted) {
            if (mod.functions && mod.functions.length > 0) {
                allFunctions.push(...mod.functions)
                // Extract info-only representation for prompt
                const infos = mod.functions.map(f => ({
                    description: f.description,
                    name: f.name,
                    parameters: f.parameters,
                    return_type: f.return_type
                }))
                functionInfoBlocks.push(...infos.map(i => JSON.stringify(i)))
            }
        }

        // 3. Collect output_instructions
        const outputInstructions: string[] = []
        for (const mod of sorted) {
            if (mod.output_instructions) {
                outputInstructions.push(mod.output_instructions)
            }
        }

        // 4. Find output_structure (last module that provides one wins)
        let outputStructure: any = undefined
        for (const mod of sorted) {
            if (mod.output_structure !== undefined) {
                outputStructure = mod.output_structure
            }
        }

        // 5. Compose system_prompt (state is NOT included — it goes in trailing message)
        const parts: string[] = []

        // System messages
        if (systemMsgs.length > 0) {
            parts.push(systemMsgs.join('\n'))
        }

        // Function definitions
        if (functionInfoBlocks.length > 0) {
            parts.push(sectionHeader('AVAILABLE FUNCTIONS'))
            parts.push(`[\n${functionInfoBlocks.join(',\n')}\n]`)
        }

        // Output instructions
        if (outputInstructions.length > 0) {
            parts.push(sectionHeader('OUTPUT FORMAT'))
            parts.push(outputInstructions.join('\n'))
        }

        return {
            system_prompt: parts.join('\n'),
            functions: allFunctions,
            output_structure: outputStructure,
        }
    }

    /**
     * Build the full LLM message array.
     *
     * Returns: [system_msg, ...conversation, state_msg?]
     *
     * Module `state` fields are collected into a trailing system message
     * (not in the system_prompt) to preserve KV cache for the conversation prefix.
     */
    build_messages(conversation: Array<{ role: string; content: string }>): Array<{ role: string; content: string }> {
        const { system_prompt } = this.build()

        const messages: Array<{ role: string; content: string }> = [
            { role: 'system', content: system_prompt },
            ...conversation,
        ]

        // Run beforeBuild hooks, then collect state → trailing system message
        const sorted = this.list_modules()
        for (const mod of sorted) {
            if (mod.beforeBuild) {
                mod.beforeBuild()
            }
        }
        const stateEntries: string[] = []
        for (const mod of sorted) {
            if (mod.state) {
                stateEntries.push(`[${mod.name}]\n${mod.state}`)
            }
        }

        if (stateEntries.length > 0) {
            messages.push({
                role: 'system',
                content: stateEntries.join('\n\n'),
            })
        }

        return messages
    }
}
