/**
 * Built-in Apps — registry and seeding.
 *
 * Each app lives in its own directory (e.g. ./counter/index.ts).
 * This file collects them and provides the seeding function
 * that ensures they exist in SurrealDB on startup.
 *
 * Seeding uses a content hash to detect changes — no manual version
 * bumps needed. If any field changes (HTML, functions, state_schema,
 * permissions, etc.), the app is re-seeded automatically.
 */

import type { AppManifest, AppPermission } from '../../core/types/app'
import { DEFAULT_GRANTS } from '../lib/permissions'
import { getApp, saveApp, updateApp, getInstall, saveInstall, updateInstall } from '../modules/app_registry'

// ── Import all built-in apps ──
import { counterApp } from './counter'
import { guidedBreathingApp } from './guided_breathing'
import { canaryApp } from './canary'
import { logExplorerApp } from './log_explorer'
import { metricsExplorerApp } from './metrics_explorer'
import { todoApp } from './todo'
import { kgExplorerApp } from './kg_explorer'

// ── Registry ──

export const BUILTIN_APPS: AppManifest[] = [
    counterApp,
    guidedBreathingApp,
    canaryApp,
    logExplorerApp,
    metricsExplorerApp,
    todoApp,
    kgExplorerApp,
]

// ── Content Hashing ──

/** Simple hash of manifest content for change detection. */
function hashManifest(manifest: AppManifest): string {
    const content = JSON.stringify({
        name: manifest.name,
        description: manifest.description,
        modules: manifest.modules,
        html_templates: manifest.html_templates,
        state_schema: manifest.state_schema,
        permissions: manifest.permissions,
        requested_functions: manifest.requested_functions,
        interaction_mode: manifest.interaction_mode,
        display_mode: manifest.display_mode,
        on_activate: manifest.on_activate,
        on_deactivate: manifest.on_deactivate,
        voice_hooks: manifest.voice_hooks,
        version: manifest.version,
        external_scripts: manifest.external_scripts,
    })
    // djb2 hash — fast, deterministic, good enough for change detection
    let hash = 5381
    for (let i = 0; i < content.length; i++) {
        hash = ((hash << 5) + hash + content.charCodeAt(i)) & 0xffffffff
    }
    return (hash >>> 0).toString(36)
}

// ── Seeding ──

const LOG_PREFIX = '[app-seeder]'

/**
 * Seed built-in apps into SurrealDB.
 * - Inserts new apps that don't exist yet.
 * - Updates existing apps if content has changed (detected via hash).
 * Safe to call multiple times.
 */
export async function seedBuiltinApps(getEmbedding: (text: string) => Promise<number[]>): Promise<{ seeded: string[]; updated: string[]; skipped: string[] }> {
    const seeded: string[] = []
    const updated: string[] = []
    const skipped: string[] = []

    for (const manifest of BUILTIN_APPS) {
        try {
            const existing = await getApp(manifest.id)
            const codeHash = hashManifest(manifest)

            if (existing) {
                // Compare content hash — update if anything changed
                const dbHash = (existing as any)._content_hash || ''
                if (dbHash === codeHash) {
                    console.log(`${LOG_PREFIX} ${manifest.id} v${manifest.version} — skipped (hash match: ${codeHash})`)
                    skipped.push(manifest.id)
                    continue
                }

                console.log(`${LOG_PREFIX} ${manifest.id} v${manifest.version} — updating (hash ${dbHash || 'none'} → ${codeHash})`)
                const embeddingText = `${manifest.name} ${manifest.description}`
                const embedding = await getEmbedding(embeddingText)
                await updateApp(manifest.id, {
                    ...manifest,
                    _content_hash: codeHash,
                    published_at: new Date().toISOString(),
                } as any, embedding)
                await updateInstall(manifest.id, { installed_version: manifest.version })
                updated.push(manifest.id)
            } else {
                console.log(`${LOG_PREFIX} ${manifest.id} v${manifest.version} — seeding new (hash: ${codeHash})`)
                const embeddingText = `${manifest.name} ${manifest.description}`
                const embedding = await getEmbedding(embeddingText)
                await saveApp({ ...manifest, _content_hash: codeHash, published_at: new Date().toISOString() } as any, embedding)

                const existingInstall = await getInstall(manifest.id)
                if (!existingInstall) {
                    await saveInstall({
                        app_id: manifest.id,
                        installed_version: manifest.version,
                        granted_permissions: DEFAULT_GRANTS.builtin as AppPermission[],
                        app_state: {},
                        config: {},
                        activation_count: 0,
                    })
                }
                seeded.push(manifest.id)
            }
        } catch (err) {
            console.error(`${LOG_PREFIX} ${manifest.id} — FAILED:`, err)
        }
    }

    console.log(`${LOG_PREFIX} done: seeded=${seeded.length} updated=${updated.length} skipped=${skipped.length}`)
    return { seeded, updated, skipped }
}
