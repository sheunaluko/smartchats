/**
 * Knowledge graph query builders.
 *
 * The KG stores facts as entity-relation-entity triples:
 *   user_entities: nodes with `name` and optional `embedding`
 *   user_relations: directed edges (TYPE RELATION) with `name`, `kind`,
 *                   `sourceName`, `targetName`, optional `embedding`
 *
 * Both tables carry the dual-field timestamp invariant after the v1.1.0
 * schema bump (lts populated by app writes; create-time fallback
 * available on existing rows via the migration backfill).
 */

import type { QuerySpec, AuditFields, EventTimeFields } from '../types.js';

export interface EntityRow extends AuditFields {
    id: string;
    name: string;
}

export interface RelationRow extends AuditFields {
    id: string;
    name: string;
    sourceName: string;
    targetName: string;
    kind: string;
}

export interface QueryKnowledgeGraphArgs {
    /** Substring to match against entity and relation names (case-insensitive). */
    query: string;
    limit?: number;
}

/**
 * Search entities by name substring. Guards against NULL `name` rows —
 * `string::lowercase(NULL)` would ERR otherwise.
 */
export function searchEntitiesByName(args: QueryKnowledgeGraphArgs): QuerySpec {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    return {
        query: `SELECT id, name FROM user_entities WHERE name != NONE AND string::lowercase(name) CONTAINS $search LIMIT ${limit}`,
        variables: { search: args.query.toLowerCase() },
    };
}

/**
 * Search relations by name OR kind substring. Returns endpoint names
 * (sourceName, targetName) so consumers can render the triple without
 * a follow-up entity lookup. Guards both `name` and `kind` against NULL.
 */
export function searchRelationsByName(args: QueryKnowledgeGraphArgs): QuerySpec {
    const limit = Math.min(Math.max(args.limit ?? 20, 1), 100);
    return {
        query: `SELECT id, name, sourceName, targetName, kind FROM user_relations WHERE (name != NONE AND string::lowercase(name) CONTAINS $search) OR (kind != NONE AND string::lowercase(kind) CONTAINS $search) LIMIT ${limit}`,
        variables: { search: args.query.toLowerCase() },
    };
}

// ── Existence checks ─────────────────────────────────────────────────────────

/**
 * Get the `name` field of any user_entities rows whose name is in the
 * provided set. Used to dedupe inserts: pass the candidate names, get
 * back the subset that already exists.
 */
export function checkExistingEntityNames(names: string[]): QuerySpec {
    return {
        query: `SELECT VALUE name FROM user_entities WHERE name IN $names`,
        variables: { names },
    };
}

/**
 * Get the `name` field of any user_relations rows whose name is in the
 * provided set. Used to dedupe inserts.
 */
export function checkExistingRelationNames(names: string[]): QuerySpec {
    return {
        query: `SELECT VALUE name FROM user_relations WHERE name IN $names`,
        variables: { names },
    };
}

// ── Bulk insert (multi-statement) ───────────────────────────────────────────

export interface EntityInsertSpec {
    name: string;
    embedding: number[];
}

export interface RelationInsertSpec {
    name: string;
    sourceName: string;
    targetName: string;
    kind: string;
    embedding: number[];
}

/**
 * Build a single multi-statement query that creates all new entities
 * (CREATE user_entities ...) and relations (RELATE ...->user_relations->...)
 * in one round-trip. The same event-time fields are applied to every
 * statement.
 *
 * `lts` is the legacy fake-UTC local-wall-clock ISO (dropped in 1.6.0).
 * `ts` is the real-UTC instant. `local_date` is YYYY-MM-DD in the user's
 * tz. `local_tz` is the IANA name.
 *
 * Embeddings are inlined into the query string (not parameter-bound)
 * because SurrealDB's RELATE / CONTENT object literal context doesn't
 * accept array variables in all driver versions; this matches the
 * historical in-app behavior.
 */
export interface BuildKnowledgeInsertQueryArgs extends EventTimeFields {
    entities: EntityInsertSpec[];
    relations: RelationInsertSpec[];
}
export function buildKnowledgeInsertQuery(args: BuildKnowledgeInsertQueryArgs): QuerySpec {
    const statements: string[] = [];
    const { entities, relations, ts, local_date, local_tz } = args;
    const timeFields = `ts: d'${ts}', local_date: "${local_date}", local_tz: "${local_tz}"`;

    for (const e of entities) {
        statements.push(
            `CREATE user_entities CONTENT { name: "${e.name}", embedding: [${e.embedding.join(',')}], ${timeFields} }`
        );
    }

    for (const r of relations) {
        statements.push(
            `RELATE (SELECT VALUE id FROM user_entities WHERE name = "${r.sourceName}" LIMIT 1)->user_relations->(SELECT VALUE id FROM user_entities WHERE name = "${r.targetName}" LIMIT 1) CONTENT { name: "${r.name}", sourceName: "${r.sourceName}", targetName: "${r.targetName}", kind: "${r.kind}", embedding: [${r.embedding.join(',')}], ${timeFields} }`
        );
    }

    const query = statements.join(';\n') + ';';
    return { query, variables: {} };
}

// ── KNN search ──────────────────────────────────────────────────────────────

export interface KnnSearchArgs {
    embedding: number[];
    limit: number;
    effort: number;
}

/**
 * KNN search over user_entities by embedding. Returns id/name/distance.
 */
export function knnSearchEntities(args: KnnSearchArgs): QuerySpec {
    return {
        query: `SELECT id, name, vector::distance::knn() AS distance
                    FROM user_entities
                    WHERE embedding <|${args.limit},${args.effort}|> $e
                    ORDER BY distance ASC`,
        variables: { e: args.embedding },
    };
}

/**
 * KNN search over user_relations by embedding. Returns full triple
 * components plus distance.
 */
export function knnSearchRelations(args: KnnSearchArgs): QuerySpec {
    return {
        query: `SELECT id, name, sourceName, targetName, kind, vector::distance::knn() AS distance
                    FROM user_relations
                    WHERE embedding <|${args.limit},${args.effort}|> $e
                    ORDER BY distance ASC`,
        variables: { e: args.embedding },
    };
}

// ── Frontier expansion (deep search) ───────────────────────────────────────

/**
 * All relations touching any of the given entity names — used to
 * expand the search frontier one hop at a time.
 */
export function getRelationsTouchingEntities(names: string[]): QuerySpec {
    return {
        query: `SELECT id, name, sourceName, targetName, kind FROM user_relations WHERE sourceName IN $names OR targetName IN $names`,
        variables: { names },
    };
}

// ── List ────────────────────────────────────────────────────────────────────

/**
 * List all entities, ordered by name ASC, capped at limit.
 */
export function getAllEntities(args: { limit: number }): QuerySpec {
    return {
        query: `SELECT id, name FROM user_entities ORDER BY name ASC LIMIT $limit`,
        variables: { limit: args.limit },
    };
}

/**
 * List all relations (or all touching a given entity name), ordered by
 * name ASC, capped at limit.
 */
export function getAllRelations(args: { limit: number; entity?: string }): QuerySpec {
    if (args.entity) {
        return {
            query: `SELECT id, name, sourceName, targetName, kind FROM user_relations WHERE sourceName = $entity OR targetName = $entity ORDER BY name ASC LIMIT $limit`,
            variables: { limit: args.limit, entity: args.entity },
        };
    }
    return {
        query: `SELECT id, name, sourceName, targetName, kind FROM user_relations ORDER BY name ASC LIMIT $limit`,
        variables: { limit: args.limit },
    };
}

// ── Delete ──────────────────────────────────────────────────────────────────

/**
 * Delete a single relation by its composite name (sourceId_kind_targetId).
 * Returns the deleted rows via RETURN BEFORE so the caller can confirm
 * whether anything matched.
 */
export function deleteRelationByName(name: string): QuerySpec {
    return {
        query: `DELETE FROM user_relations WHERE name = $name RETURN BEFORE`,
        variables: { name },
    };
}

/**
 * Delete every relation (in either direction) that touches an entity.
 * Used as a cascading cleanup before deleting the entity itself.
 */
export function deleteRelationsTouchingEntity(name: string): QuerySpec {
    return {
        query: `DELETE FROM user_relations WHERE sourceName = $name OR targetName = $name RETURN BEFORE`,
        variables: { name },
    };
}

/**
 * Delete an entity by its name. Caller is responsible for cascading
 * relation deletes via `deleteRelationsTouchingEntity` first.
 */
export function deleteEntityByName(name: string): QuerySpec {
    return {
        query: `DELETE FROM user_entities WHERE name = $name RETURN BEFORE`,
        variables: { name },
    };
}

// ── Entity detail ──────────────────────────────────────────────────────────

/**
 * Get every relation (in either direction) that touches a single entity.
 * Used for the entity-detail view. No limit — assume the caller has
 * already chosen a bounded entity.
 */
export function getEntityRelations(name: string): QuerySpec {
    return {
        query: `SELECT id, name, sourceName, targetName, kind FROM user_relations WHERE sourceName = $name OR targetName = $name`,
        variables: { name },
    };
}
