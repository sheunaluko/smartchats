/**
 * App Platform — Registry (SurrealDB CRUD)
 *
 * Stateless functions for persisting app manifests and install records.
 * Follows the same pattern as dynamic_function_mgmt.ts.
 */

import type { AppManifest, AppInstall } from '../../core/types/app'
import { getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';

// ── Normalization ──
// SurrealDB stores 'app_id' as the field name (since 'id' is reserved for the record ID).
// The AppManifest type uses 'id'. Normalize after every read.
function normalizeApp(row: any): any {
    if (row && row.app_id) row.id = row.app_id
    return row
}

// ═══════════════════════════════════════════════
// App Definitions (smartchats_apps table)
// ═══════════════════════════════════════════════

export async function saveApp(manifest: AppManifest, embedding: number[]): Promise<AppManifest> {
    const response = await getBackend().data.query(queries.insertApp({
        app_id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        description: manifest.description,
        author: manifest.author || null,
        icon: manifest.icon || null,
        source: manifest.source,
        categories: manifest.categories || [],
        tags: manifest.tags || [],
        embedding,
        modules: manifest.modules,
        interaction_mode: manifest.interaction_mode || 'agent_driven',
        html_templates: manifest.html_templates || null,
        display_mode: manifest.display_mode || 'panel',
        state_schema: manifest.state_schema || null,
        permissions: manifest.permissions,
        requested_functions: manifest.requested_functions || [],
        voice_hooks: manifest.voice_hooks || null,
        on_activate: manifest.on_activate || null,
        on_deactivate: manifest.on_deactivate || null,
        external_scripts: manifest.external_scripts || null,
        migrations: manifest.migrations || null,
        min_tier: manifest.min_tier || 'free',
        version_history: manifest.version_history || [{ version: manifest.version, published_at: new Date().toISOString() }],
        forked_from: manifest.forked_from || null,
        _content_hash: (manifest as any)._content_hash || null,
        published_at: manifest.published_at || null,
    })) as any
    const rows = response.rows
    return rows[0] ? normalizeApp(rows[0]) : manifest
}

export async function getApp(appId: string): Promise<AppManifest | null> {
    const response = await getBackend().data.query(queries.getAppByAppId(appId)) as any
    const rows = response.rows
    return rows.length > 0 ? normalizeApp(rows[0]) : null
}

export async function updateApp(
    appId: string,
    patch: Partial<AppManifest>,
    embedding?: number[]
): Promise<void> {
    const spec = queries.updateApp({
        app_id: appId,
        patch: patch as any,
        embedding,
    })
    if (!spec) return
    await getBackend().data.query(spec)
}

export async function deleteApp(appId: string): Promise<void> {
    await getBackend().data.query(queries.deleteAppByAppId(appId))
}

export async function searchApps(queryEmbedding: number[], limit: number = 10): Promise<AppManifest[]> {
    const response = await getBackend().data.query(queries.searchApps({ embedding: queryEmbedding, limit })) as any
    return response.rows.map(normalizeApp)
}

export async function listApps(options?: { source?: string; category?: string }): Promise<AppManifest[]> {
    const response = await getBackend().data.query(queries.listApps(options)) as any
    return response.rows.map(normalizeApp)
}


// ═══════════════════════════════════════════════
// App Installs (smartchats_app_installs table)
// ═══════════════════════════════════════════════

export async function saveInstall(install: AppInstall): Promise<AppInstall> {
    const response = await getBackend().data.query(queries.insertInstall({
        app_id: install.app_id,
        installed_version: install.installed_version,
        granted_permissions: install.granted_permissions,
        app_state: install.app_state || {},
        config: install.config || {},
        last_activated_at: install.last_activated_at || null,
        activation_count: install.activation_count || 0,
    })) as any
    const rows = response.rows
    return rows[0] || install
}

export async function getInstall(appId: string): Promise<AppInstall | null> {
    const response = await getBackend().data.query(queries.getInstallByAppId(appId)) as any
    const rows = response.rows
    return rows.length > 0 ? rows[0] : null
}

export async function updateInstall(appId: string, patch: Partial<AppInstall>): Promise<void> {
    const spec = queries.updateInstall({ app_id: appId, patch: patch as any })
    if (!spec) return
    await getBackend().data.query(spec)
}

export async function deleteInstall(appId: string): Promise<void> {
    await getBackend().data.query(queries.deleteInstallByAppId(appId))
}

export async function listInstalls(): Promise<AppInstall[]> {
    const response = await getBackend().data.query(queries.listInstalls()) as any
    return response.rows
}

export async function incrementInstallCount(appId: string): Promise<void> {
    await getBackend().data.query(queries.incrementAppInstallCount(appId))
}
