/**
 * Dynamic function management: create, load, list, update, delete
 */

import { getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';

export function createDynamicFunctionMgmtModule() {
    return {
        id: 'dynamic_function_mgmt',
        name: 'Dynamic Function Management',
        position: 30,
        functions: [
            {
                enabled: true,
                description: `Create and save a reusable async function to the database.`,
                name: 'create_dynamic_function',
                parameters: {
                    name: 'string',
                    description: 'string',
                    code: 'string',
                    params_schema: 'object'
                },
                fn: async (ops: any) => {
                    const { name, description, code, params_schema } = ops.params;
                    const { log, get_embedding } = ops.util;

                    log(`Creating dynamic function: ${name}`);

                    try {
                        eval(code);
                        log(`Code validation passed for ${name}`);
                    } catch (error: any) {
                        throw new Error(`Invalid function code syntax: ${error.message}`);
                    }

                    const embeddingText = `${name} ${description}`;
                    log(`Computing embedding for: ${embeddingText}`);
                    const embedding = await get_embedding(embeddingText);

                    await getBackend().data.query(queries.insertDynamicFunction({
                        name, description, code, params_schema, embedding,
                    }));

                    log(`Dynamic function "${name}" created successfully`);
                    return {
                        success: true,
                        name,
                        message: `Dynamic function "${name}" created and saved to database`
                    };
                },
                return_type: 'object'
            },
            {
                enabled: true,
                description: `Load a saved dynamic function by name.`,
                name: 'load_dynamic_function',
                parameters: {
                    name: 'string'
                },
                fn: async (ops: any) => {
                    const { name } = ops.params;
                    const { log } = ops.util;

                    log(`Loading dynamic function: ${name}`);

                    const response = await getBackend().data.query(queries.loadDynamicFunction(name)) as any;

                    const stmts = response?.data?.result?.result;
                    const rows = Array.isArray(stmts) && stmts[0]?.result ? stmts[0].result : stmts;

                    if (!rows || !Array.isArray(rows) || rows.length === 0) {
                        throw new Error(`Dynamic function "${name}" not found`);
                    }

                    const func = rows[0];
                    log(`Dynamic function "${name}" loaded successfully`);
                    return func;
                },
                return_type: 'object'
            },
            {
                enabled: true,
                description: `List all saved dynamic functions with descriptions.`,
                name: 'list_dynamic_functions',
                parameters: null,
                fn: async (ops: any) => {
                    const { log } = ops.util;

                    log(`Listing all dynamic functions`);

                    const response = await getBackend().data.query(queries.listDynamicFunctions()) as any;

                    const stmts = response?.data?.result?.result;
                    const rows = Array.isArray(stmts) && stmts[0]?.result ? stmts[0].result : stmts;

                    if (!rows || !Array.isArray(rows) || rows.length === 0) {
                        return [];
                    }

                    return rows;
                },
                return_type: 'array'
            },
            {
                enabled: true,
                description: `Update a dynamic function's code, description, or params. Only provided fields change.`,
                name: 'update_dynamic_function',
                parameters: {
                    name: 'string',
                    code: 'string',
                    description: 'string',
                    params_schema: 'object'
                },
                fn: async (ops: any) => {
                    const { name, code, description, params_schema } = ops.params;
                    const { log, get_embedding } = ops.util;

                    log(`Updating dynamic function: ${name}`);

                    const patch: Record<string, unknown> = {};
                    let embedding: unknown | undefined;

                    if (code !== undefined) {
                        try {
                            eval(code);
                            log(`Code validation passed for updated ${name}`);
                        } catch (error: any) {
                            throw new Error(`Invalid function code syntax: ${error.message}`);
                        }
                        patch.code = code;
                    }

                    if (description !== undefined) {
                        patch.description = description;

                        const embeddingText = `${name} ${description}`;
                        log(`Recomputing embedding for: ${embeddingText}`);
                        embedding = await get_embedding(embeddingText);
                    }

                    if (params_schema !== undefined) {
                        patch.params_schema = params_schema;
                    }

                    const spec = queries.updateDynamicFunction({ name, patch, embedding });
                    if (!spec) {
                        throw new Error('No fields provided to update');
                    }

                    await getBackend().data.query(spec);

                    log(`Dynamic function "${name}" updated successfully`);
                    return {
                        success: true,
                        name,
                        message: `Dynamic function "${name}" updated`
                    };
                },
                return_type: 'object'
            },
            {
                enabled: true,
                description: `Delete a dynamic function by name.`,
                name: 'delete_dynamic_function',
                parameters: {
                    name: 'string'
                },
                fn: async (ops: any) => {
                    const { name } = ops.params;
                    const { log } = ops.util;

                    log(`Deleting dynamic function: ${name}`);

                    await getBackend().data.query(queries.deleteDynamicFunction(name));

                    log(`Dynamic function "${name}" deleted successfully`);
                    return {
                        success: true,
                        name,
                        message: `Dynamic function "${name}" deleted from database`
                    };
                },
                return_type: 'object'
            },
        ],
    }
}
