/**
 * Initialization module: initialize, get/create/update/delete init instructions
 *
 * Init instructions are persistent directives stored in the `cortex` table
 * (type = 'init') that the agent loads at session start. They define the
 * agent's startup behavior — what to greet, what to check, what to load.
 *
 * Startup data is pre-fetched client-side and injected as a function result
 * before the first LLM turn, so the agent never needs to call init functions manually.
 */

import { embed_vector, getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';
import { getStartupLoaders } from '../lib/background_loaders';

/** Fetch init instructions — reusable by prefetch and module fn */
export async function fetchInitInstructions(): Promise<any[]> {
    const response = await getBackend().data.query(queries.getInitInstructions()) as any
    return response.rows
}

// ── Prefetch startup data ────────────────────────────────────────────────────

// Note: the previous `prefetchStartup()` helper has been removed in favor of
// `lib/background_loaders/`. Each item now has its own loader that prefetches
// on app3 mount, memoizes its promise so any agent function call awaits the
// same in-flight fetch, and auto-injects the resolved value into the agent's
// user_data_input context via onResolve.

// ── System message ───────────────────────────────────────────────────────────

const INITIALIZATION_SYSTEM_MSG = `
## Initialization

Your startup context is automatically pre-loaded and delivered as an initialization data input before your first turn. It includes:
- init_instructions: your startup directives (what to greet, check, load)
- procedural_instructions: learned behavioral rules from user feedback
- metrics_context: tracked metrics summary and recent entries
- log_categories: available data categories
- todos_context: overdue, due today, upcoming, and recurring todo summaries
- current_user_kg: knowledge graph data about the current user (depth-2 expansion)

You do NOT need to call initialize(), get_procedural_instructions(), get_metrics_context(), get_log_categories(), get_todos_context(), or retrieve_declarative_knowledge() at startup — the data is already available.

### First Turn Behavior
- FIRST: check the trailing [Onboarding] state. If onboarding_status is "not_started" or "in_progress", follow the onboarding instructions IMMEDIATELY — do NOT greet, do NOT ask their name, just call the appropriate explainer function. Onboarding takes priority over everything below.
- If onboarding is "complete" or "skipped": proceed normally:
  - If current_user_kg contains user identity (name, preferences), greet them briefly and/or follow init_instructions
  - If current_user_kg is empty (new user) and onboarding is skipped, ask their name and store it via store_declarative_knowledge
  - If todos_context has overdue or due_today items, briefly mention them in the greeting
  - Follow any directives in init_instructions

### Managing Init Instructions
Use create/update/delete_init_instruction to manage startup directives. These persist across sessions.
`

// ── Module ───────────────────────────────────────────────────────────────────

export function createInitializationModule() {
    return {
        id: 'initialization',
        name: 'Initialization',
        position: 12,
        system_msg: INITIALIZATION_SYSTEM_MSG,
        functions: [
            // ── initialize ──
            {
                enabled: true,
                description: `Retrieve all initialization instructions from the database.`,
                name: 'initialize',
                parameters: null,
                fn: async (ops: any) => {
                    const { log } = ops.util
                    log('Fetching initialization instructions')
                    const loaders = getStartupLoaders()
                    return loaders ? await loaders.init_instructions.get() : fetchInitInstructions()
                },
                return_type: 'array'
            },

            // ── create_init_instruction ──
            {
                enabled: true,
                description: `Create a new initialization instruction that loads at session start.`,
                name: 'create_init_instruction',
                return_shape: `Success: { created: true, id: string, content: string, category: string | null }. DB returned no row: { created: false, error: 'No result from DB' }. Missing arg: { error: 'content is required' }.`,
                parameters: {
                    content: 'string',
                    category: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { content, category } = ops.params

                    if (!content || !content.trim()) {
                        return { error: 'content is required' }
                    }

                    const cat = category ? category.toLowerCase().trim() : null
                    log(`Creating init instruction: ${content.slice(0, 60)}...`)

                    let embedding: any
                    try {
                        embedding = await embed_vector(content)
                    } catch (err: any) {
                        log(`Embedding failed: ${err}`)
                        embedding = null
                    }

                    const response = await getBackend().data.query(queries.insertInitInstruction({
                        content: content.trim(),
                        category: cat,
                        embedding,
                    })) as any
                    const rows = response.rows
                    log('Init instruction created')
                    return rows.length > 0
                        ? { created: true, id: rows[0]?.id != null ? String(rows[0].id) : null, content: content.trim(), category: cat }
                        : { created: false, error: 'No result from DB' }
                },
                return_type: 'object'
            },

            // ── update_init_instruction ──
            {
                enabled: true,
                description: `Update an initialization instruction's content and/or category.`,
                name: 'update_init_instruction',
                return_shape: `Success: { updated: true, id: string, result: any (the updated row or null) }. Missing id: { error: 'id is required' }. No fields supplied: { error: 'No fields provided to update' }.`,
                parameters: {
                    id: 'string',
                    content: 'string',
                    category: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { id, content, category } = ops.params

                    if (!id) {
                        return { error: 'id is required' }
                    }

                    const patch: Record<string, unknown> = {}
                    let embedding: unknown | undefined

                    if (content && content.trim()) {
                        patch.content = content.trim()

                        try {
                            embedding = await embed_vector(content.trim())
                        } catch (err: any) {
                            log(`Embedding recompute failed: ${err}`)
                        }
                    }

                    if (category !== undefined) {
                        patch.category = category ? category.toLowerCase().trim() : null
                    }

                    const spec = queries.updateInitInstruction({ recordId: id, patch, embedding })
                    if (!spec) {
                        return { error: 'No fields provided to update' }
                    }

                    log(`Updating init instruction: ${id}`)

                    const response = await getBackend().data.query(spec) as any
                    const rows = response.rows
                    log('Init instruction updated')
                    return { updated: true, id, result: rows[0] || null }
                },
                return_type: 'object'
            },

            // ── delete_init_instruction ──
            {
                enabled: true,
                description: `Delete an initialization instruction by id.`,
                name: 'delete_init_instruction',
                return_shape: `Success: { deleted: true, id: string }. Missing arg: { error: 'id is required' }.`,
                parameters: {
                    id: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { id } = ops.params

                    if (!id) {
                        return { error: 'id is required' }
                    }

                    log(`Deleting init instruction: ${id}`)
                    await getBackend().data.query(queries.deleteInitInstruction(id))
                    log('Init instruction deleted')
                    return { deleted: true, id }
                },
                return_type: 'object'
            },
        ],
    }
}
