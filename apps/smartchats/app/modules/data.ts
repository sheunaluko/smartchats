/**
 * Data & embedding functions: compute_embedding, array_nth_value, access_database_with_surreal_ql
 */

import { embed_vector, getBackend } from '@/lib/backend';

export function createDataModule() {
    return {
        id: 'data_functions',
        name: 'Data Functions',
        position: 20,
        system_msg: `## Database Access (SurrealQL)

### Response format
Queries return unwrapped results directly — not the raw SurrealDB response envelope.
- Single-statement query: returns the rows array (e.g. [{id, name, ...}, ...])
- Multi-statement query: returns an array of results, one per statement (e.g. [createResult, selectRows])
- Errors throw — if a query has a syntax error or permission issue, you will get an error message, not an empty array.

### Timestamps
The database automatically handles created_at and updated_at timestamps. Do not manually add these fields when inserting or updating records — they are set by the DB.

### Query conventions
- Always use parameterized variables with $notation (e.g. WHERE name = $name) — never interpolate user values into query strings
- LIMIT requires a raw integer in the query string (e.g. LIMIT 10), NOT a variable
- Date filtering: use SurrealQL datetime literals: d'2026-03-20T00:00:00Z'
- OMIT embedding and other large columns from SELECT results unless you specifically need them (e.g. SELECT * OMIT embedding FROM logs)

### Workspace
Use the workspace object for persisting structured data across turns in multi-step flows (e.g. extraction review results, form data, intermediate query results). Do not rely on conversation history for structured data — workspace survives context compression.

### Tables
- logs — user logs (use logging module functions, not raw queries)
- cortex — agent long-term memory, procedural instructions
- metrics — quantifiable user activities (use retrieve_metrics for data lookup, display_metrics for visualization — only use raw SurrealQL for metrics if the user explicitly asks)
- cortex_dynamic_functions — user-defined dynamic functions`,
        functions: [
            {
                enabled: true,
                description: `
	Compute vector embedding for a text input.

	This function takes an input named text and computes the vector embedding of it.
	Returns the embedding as an array of numbers.

	`,
                name: 'compute_embedding',
                parameters: { text: 'string' },
                fn: async (ops: any) => {
                    let { log } = ops.util;
                    let { text } = ops.params;
                    log(`Retrieved request to compute embedding of: ${text}`);
                    let embedding = await embed_vector(text);
                    log(`Got embedding result`)
                    return embedding;
                },
                return_type: 'array'
            },
            {
                enabled: true,
                description: `
           Return the nth value of an array
	`,
                name: 'array_nth_value',
                parameters: { a: 'array', n: 'number' },
                fn: async (ops: any) => {
                    let { a, n } = ops.params;
                    return (a as any)[Number(n)];
                },
                return_type: 'any'
            },
            {
                enabled: true,
                description: `
Run a SurrealQL query on the database. Returns unwrapped rows directly — not the raw response envelope.
- Single statement: returns rows array (e.g. [{id, name}, ...])
- Multi-statement: returns array of results, one per statement
- Errors throw with the SurrealDB error message

Parameters:
- query: SurrealQL query string. Use $variable syntax for parameterized values.
- variables: (optional) key-value map of variable values referenced in the query
`,
                name: 'access_database_with_surreal_ql',
                parameters: {
                    query: 'string',
                    variables: 'object'
                },
                fn: async (ops: any) => {
                    let { query, variables } = ops.params;
                    let { log } = ops.util;

                    log(`Surreal QL: \n${query}`);
                    const response = await getBackend().data.query({ query, variables });
                    log(`Got response`);
                    // Multi-statement gateway — return each statement's result array (or raw result).
                    if (response.statements.length <= 1) {
                        return response.rows;
                    }
                    return response.statements.map(s => s.result);
                },
                return_type: 'any'
            },
        ],
    }
}
