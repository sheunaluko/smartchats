/**
 * Procedural instructions module: get, create, update, delete, search
 *
 * The agent's self-modification layer — behavioral rules learned from user
 * feedback that persist across sessions. Stored in the `cortex` table with
 * type = 'procedural_instruction'. Toggleable: enable for advanced users
 * who want an adaptive agent, disable for basic users with fixed behavior.
 */

import { embed_vector, getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';

/** Fetch all procedural instructions — reusable by prefetch and module fn */
export async function fetchProceduralInstructions(category?: string): Promise<any[]> {
    const cat = category ? category.toLowerCase().trim() : undefined
    const response = await getBackend().data.query(queries.getProceduralInstructions({ category: cat })) as any
    return response.rows
}

// ── System message ───────────────────────────────────────────────────────────

const PROCEDURAL_INSTRUCTIONS_SYSTEM_MSG = `
## Procedural Instructions

You can learn and adapt by saving procedural instructions — rules that persist across sessions and guide your behavior. Call get_procedural_instructions() at session start alongside initialize() to load your learned rules.

### When to create instructions
- When the user corrects your approach and the correction is generalizable
- When a pattern works well and should be repeated
- When the user explicitly asks you to remember something about how to behave

### When NOT to create instructions
- One-off task details (use workspace instead)
- Facts about the user (not behavioral rules)
- Instructions that duplicate what's already in your system prompt

### Guidelines
- Keep instructions concise and actionable
- Check existing instructions before creating duplicates (use get_procedural_instructions or search_procedural_instructions first)
- Update existing instructions rather than creating near-duplicates
- Category is optional but helps organize (e.g. "engineering", "conversation", "logging")
`

// ── Module ───────────────────────────────────────────────────────────────────

export function createProceduralInstructionsModule() {
    return {
        id: 'procedural_instructions',
        name: 'Procedural Instructions',
        position: 24,
        system_msg: PROCEDURAL_INSTRUCTIONS_SYSTEM_MSG,
        functions: [
            // ── get_procedural_instructions ──
            {
                enabled: true,
                description: `Fetch all procedural instructions, optionally filtered by category.`,
                name: 'get_procedural_instructions',
                parameters: {
                    category: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { category } = ops.params
                    log('Fetching procedural instructions')
                    return fetchProceduralInstructions(category)
                },
                return_type: 'array'
            },

            // ── create_procedural_instruction ──
            {
                enabled: true,
                description: `Create a new procedural instruction. Computes an embedding for semantic search.`,
                name: 'create_procedural_instruction',
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
                    log(`Creating procedural instruction: ${content.slice(0, 60)}...`)

                    let embedding: any
                    try {
                        embedding = await embed_vector(content)
                    } catch (err: any) {
                        log(`Embedding failed: ${err}`)
                        embedding = null
                    }

                    const response = await getBackend().data.query(queries.insertProceduralInstruction({
                        content: content.trim(),
                        category: cat,
                        embedding,
                    })) as any
                    const rows = response.rows
                    log('Procedural instruction created')
                    return rows.length > 0
                        ? { created: true, id: rows[0]?.id != null ? String(rows[0].id) : null, content: content.trim(), category: cat }
                        : { created: false, error: 'No result from DB' }
                },
                return_type: 'object'
            },

            // ── update_procedural_instruction ──
            {
                enabled: true,
                description: `Update a procedural instruction's content and/or category. Recomputes embedding if content changes.`,
                name: 'update_procedural_instruction',
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

                        // Recompute embedding
                        try {
                            embedding = await embed_vector(content.trim())
                        } catch (err: any) {
                            log(`Embedding recompute failed: ${err}`)
                        }
                    }

                    if (category !== undefined) {
                        patch.category = category ? category.toLowerCase().trim() : null
                    }

                    const spec = queries.updateProceduralInstruction({ recordId: id, patch, embedding })
                    if (!spec) {
                        return { error: 'No fields provided to update' }
                    }

                    log(`Updating procedural instruction: ${id}`)

                    const response = await getBackend().data.query(spec) as any
                    const rows = response.rows
                    log('Procedural instruction updated')
                    return { updated: true, id, result: rows[0] || null }
                },
                return_type: 'object'
            },

            // ── delete_procedural_instruction ──
            {
                enabled: true,
                description: `Delete a procedural instruction by id.`,
                name: 'delete_procedural_instruction',
                parameters: {
                    id: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { id } = ops.params

                    if (!id) {
                        return { error: 'id is required' }
                    }

                    log(`Deleting procedural instruction: ${id}`)
                    await getBackend().data.query(queries.deleteProceduralInstruction(id))
                    log('Procedural instruction deleted')
                    return { deleted: true, id }
                },
                return_type: 'object'
            },

            // ── search_procedural_instructions ──
            {
                enabled: true,
                description: `Semantic search across procedural instructions. Use to check for duplicates before creating.`,
                name: 'search_procedural_instructions',
                parameters: {
                    text: 'string',
                    limit: 'number',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const { text, limit } = ops.params
                    const n = Number(limit) || 5

                    if (!text || !text.trim()) {
                        return { error: 'text is required' }
                    }

                    log(`Searching procedural instructions: "${text.slice(0, 50)}"`)
                    const embedding = await embed_vector(text)

                    const response = await getBackend().data.query(queries.searchProceduralInstructions({ embedding, limit: n })) as any
                    return response.rows
                },
                return_type: 'array'
            },
        ],
    }
}
