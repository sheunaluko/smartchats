/**
 * Procedural-instruction query builders.
 *
 * Procedural instructions are behavioral rules the agent learns from
 * user feedback that persist across sessions. Stored in the `cortex`
 * table with `type = 'procedural_instruction'`.
 */

import type { QuerySpec } from '../types.js';

const TYPE_FILTER = "type = 'procedural_instruction'";

/**
 * Fetch all procedural instructions, optionally filtered by category.
 *
 * Sort by `id ASC` because cortex IDs are ULID-encoded (time-monotonic
 * within a session) AND survive bundle export/import unchanged — so the
 * agent sees them in stable registration order whether reading from the
 * original DB or a re-imported copy. `created_at` would work within one
 * DB but resets on bundle re-import — id wins on both axes.
 */
export function getProceduralInstructions(args: { category?: string } = {}): QuerySpec {
    const variables: Record<string, unknown> = {};
    let where = `WHERE ${TYPE_FILTER}`;
    if (args.category) {
        where += ' AND category = $category';
        variables.category = args.category;
    }
    return {
        query: `SELECT id, content, category, created_at, updated_at FROM cortex ${where} ORDER BY id ASC`,
        variables,
    };
}

export interface InsertProceduralInstructionArgs {
    content: string;
    category: string | null;
    embedding: unknown;
}

/**
 * INSERT a new procedural instruction.
 */
export function insertProceduralInstruction(args: InsertProceduralInstructionArgs): QuerySpec {
    return {
        query: `INSERT INTO cortex {
                        type: 'procedural_instruction',
                        content: $content,
                        category: $category,
                        embedding: $embedding
                    }`,
        variables: { ...args },
    };
}

/**
 * Whitelisted fields that `updateProceduralInstruction` accepts.
 * `embedding` is paired with `content` (the in-app code recomputes
 * whenever content changes); callers pass it as a sibling param.
 */
const EDITABLE_PI_FIELDS = ['content', 'category'] as const;

/**
 * Dynamic UPDATE by full record id (`cortex:abc`). Returns `null` if
 * the patch contains no settable fields and no embedding is supplied.
 *
 * `updated_at` auto-bumps via the schema's `VALUE time::now()` clause
 * — no need to set it explicitly here. (Pre-1.4.0 schema used DEFAULT
 * not VALUE so updates required an explicit SET; the migration to
 * snake_case + VALUE makes that obsolete.)
 */
export function updateProceduralInstruction(args: {
    recordId: string;
    patch: Partial<Record<typeof EDITABLE_PI_FIELDS[number], unknown>>;
    embedding?: unknown;
}): QuerySpec | null {
    const key = args.recordId.includes(':') ? args.recordId.slice(args.recordId.indexOf(':') + 1) : args.recordId;
    const setClauses: string[] = [];
    const variables: Record<string, unknown> = { key };

    for (const field of EDITABLE_PI_FIELDS) {
        if (field in args.patch) {
            setClauses.push(`${field} = $${field}`);
            variables[field] = args.patch[field];
        }
    }

    if (args.embedding !== undefined) {
        setClauses.push('embedding = $embedding');
        variables.embedding = args.embedding;
    }

    if (setClauses.length === 0) return null;

    return {
        query: `UPDATE type::record('cortex', $key) SET ${setClauses.join(', ')}`,
        variables,
    };
}

/**
 * DELETE a procedural instruction by full record id (`cortex:abc`).
 */
export function deleteProceduralInstruction(recordId: string): QuerySpec {
    const key = recordId.includes(':') ? recordId.slice(recordId.indexOf(':') + 1) : recordId;
    return {
        query: `DELETE type::record('cortex', $key)`,
        variables: { key },
    };
}

/**
 * KNN semantic search across procedural instructions. Used to check
 * for duplicates before creating. `effort` defaults to 40 (matches
 * in-app default).
 */
export function searchProceduralInstructions(args: {
    embedding: unknown;
    limit: number;
    effort?: number;
}): QuerySpec {
    const effort = args.effort ?? 40;
    return {
        query: `SELECT id, content, category, created_at, vector::distance::knn() AS distance FROM cortex WHERE ${TYPE_FILTER} AND embedding <|${args.limit},${effort}|> $embedding ORDER BY distance LIMIT ${args.limit}`,
        variables: { embedding: args.embedding },
    };
}
