/**
 * Initialization-instruction query builders.
 *
 * Init instructions are persistent directives stored in the `cortex` table
 * with `type = 'init'`. The agent loads them at session start and uses
 * them to define startup behavior — what to greet, check, load.
 */

import type { QuerySpec } from '../types.js';

const TYPE_FILTER = "type = 'init'";

/**
 * Fetch all init instructions in registration order.
 *
 * Sort by `id ASC` because cortex IDs are ULID-encoded (time-monotonic
 * within a session) AND survive bundle export/import unchanged — so
 * registration order is preserved whether reading from the original DB
 * or a re-imported copy. Pre-v1.0.0 this query sorted by `lts`, but
 * `insertInitInstruction` never actually wrote `lts`, so the ORDER BY
 * was sorting by NONE (arbitrary). `created_at` would work for ordering
 * within one DB but resets on bundle re-import — id wins on both axes.
 */
export function getInitInstructions(): QuerySpec {
    return {
        query: `SELECT id, content, category, created_at FROM cortex WHERE ${TYPE_FILTER} ORDER BY id ASC`,
        variables: {},
    };
}

export interface InsertInitInstructionArgs {
    content: string;
    category: string | null;
    embedding: unknown;
}

/**
 * INSERT a new init instruction.
 */
export function insertInitInstruction(args: InsertInitInstructionArgs): QuerySpec {
    return {
        query: `INSERT INTO cortex {
                        type: 'init',
                        content: $content,
                        category: $category,
                        embedding: $embedding
                    }`,
        variables: { ...args },
    };
}

/**
 * Whitelisted fields that `updateInitInstruction` accepts. `embedding`
 * is paired with `content` (recomputed whenever content changes).
 */
const EDITABLE_INIT_FIELDS = ['content', 'category'] as const;

/**
 * Dynamic UPDATE by full record id (`cortex:abc`). Returns `null` if
 * the patch contains no settable fields and no embedding is supplied.
 *
 * `updated_at` auto-bumps via the schema's `VALUE time::now()` clause
 * — no need to set it explicitly here.
 */
export function updateInitInstruction(args: {
    recordId: string;
    patch: Partial<Record<typeof EDITABLE_INIT_FIELDS[number], unknown>>;
    embedding?: unknown;
}): QuerySpec | null {
    const key = args.recordId.includes(':') ? args.recordId.slice(args.recordId.indexOf(':') + 1) : args.recordId;
    const setClauses: string[] = [];
    const variables: Record<string, unknown> = { key };

    for (const field of EDITABLE_INIT_FIELDS) {
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
 * DELETE an init instruction by full record id (`cortex:abc`).
 */
export function deleteInitInstruction(recordId: string): QuerySpec {
    const key = recordId.includes(':') ? recordId.slice(recordId.indexOf(':') + 1) : recordId;
    return {
        query: `DELETE type::record('cortex', $key)`,
        variables: { key },
    };
}
