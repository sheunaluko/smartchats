/**
 * Dynamic-function query builders.
 *
 * `cortex_dynamic_functions` stores user-defined async functions
 * registered at runtime. Each row carries the function source (`code`),
 * params schema, an embedding for semantic discovery, and audit timestamps.
 */

import type { QuerySpec } from '../types.js';

export interface InsertDynamicFunctionArgs {
    name: string;
    description: string;
    code: string;
    params_schema: unknown;
    embedding: unknown;
}

/**
 * INSERT a new dynamic function. `created_at` and `updated_at` are
 * server-stamped.
 */
export function insertDynamicFunction(args: InsertDynamicFunctionArgs): QuerySpec {
    return {
        query: `
            INSERT INTO cortex_dynamic_functions {
                type: 'dynamic_function',
                name: $name,
                description: $description,
                code: $code,
                params_schema: $params_schema,
                embedding: $embedding,
                created_at: time::now(),
                updated_at: time::now()
            }
        `,
        variables: { ...args },
    };
}

/**
 * Load a single dynamic function by name. LIMIT 1 — the in-app code
 * relies on this so duplicate-name rows return only the first hit.
 */
export function loadDynamicFunction(name: string): QuerySpec {
    return {
        query: `
            SELECT * FROM cortex_dynamic_functions
            WHERE name = $name
            LIMIT 1
        `,
        variables: { name },
    };
}

/**
 * List every dynamic function with its summary fields. No order clause
 * (matches the in-app query — caller can sort client-side if needed).
 */
export function listDynamicFunctions(): QuerySpec {
    return {
        query: `
            SELECT name, description, params_schema, id
            FROM cortex_dynamic_functions
        `,
        variables: {},
    };
}

/**
 * Whitelisted fields that `updateDynamicFunction` accepts. `embedding`
 * is paired with `description` (the in-app code recomputes the
 * embedding whenever the description changes); callers pass it as a
 * separate sibling param.
 */
const EDITABLE_DYNAMIC_FUNCTION_FIELDS = [
    'code', 'description', 'params_schema',
] as const;

/**
 * Dynamic UPDATE by name. Whitelisted fields only; `embedding` is
 * accepted alongside as a sibling param so the caller can rebuild the
 * vector when the description changes (matches in-app behavior).
 *
 * Returns `null` when no settable fields are present and no embedding
 * is supplied. Always bumps `updated_at` when emitting a query.
 */
export function updateDynamicFunction(args: {
    name: string;
    patch: Partial<Record<typeof EDITABLE_DYNAMIC_FUNCTION_FIELDS[number], unknown>>;
    embedding?: unknown;
}): QuerySpec | null {
    const setClauses: string[] = [];
    const variables: Record<string, unknown> = { name: args.name };

    for (const field of EDITABLE_DYNAMIC_FUNCTION_FIELDS) {
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

    setClauses.push('updated_at = time::now()');

    return {
        query: `
            UPDATE cortex_dynamic_functions
            SET ${setClauses.join(', ')}
            WHERE name = $name
        `,
        variables,
    };
}

/**
 * DELETE a dynamic function by name.
 */
export function deleteDynamicFunction(name: string): QuerySpec {
    return {
        query: `
            DELETE FROM cortex_dynamic_functions
            WHERE name = $name
        `,
        variables: { name },
    };
}
