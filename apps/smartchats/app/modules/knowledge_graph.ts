/**
 * Knowledge graph functions: store_declarative_knowledge, retrieve_declarative_knowledge
 */

import * as graph_utils from "../graph_utils"
import { search_knowledge_deep } from "../graph_utils"
import { triplesToGraphData, flatSearchResultToGraphData } from 'graph-viz/lib/adapter'

export function createKnowledgeGraphFunctionsModule() {
    return {
        id: 'kg_functions',
        name: 'Knowledge Graph Functions',
        position: 40,
        functions: [
            {
                enabled: true,
                description: `Store entity-relation-entity triples as permanent facts. Triples: [[subject, relation, object], ...]. Auto-normalizes, embeds, deduplicates. Only for enduring facts — not logs, metrics, or conversation data.`,
                name: 'store_declarative_knowledge',
                return_shape: `{ entities: { new: number, existing: number }, relations: { new: number, existing: number } }. Counts of entities and relations created vs already present in the KG.`,
                parameters: { triples: 'array' },
                fn: async (ops: any) => {
                    let { triples } = ops.params;
                    let { log, event } = ops.util;
                    log(`Storing ${triples.length} knowledge triples`);
                    let result = await graph_utils.store_knowledge(triples);
                    log(`Store result: ${JSON.stringify(result)}`);
                    try {
                        const graphData = triplesToGraphData(triples);
                        event({ type: 'knowledge_graph_update', graphData });
                    } catch (e: any) {
                        log(`Failed to emit graph update: ${e.message}`);
                    }
                    return result
                },
                return_type: 'any'
            },
            {
                enabled: true,
                description: `Semantic search of knowledge graph (cross-session memory). Returns ranked entities and relations. Use depth > 0 for multi-hop expansion. IMPORTANT: search this before telling the user you don't know something — UNLESS the answer is in the current chat history, in which case answer from context directly.`,
                name: 'retrieve_declarative_knowledge',
                return_shape: `A FORMATTED STRING (not an object) describing matched entities + relations, ready for the LLM to read. Includes entity names, distances, and entity-relation-entity triples. The return value IS the human-readable summary. Empty/no-results case: string indicating nothing found.`,
                parameters: { query: 'string', limit: 'number', depth: 'number' },
                fn: async (ops: any) => {
                    let { query, limit, depth } = ops.params;
                    let { log, event } = ops.util;
                    limit = limit || 10;
                    const depthVal = Number(depth) || 0;
                    log(`Searching knowledge graph for: "${query}" (depth: ${depthVal})`);

                    if (depthVal > 0) {
                        const deepResult = await search_knowledge_deep(query, { limit, depth: depthVal });
                        const entities = Array.from(deepResult.expanded.entities.values());
                        const relations = [...deepResult.seeds.relations, ...deepResult.expanded.relations];
                        const formatted = [
                            `Query: "${query}" (depth: ${depthVal})`,
                            '',
                            entities.length > 0 ? 'Entities:' : '',
                            ...entities.map(e => `  - ${e.name} (depth: ${e.depth}${e.distance != null ? `, distance: ${e.distance.toFixed(4)}` : ''})`),
                            '',
                            relations.length > 0 ? 'Relations:' : '',
                            ...relations.map((r: any) => `  - ${r.sourceName} --[${r.kind}]--> ${r.targetName}${r.distance != null ? ` (distance: ${r.distance.toFixed(4)})` : ''}`),
                        ].filter(Boolean).join('\n');
                        log(`Deep search complete: ${entities.length} entities, ${relations.length} relations`);
                        return formatted;
                    }

                    let result = await graph_utils.search_knowledge(query, { limit });
                    let formatted = graph_utils.format_search_results(result);
                    log(`Search complete`);
                    try {
                        const graphData = flatSearchResultToGraphData(result);
                        event({ type: 'knowledge_graph_update', graphData });
                    } catch (e: any) {
                        log(`Failed to emit graph update: ${e.message}`);
                    }
                    return formatted
                },
                return_type: 'any'
            },
            {
                enabled: true,
                description: `Delete triples or entire entities. Pass { triples: [[s,r,o]] } or { entity: 'name' }.`,
                name: 'delete_declarative_knowledge',
                return_shape: `With triples arg: { deleted: number, total: number, results: any[] } (per-triple results). With entity arg: indirect shape from graph_utils.delete_entity (typically { deleted: boolean, name: string }). Missing args: { error: 'Provide either triples or entity parameter' }.`,
                parameters: { triples: 'array', entity: 'string' },
                fn: async (ops: any) => {
                    let { triples, entity } = ops.params;
                    let { log, event } = ops.util;

                    if (entity) {
                        log(`Deleting entity: ${entity}`);
                        const result = await graph_utils.delete_entity(entity);
                        log(`Delete entity result: ${JSON.stringify(result)}`);
                        return result;
                    }

                    if (triples && triples.length > 0) {
                        log(`Deleting ${triples.length} triples`);
                        const results = [];
                        for (const [source, kind, target] of triples) {
                            const result = await graph_utils.delete_relation(source, kind, target);
                            results.push(result);
                        }
                        log(`Delete triples result: ${JSON.stringify(results)}`);
                        return { deleted: results.filter(r => r.deleted).length, total: results.length, results };
                    }

                    return { error: 'Provide either triples or entity parameter' };
                },
                return_type: 'any'
            },
            {
                enabled: true,
                description: `List all entities with relation counts.`,
                name: 'get_knowledge_graph_entities',
                return_shape: `Array of entity summaries: [{ name: string, relation_count: number }]. Sorted by relation_count DESC (most connected first).`,
                parameters: { limit: 'number' },
                fn: async (ops: any) => {
                    let { limit } = ops.params;
                    let { log } = ops.util;
                    limit = limit || 200;
                    log(`Getting all entities (limit: ${limit})`);

                    const entities = await graph_utils.get_all_entities({ limit });

                    // Get relation counts per entity
                    const entitiesWithCounts = [];
                    for (const e of entities) {
                        const relations = await graph_utils.get_entity_relations(e.name);
                        entitiesWithCounts.push({ name: e.name, relation_count: relations.length });
                    }

                    log(`Found ${entitiesWithCounts.length} entities`);
                    return entitiesWithCounts;
                },
                return_type: 'any'
            },
            {
                enabled: true,
                description: `Get all relationships for a specific entity.`,
                name: 'get_entity_detail',
                return_shape: `{ name: string, relations: Relation[] } where Relation = { sourceName: string, targetName: string, kind: string, name: string, ts?: string }. Access via result.name and result.relations[i].kind / .targetName.`,
                parameters: { entity: 'string' },
                fn: async (ops: any) => {
                    let { entity } = ops.params;
                    let { log } = ops.util;
                    log(`Getting entity detail: ${entity}`);

                    const normalizedName = graph_utils.normalize_id(entity);
                    const relations = await graph_utils.get_entity_relations(normalizedName);

                    log(`Entity ${normalizedName}: ${relations.length} relations`);
                    return { name: normalizedName, relations };
                },
                return_type: 'any'
            },
        ],
    }
}
