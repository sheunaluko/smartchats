/**
 * App-platform query builders.
 *
 * Two tables:
 *   smartchats_apps         — app manifests (registry of installable apps)
 *   smartchats_app_installs — per-user installs with grants and runtime state
 *
 * The registry stores `app_id` as a normal column because `id` is the
 * SurrealDB record id. The in-app code re-projects `app_id` → `id` on
 * every read for the AppManifest type.
 */

import type { QuerySpec } from '../types.js';

// ── Type stubs ──────────────────────────────────────────────────────────────
// These mirror the in-app `AppManifest` and `AppInstall` shapes but are
// declared loose to avoid a dependency on app-internal type modules.
// Callers are expected to validate the runtime shape on their side.

export type AppManifestRow = Record<string, unknown> & { app_id?: string; id?: string };
export type AppInstallRow = Record<string, unknown> & { app_id?: string };

// ════════════════════════════════════════════════════════════════════════════
// smartchats_apps
// ════════════════════════════════════════════════════════════════════════════

export interface InsertAppArgs {
    app_id: string;
    name: string;
    version: string;
    description: string;
    author: unknown;
    icon: unknown;
    source: string;
    categories: unknown[];
    tags: unknown[];
    embedding: number[];
    modules: unknown;
    interaction_mode: string;
    html_templates: unknown;
    display_mode: string;
    state_schema: unknown;
    permissions: unknown;
    requested_functions: unknown[];
    voice_hooks: unknown;
    on_activate: unknown;
    on_deactivate: unknown;
    external_scripts: unknown;
    migrations: unknown;
    min_tier: string;
    version_history: unknown[];
    forked_from: unknown;
    _content_hash: unknown;
    published_at: unknown;
}

/**
 * INSERT a new app manifest. `install_count`, `rating_*`, `featured`,
 * `verified` are initialized to defaults. `created_at` / `updated_at`
 * are server-stamped.
 */
export function insertApp(args: InsertAppArgs): QuerySpec {
    return {
        query: `INSERT INTO smartchats_apps {
        app_id: $app_id,
        name: $name,
        version: $version,
        description: $description,
        author: $author,
        icon: $icon,
        source: $source,
        categories: $categories,
        tags: $tags,
        embedding: $embedding,
        modules: $modules,
        interaction_mode: $interaction_mode,
        html_templates: $html_templates,
        display_mode: $display_mode,
        state_schema: $state_schema,
        permissions: $permissions,
        requested_functions: $requested_functions,
        voice_hooks: $voice_hooks,
        on_activate: $on_activate,
        on_deactivate: $on_deactivate,
        external_scripts: $external_scripts,
        migrations: $migrations,
        install_count: 0,
        rating_sum: 0,
        rating_count: 0,
        featured: false,
        verified: false,
        min_tier: $min_tier,
        version_history: $version_history,
        forked_from: $forked_from,
        _content_hash: $_content_hash,
        created_at: time::now(),
        updated_at: time::now(),
        published_at: $published_at
    }`,
        variables: { ...args },
    };
}

/**
 * Look up a single app manifest by external app_id.
 */
export function getAppByAppId(app_id: string): QuerySpec {
    return {
        query: `SELECT * FROM smartchats_apps WHERE app_id = $app_id LIMIT 1`,
        variables: { app_id },
    };
}

/**
 * Whitelisted fields that `updateApp` accepts. Matches the in-app field
 * list verbatim; embedding is handled separately (callers pass it as a
 * sibling param so it's not required on every update).
 */
const EDITABLE_APP_FIELDS = [
    'name', 'version', 'description', 'author', 'icon', 'source',
    'categories', 'tags', 'modules', 'interaction_mode',
    'html_templates', 'display_mode', 'state_schema',
    'permissions', 'requested_functions', 'voice_hooks',
    'on_activate', 'on_deactivate', 'external_scripts', 'migrations',
    'min_tier', 'version_history', 'forked_from', 'published_at',
    '_content_hash',
] as const;

/**
 * Dynamic UPDATE for an app manifest. Accepts a partial patch and
 * an optional new embedding; only fields present in the patch (or
 * `embedding` if provided) are emitted in the SET clause.
 *
 * Returns `null` when the patch contains no settable fields and no
 * embedding is supplied — caller decides how to surface "nothing to
 * update". Always bumps `updated_at` when emitting a query.
 */
export function updateApp(args: {
    app_id: string;
    patch: Partial<Record<typeof EDITABLE_APP_FIELDS[number], unknown>>;
    embedding?: number[];
}): QuerySpec | null {
    const setClauses: string[] = ['updated_at = time::now()'];
    const variables: Record<string, unknown> = { app_id: args.app_id };

    for (const field of EDITABLE_APP_FIELDS) {
        if (field in args.patch) {
            setClauses.push(`${field} = $${field}`);
            variables[field] = args.patch[field];
        }
    }

    if (args.embedding) {
        setClauses.push('embedding = $embedding');
        variables.embedding = args.embedding;
    }

    if (setClauses.length === 1) return null;

    return {
        query: `UPDATE smartchats_apps SET ${setClauses.join(', ')} WHERE app_id = $app_id`,
        variables,
    };
}

/**
 * DELETE an app manifest by external app_id.
 */
export function deleteAppByAppId(app_id: string): QuerySpec {
    return {
        query: `DELETE FROM smartchats_apps WHERE app_id = $app_id`,
        variables: { app_id },
    };
}

/**
 * Vector-similarity search over published apps. Embedding is parameter-bound.
 * Returns full rows + a `score` field. `published_at != NONE` filter ensures
 * only published apps surface.
 */
export function searchApps(args: { embedding: number[]; limit: number }): QuerySpec {
    return {
        query: `SELECT *, vector::similarity::cosine(embedding, $emb) AS score
        FROM smartchats_apps
        WHERE published_at != NONE
        ORDER BY score DESC
        LIMIT $limit`,
        variables: { emb: args.embedding, limit: args.limit },
    };
}

/**
 * List apps with summary fields, optionally filtered by `source` and/or
 * `category` (matches via `$category IN categories`). Sort by
 * `updated_at DESC`.
 */
export function listApps(args: { source?: string; category?: string } = {}): QuerySpec {
    const conditions: string[] = [];
    const variables: Record<string, unknown> = {};

    if (args.source) {
        conditions.push('source = $source');
        variables.source = args.source;
    }
    if (args.category) {
        conditions.push('$category IN categories');
        variables.category = args.category;
    }

    // updated_at is included in the SELECT because SurrealDB's parser
    // requires the ORDER BY field to appear in the projection.
    let query = `SELECT app_id, name, description, icon, source, version, categories, tags, install_count, interaction_mode, updated_at
        FROM smartchats_apps`;
    if (conditions.length > 0) {
        query += ` WHERE ${conditions.join(' AND ')}`;
    }
    query += ` ORDER BY updated_at DESC`;

    return { query, variables };
}

/**
 * Atomically increment the `install_count` for an app. Used after a
 * successful install to track popularity.
 */
export function incrementAppInstallCount(app_id: string): QuerySpec {
    return {
        query: `UPDATE smartchats_apps SET install_count += 1 WHERE app_id = $app_id`,
        variables: { app_id },
    };
}

// ════════════════════════════════════════════════════════════════════════════
// smartchats_app_installs
// ════════════════════════════════════════════════════════════════════════════

export interface InsertInstallArgs {
    app_id: string;
    installed_version: string;
    granted_permissions: unknown;
    app_state: unknown;
    config: unknown;
    last_activated_at: unknown;
    activation_count: number;
}

/**
 * INSERT a new install record. `installed_at` and `updated_at` are
 * server-stamped on insert.
 */
export function insertInstall(args: InsertInstallArgs): QuerySpec {
    return {
        query: `INSERT INTO smartchats_app_installs {
        app_id: $app_id,
        installed_version: $installed_version,
        granted_permissions: $granted_permissions,
        app_state: $app_state,
        config: $config,
        last_activated_at: $last_activated_at,
        activation_count: $activation_count,
        installed_at: time::now(),
        updated_at: time::now()
    }`,
        variables: { ...args },
    };
}

/**
 * Look up the install record for a given app_id.
 */
export function getInstallByAppId(app_id: string): QuerySpec {
    return {
        query: `SELECT * FROM smartchats_app_installs WHERE app_id = $app_id LIMIT 1`,
        variables: { app_id },
    };
}

/**
 * Whitelisted fields that `updateInstall` accepts. Matches the in-app
 * list verbatim.
 */
const EDITABLE_INSTALL_FIELDS = [
    'installed_version', 'granted_permissions', 'app_state',
    'config', 'last_activated_at', 'activation_count',
] as const;

/**
 * Dynamic UPDATE for an install record. Returns `null` if the patch
 * contains no whitelisted fields. Always bumps `updated_at` when
 * emitting a query.
 */
export function updateInstall(args: {
    app_id: string;
    patch: Partial<Record<typeof EDITABLE_INSTALL_FIELDS[number], unknown>>;
}): QuerySpec | null {
    const setClauses: string[] = ['updated_at = time::now()'];
    const variables: Record<string, unknown> = { app_id: args.app_id };

    for (const field of EDITABLE_INSTALL_FIELDS) {
        if (field in args.patch) {
            setClauses.push(`${field} = $${field}`);
            variables[field] = args.patch[field];
        }
    }

    if (setClauses.length === 1) return null;

    return {
        query: `UPDATE smartchats_app_installs SET ${setClauses.join(', ')} WHERE app_id = $app_id`,
        variables,
    };
}

/**
 * DELETE the install record for a given app_id.
 */
export function deleteInstallByAppId(app_id: string): QuerySpec {
    return {
        query: `DELETE FROM smartchats_app_installs WHERE app_id = $app_id`,
        variables: { app_id },
    };
}

/**
 * List every install, sorted by most recently activated.
 */
export function listInstalls(): QuerySpec {
    return {
        query: `SELECT * FROM smartchats_app_installs ORDER BY last_activated_at DESC`,
        variables: {},
    };
}
