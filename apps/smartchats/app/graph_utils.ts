'use client';

/**
 * Graph Utils - Knowledge graph helpers for storing/retrieving declarative knowledge
 *
 * Uses user_entities and user_relations tables in SurrealDB via the configured
 * SmartChatsBackend.data API. All operations are user-scoped via the active
 * AuthProvider.
 */

import { logger, debug } from 'smartchats-common';
import { queries } from 'smartchats-database';
import { embed_vector, getBackend } from '@/lib/backend';
import { getUserTimezone, toLocalTimestamp } from './modules/system';

// Logger setup
const log = logger.get_logger({ id: 'graph_utils' });

// ============================================================
// ID NORMALIZATION
// ============================================================

/**
 * Normalize a string to a valid SurrealDB ID
 * "Albert Einstein" -> "albert_einstein"
 */
export function normalize_id(s: string): string {
    return s.toLowerCase().trim().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, "");
}

/**
 * Generate a relation ID from source, kind, and target
 * ("shay", "created", "tidyscripts") -> "shay_created_tidyscripts"
 */
export function generate_relation_id(sourceId: string, kind: string, targetId: string): string {
    return `${sourceId}_${kind}_${targetId}`;
}

/**
 * Generate embedding text for a relation
 */
export function relation_embedding_text(sourceId: string, kind: string, targetId: string): string {
    return `${sourceId} ${kind} ${targetId}`;
}

// ============================================================
// TRIPLE PARSING
// ============================================================

export type Triple = [string, string, string]; // [subject, relation, object]

export type RelationInfo = {
    name: string;       // composite key: "shay_created_tidyscripts"
    sourceName: string; // "shay"
    targetName: string; // "tidyscripts"
    kind: string;       // "created"
};

export type ParsedTriples = {
    entityNames: Set<string>;
    relations: Map<string, RelationInfo>;
};

/**
 * Parse triples into entity names and relation map
 * Deduplicates automatically
 */
export function parse_triples(triples: Triple[]): ParsedTriples {
    log(`Parsing ${triples.length} triples`);

    const entityNames = new Set<string>();
    const relations = new Map<string, RelationInfo>();

    for (const [source, relationKind, target] of triples) {
        const sourceName = normalize_id(source);
        const targetName = normalize_id(target);
        const kind = normalize_id(relationKind);
        const relationName = generate_relation_id(sourceName, kind, targetName);

        entityNames.add(sourceName);
        entityNames.add(targetName);

        if (!relations.has(relationName)) {
            relations.set(relationName, { name: relationName, sourceName, targetName, kind });
        }
    }

    log(`Parsed: ${entityNames.size} unique entities, ${relations.size} unique relations`);
    debug.add('parsed_triples', { entityNames: [...entityNames], relations: [...relations.values()] });

    return { entityNames, relations };
}

// ============================================================
// DATABASE QUERIES - CHECK EXISTING
// ============================================================

/**
 * Check which entity names already exist in the database
 */
export async function check_existing_entities(entityNames: string[]): Promise<Set<string>> {
    if (entityNames.length === 0) return new Set();

    log(`Checking ${entityNames.length} entity names for existence`);

    try {
        const result = await getBackend().data.query(queries.checkExistingEntityNames(entityNames)) as any;

        const resultData = result?.rows || [];
        const existingNames = new Set<string>(
            resultData.map((r: any) => String(r))
        );

        log(`Found ${existingNames.size} existing entities`);
        debug.add('existing_entities', [...existingNames]);

        return existingNames;
    } catch (error: any) {
        log(`Error checking existing entities: ${error.message}`);
        throw error;
    }
}

/**
 * Check which relation names already exist in the database
 */
export async function check_existing_relations(relationNames: string[]): Promise<Set<string>> {
    if (relationNames.length === 0) return new Set();

    log(`Checking ${relationNames.length} relation names for existence`);

    try {
        const result = await getBackend().data.query(queries.checkExistingRelationNames(relationNames)) as any;

        const resultData = result?.rows || [];
        const existingNames = new Set<string>(
            resultData.map((r: any) => String(r))
        );

        log(`Found ${existingNames.size} existing relations`);
        debug.add('existing_relations', [...existingNames]);

        return existingNames;
    } catch (error: any) {
        log(`Error checking existing relations: ${error.message}`);
        throw error;
    }
}

// ============================================================
// EMBEDDINGS
// ============================================================

/**
 * Compute embeddings for an array of texts
 */
export async function compute_embeddings(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    log(`Computing ${texts.length} embeddings`);

    try {
        const embeddings = await Promise.all(
            texts.map(text => embed_vector(text))
        );

        log(`Computed ${embeddings.length} embeddings`);
        return embeddings;
    } catch (error: any) {
        log(`Error computing embeddings: ${error.message}`);
        throw error;
    }
}

// ============================================================
// MAIN STORE FUNCTION
// ============================================================

export type StoreKnowledgeResult = {
    entities: { new: number; existing: number };
    relations: { new: number; existing: number };
};

/**
 * Main function to store knowledge triples
 *
 * 1. Parses triples into entity IDs and relations
 * 2. Checks which already exist in DB
 * 3. Computes embeddings only for new items
 * 4. Inserts all new entities and relations in a single query
 */
export async function store_knowledge(triples: Triple[]): Promise<StoreKnowledgeResult> {
    log(`store_knowledge called with ${triples.length} triples`);
    debug.add('store_knowledge_input', triples);

    // 1. Parse triples
    const { entityNames, relations } = parse_triples(triples);
    const entityNameList = [...entityNames];
    const relationList = [...relations.values()];

    // 2. Build relation names for dedup check
    const relationNameList = relationList.map(r => r.name);

    // 3. Check existing in parallel
    const [existingEntityNames, existingRelationNames] = await Promise.all([
        check_existing_entities(entityNameList),
        check_existing_relations(relationNameList)
    ]);

    // 4. Filter to new only
    const newEntityNames = entityNameList.filter(name => !existingEntityNames.has(name));
    const newRelations = relationList.filter(r => !existingRelationNames.has(r.name));

    log(`New items: ${newEntityNames.length} entities, ${newRelations.length} relations`);
    log(`Existing items: ${existingEntityNames.size} entities, ${existingRelationNames.size} relations`);

    // 5. Compute embeddings for new items only
    const textsToEmbed = [
        ...newEntityNames,
        ...newRelations.map(r => relation_embedding_text(r.sourceName, r.kind, r.targetName))
    ];

    const allEmbeddings = await compute_embeddings(textsToEmbed);
    const entityEmbeddings = allEmbeddings.slice(0, newEntityNames.length);
    const relationEmbeddings = allEmbeddings.slice(newEntityNames.length);

    // 6. Build data for insert
    const entitiesToInsert = newEntityNames.map((name, i) => ({
        name,
        embedding: entityEmbeddings[i]
    }));

    const relationsToInsert = newRelations.map((r, i) => ({
        ...r,
        embedding: relationEmbeddings[i]
    }));

    // 7. Insert all in single query
    if (entitiesToInsert.length > 0 || relationsToInsert.length > 0) {
        // lts (logical timestamp): when this fact was added in the user's local time.
        // Preserved across export/import. See schema.ts dual-field invariant.
        const tz = getUserTimezone();
        const lts = toLocalTimestamp(new Date(), tz);

        const spec = queries.buildKnowledgeInsertQuery({
            entities: entitiesToInsert,
            relations: relationsToInsert,
            lts,
        });

        log(`Built insert query with ${entitiesToInsert.length} entities and ${relationsToInsert.length} relations`);
        debug.add('insert_query', spec.query);

        try {
            const result = await getBackend().data.query(spec);
            log(`Insert query executed successfully`);
            debug.add('insert_result', result);
        } catch (error: any) {
            log(`Error executing insert query: ${error.message}`);
            throw error;
        }
    } else {
        log(`Nothing new to insert`);
    }

    const result: StoreKnowledgeResult = {
        entities: { new: newEntityNames.length, existing: existingEntityNames.size },
        relations: { new: newRelations.length, existing: existingRelationNames.size }
    };

    log(`store_knowledge complete`);
    debug.add('store_knowledge_result', result);

    return result;
}

// ============================================================
// SEARCH / RETRIEVE FUNCTIONS
// ============================================================

export type SearchKnowledgeResult = {
    query: string;
    entities: any[];
    relations: any[];
};

/**
 * Search for knowledge using vector similarity (KNN)
 */
export async function search_knowledge(
    query: string,
    options: { limit?: number; effort?: number } = {}
): Promise<SearchKnowledgeResult> {
    const { limit = 10, effort = 40 } = options;

    log(`search_knowledge: "${query}" (limit: ${limit}, effort: ${effort})`);

    // Compute query embedding
    const queryEmbedding = await embed_vector(query);

    // Search entities and relations in parallel using KNN syntax
    const [entityResult, relationResult] = await Promise.all([
        getBackend().data.query(queries.knnSearchEntities({ embedding: queryEmbedding, limit, effort })),
        getBackend().data.query(queries.knnSearchRelations({ embedding: queryEmbedding, limit, effort })),
    ]) as any[];

    const entities = entityResult?.rows || [];
    const relations = relationResult?.rows || [];

    const result: SearchKnowledgeResult = {
        query,
        entities,
        relations
    };

    log(`search_knowledge found: ${entities.length} entities, ${relations.length} relations`);
    debug.add('search_knowledge_result', result);

    return result;
}

/**
 * Format search results as text context for LLM consumption
 */
export function format_search_results(results: SearchKnowledgeResult): string {
    const lines: string[] = [];

    lines.push(`Query: "${results.query}"`);
    lines.push('');

    if (results.entities.length > 0) {
        lines.push('Entities:');
        for (const e of results.entities) {
            const name = e.name || '?';
            const dist = e.distance?.toFixed(4) || '?';
            lines.push(`  - ${name} (distance: ${dist})`);
        }
        lines.push('');
    }

    if (results.relations.length > 0) {
        lines.push('Relations:');
        for (const r of results.relations) {
            const source = r.sourceName || '?';
            const target = r.targetName || '?';
            const kind = r.kind || '?';
            const dist = r.distance?.toFixed(4) || '?';
            lines.push(`  - ${source} --[${kind}]--> ${target} (distance: ${dist})`);
        }
    }

    return lines.join('\n');
}

// ============================================================
// DEEP SEARCH — Multi-depth graph expansion
// ============================================================

export type DeepSearchResult = {
    query: string;
    seeds: {
        entities: any[];
        relations: any[];
    };
    expanded: {
        entities: Map<string, { name: string; depth: number; distance?: number }>;
        relations: any[];
    };
    depth: number;
    totalEntities: number;
    totalRelations: number;
};

/**
 * Search knowledge graph with multi-hop expansion.
 *
 * 1. KNN search for seed entities + relations (depth 0)
 * 2. For each depth level, query relations touching frontier entities
 * 3. Discover new entities from relation endpoints, add to next frontier
 * 4. Stop when target depth reached or no new entities found
 */
export async function search_knowledge_deep(
    query: string,
    options: { limit?: number; effort?: number; depth?: number } = {}
): Promise<DeepSearchResult> {
    const { limit = 10, effort = 40, depth: maxDepth = 1 } = options;
    const clampedDepth = Math.min(Math.max(maxDepth, 0), 5);

    log(`search_knowledge_deep: "${query}" (limit: ${limit}, depth: ${clampedDepth})`);

    // Step 1: KNN search for seeds
    const seedResult = await search_knowledge(query, { limit, effort });

    const entityMap = new Map<string, { name: string; depth: number; distance?: number }>();
    const allRelations: any[] = [...seedResult.relations];

    // Register seed entities
    for (const e of seedResult.entities) {
        const name = e.name || e.id;
        if (name) {
            entityMap.set(name, { name, depth: 0, distance: e.distance });
        }
    }

    // Also register entities discovered from seed relations
    for (const r of seedResult.relations) {
        if (r.sourceName && !entityMap.has(r.sourceName)) {
            entityMap.set(r.sourceName, { name: r.sourceName, depth: 0, distance: r.distance });
        }
        if (r.targetName && !entityMap.has(r.targetName)) {
            entityMap.set(r.targetName, { name: r.targetName, depth: 0, distance: r.distance });
        }
    }

    // Step 2: Expand for each depth level
    let frontier = new Set<string>(entityMap.keys());

    for (let d = 1; d <= clampedDepth; d++) {
        if (frontier.size === 0) break;

        const frontierNames = Array.from(frontier);
        log(`Depth ${d}: expanding ${frontierNames.length} frontier entities`);

        try {
            const result = await getBackend().data.query(queries.getRelationsTouchingEntities(frontierNames)) as any;

            const relations = result?.rows || [];
            const nextFrontier = new Set<string>();

            for (const rel of relations) {
                // Check if this relation is new
                const alreadyHave = allRelations.some(
                    r => r.sourceName === rel.sourceName && r.kind === rel.kind && r.targetName === rel.targetName
                );
                if (!alreadyHave) {
                    allRelations.push(rel);
                }

                // Discover new entities
                for (const name of [rel.sourceName, rel.targetName]) {
                    if (name && !entityMap.has(name)) {
                        entityMap.set(name, { name, depth: d });
                        nextFrontier.add(name);
                    }
                }
            }

            frontier = nextFrontier;
            log(`Depth ${d}: found ${relations.length} relations, ${nextFrontier.size} new entities`);
        } catch (error: any) {
            log(`Error at depth ${d}: ${error.message}`);
            break;
        }
    }

    const result: DeepSearchResult = {
        query,
        seeds: {
            entities: seedResult.entities,
            relations: seedResult.relations,
        },
        expanded: {
            entities: entityMap,
            relations: allRelations.slice(seedResult.relations.length), // only expanded relations
        },
        depth: clampedDepth,
        totalEntities: entityMap.size,
        totalRelations: allRelations.length,
    };

    log(`search_knowledge_deep complete: ${entityMap.size} entities, ${allRelations.length} relations`);
    debug.add('search_knowledge_deep_result', {
        ...result,
        expanded: {
            entities: Array.from(entityMap.entries()),
            relations: result.expanded.relations,
        }
    });

    return result;
}

// ============================================================
// LIST / DELETE FUNCTIONS
// ============================================================

/**
 * List all entities, optionally with a limit.
 */
export async function get_all_entities(options: { limit?: number } = {}): Promise<any[]> {
    const { limit = 200 } = options;
    log(`get_all_entities (limit: ${limit})`);

    try {
        const result = await getBackend().data.query(queries.getAllEntities({ limit })) as any;

        const entities = result?.rows || [];
        log(`get_all_entities found ${entities.length} entities`);
        return entities;
    } catch (error: any) {
        log(`Error getting all entities: ${error.message}`);
        throw error;
    }
}

/**
 * List all relations, optionally filtered by entity name and limited.
 */
export async function get_all_relations(options: { limit?: number; entity?: string } = {}): Promise<any[]> {
    const { limit = 500, entity } = options;
    log(`get_all_relations (limit: ${limit}, entity: ${entity || 'all'})`);

    try {
        const spec = queries.getAllRelations({
            limit,
            entity: entity ? normalize_id(entity) : undefined,
        });
        const result = await getBackend().data.query(spec) as any;
        const relations = result?.rows || [];
        log(`get_all_relations found ${relations.length} relations`);
        return relations;
    } catch (error: any) {
        log(`Error getting all relations: ${error.message}`);
        throw error;
    }
}

/**
 * Delete a specific relation by its triple components.
 */
export async function delete_relation(sourceName: string, kind: string, targetName: string): Promise<{ deleted: boolean; name: string }> {
    const sn = normalize_id(sourceName);
    const k = normalize_id(kind);
    const tn = normalize_id(targetName);
    const relationName = generate_relation_id(sn, k, tn);

    log(`delete_relation: ${relationName} (${sn} -[${k}]-> ${tn})`);

    try {
        const result = await getBackend().data.query(queries.deleteRelationByName(relationName)) as any;

        const deleted = (result?.rows || []).length > 0;
        log(`delete_relation: ${deleted ? 'deleted' : 'not found'} — ${relationName}`);
        return { deleted, name: relationName };
    } catch (error: any) {
        log(`Error deleting relation: ${error.message}`);
        throw error;
    }
}

/**
 * Delete an entity AND all its relations.
 */
export async function delete_entity(entityName: string): Promise<{ deleted: boolean; name: string; relations_deleted: number }> {
    const name = normalize_id(entityName);
    log(`delete_entity: ${name}`);

    try {
        // Delete relations first
        const relResult = await getBackend().data.query(queries.deleteRelationsTouchingEntity(name)) as any;
        const relationsDeleted = (relResult?.rows || []).length;

        // Delete entity
        const entResult = await getBackend().data.query(queries.deleteEntityByName(name)) as any;
        const deleted = (entResult?.rows || []).length > 0;

        log(`delete_entity: ${deleted ? 'deleted' : 'not found'} — ${name}, ${relationsDeleted} relations removed`);
        return { deleted, name, relations_deleted: relationsDeleted };
    } catch (error: any) {
        log(`Error deleting entity: ${error.message}`);
        throw error;
    }
}

// ============================================================
// ENTITY DETAIL
// ============================================================

// ============================================================
// QUERY BUILDING (test-suite shim)
// ============================================================

/**
 * Build a single SurrealQL query string to insert all entities and relations.
 * Thin shim around `queries.buildKnowledgeInsertQuery` — preserved for the
 * `test_graph_utils` browser-console test (which asserts on the returned
 * query string). New code should call `queries.buildKnowledgeInsertQuery`
 * directly.
 */
export function build_insert_query(
    entities: { name: string; embedding: number[] }[],
    relations: { name: string; sourceName: string; targetName: string; kind: string; embedding: number[] }[]
): string {
    const tz = getUserTimezone();
    const lts = toLocalTimestamp(new Date(), tz);
    const spec = queries.buildKnowledgeInsertQuery({ entities, relations, lts });
    log(`Built insert query with ${entities.length} entities and ${relations.length} relations`);
    debug.add('insert_query', spec.query);
    return spec.query;
}

/**
 * Get all relations for a single entity by name.
 */
export async function get_entity_relations(entityName: string): Promise<any[]> {
    const normalizedName = normalize_id(entityName);
    log(`get_entity_relations: "${normalizedName}"`);

    try {
        const result = await getBackend().data.query(queries.getEntityRelations(normalizedName)) as any;

        const relations = result?.rows || [];
        log(`get_entity_relations found ${relations.length} relations for "${normalizedName}"`);
        return relations;
    } catch (error: any) {
        log(`Error getting entity relations: ${error.message}`);
        throw error;
    }
}
