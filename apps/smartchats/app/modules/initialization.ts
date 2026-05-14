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

import { search_knowledge_deep } from "../graph_utils"
import { fetchProceduralInstructions } from "./procedural_instructions"
import { fetchMetricsContext } from "./metrics"
import { fetchLogCategories } from "./logging"
import { fetchTodosContext } from "./todos"
import { listInstalls, getApp } from "./app_registry"
import { seedBuiltinApps } from "../apps/builtin_apps"
import { embed_vector, getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';

/** Fetch init instructions — reusable by prefetch and module fn */
export async function fetchInitInstructions(): Promise<any[]> {
    const response = await getBackend().data.query(queries.getInitInstructions()) as any
    return response.rows
}

// ── Prefetch startup data ────────────────────────────────────────────────────

let _startupPromise: Promise<any> | null = null

/**
 * Prefetch all startup data in parallel. Returns a singleton promise —
 * calling multiple times returns the same in-flight/resolved promise.
 * Call resetStartupPrefetch() to allow re-fetching (e.g. on model change).
 */
export function prefetchStartup(): Promise<any> {
    if (_startupPromise) return _startupPromise

    _startupPromise = Promise.all([
        fetchInitInstructions().catch(() => []),
        fetchProceduralInstructions().catch(() => []),
        fetchMetricsContext().catch(() => ({ tracked_metrics: [], recent_entries: [] })),
        fetchLogCategories().catch(() => []),
        fetchTodosContext().catch(() => ({ overdue: [], due_today: [], upcoming_7d: [], no_date: [], total_active: 0, recurring_due: [] })),
        search_knowledge_deep('current_user', { depth: 2 })
            .then(result => {
                const entities = Array.from(result.expanded.entities.values())
                const relations = [...result.seeds.relations, ...result.expanded.relations]
                return {
                    entities: entities.map(e => ({ name: e.name, depth: e.depth, distance: e.distance })),
                    relations: relations.map((r: any) => ({
                        source: r.sourceName, relation: r.kind, target: r.targetName
                    })),
                    total_entities: result.totalEntities,
                    total_relations: result.totalRelations,
                }
            })
            .catch(() => ({ entities: [], relations: [], total_entities: 0, total_relations: 0 })),
        // App platform: seed built-in apps, then prefetch installs
        seedBuiltinApps(embed_vector)
            .then(() => listInstalls())
            .then(async (installs) => {
                const manifests = await Promise.all(
                    installs.map(i => getApp(i.app_id).catch(() => null))
                )
                return installs.map((install, idx) => ({
                    install,
                    manifest: manifests[idx],
                    // Summary for LLM context (full manifest stored in appManifestCache, not injected)
                    summary: manifests[idx] ? {
                        id: manifests[idx]!.id,
                        name: manifests[idx]!.name,
                        description: manifests[idx]!.description,
                        icon: manifests[idx]!.icon,
                    } : null,
                })).filter(x => x.manifest !== null)
            })
            .catch(() => []),
    ]).then(([init_instructions, procedural_instructions, metrics_context, log_categories, todos_context, current_user_kg, installed_apps]) => ({
        init_instructions,
        procedural_instructions,
        metrics_context,
        log_categories,
        todos_context,
        current_user_kg,
        installed_apps,
    }))

    return _startupPromise
}

/** Reset the prefetch promise so the next call re-fetches. */
export function resetStartupPrefetch() {
    _startupPromise = null
}

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
                    return fetchInitInstructions()
                },
                return_type: 'array'
            },

            // ── create_init_instruction ──
            {
                enabled: true,
                description: `Create a new initialization instruction that loads at session start.`,
                name: 'create_init_instruction',
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
                        ? { created: true, id: rows[0]?.id, content: content.trim(), category: cat }
                        : { created: false, error: 'No result from DB' }
                },
                return_type: 'object'
            },

            // ── update_init_instruction ──
            {
                enabled: true,
                description: `Update an initialization instruction's content and/or category.`,
                name: 'update_init_instruction',
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
