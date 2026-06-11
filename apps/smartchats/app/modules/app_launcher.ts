/**
 * App Platform — App Launcher SCM Module
 *
 * Always-present module (position 6) that gives the agent the ability to
 * create, install, activate, deactivate, and manage mini-apps.
 *
 * When an app activates:
 *   - An AppSandbox is created (persistent iframe with bridge)
 *   - A proxy SCM module is added with agent-callable functions that route to the iframe
 *   - The agent gains the app's context and functions
 *
 * When an app deactivates:
 *   - The sandbox is destroyed
 *   - The proxy module is removed from the SCM
 */

import {
    saveApp, getApp, updateApp, deleteApp, searchApps,
    saveInstall, getInstall, updateInstall, deleteInstall,
    listInstalls, incrementInstallCount
} from "./app_registry"
import { DEFAULT_GRANTS, filterGrantedFunctions } from "../lib/permissions"
import { AppSandbox } from "../lib/app_sandbox"
import type { AppManifest, AppInstall, AppPermission, LoadedApp, SerializedAppFunction } from '../../core/types/app'
import { getBackend } from '@/lib/backend';

// ── Closure State ──
let activeApp: LoadedApp | null = null
let activeSandbox: AppSandbox | null = null
let installedApps: AppInstall[] = []

/** Hydrate the in-module installedApps cache from a resolved loader value.
 *  Called from the installed_apps loader's onResolve. Without this hook,
 *  the trailing `installed:` state in the agent's system context reports
 *  "none" on first turn and the LLM hedges on re-activation. */
export function hydrateAppLauncherInstalls(items: any[]): void {
    if (Array.isArray(items)) {
        installedApps = items.map((x: any) => x.install).filter(Boolean)
    }
}

// Exported for orchestrator input routing
export function getActiveSandbox(): AppSandbox | null {
    return activeSandbox
}

export function isAppInputRequested(): boolean {
    return activeSandbox?.isInputRequested() ?? false
}

function toSnakeCase(str: string): string {
    return str.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')
}

/**
 * Creates the App Launcher SCM module.
 *
 * @param scm - SystemContextManager reference for adding/removing app proxy modules
 * @param rebuildAgent - Callback to rebuild Cortex function dictionary after SCM changes
 */
export function createAppLauncherModule(
    scm: any,
    rebuildAgent: () => void
) {
    // ── Internal Helpers ──

    async function doDeactivate(ops: any): Promise<void> {
        if (!activeApp || !activeSandbox) return

        const appId = activeApp.manifest.id
        const isPreview = activeApp.preview === true

        // Persist app state from workspace (skip for preview apps)
        // Only save fields where state_schema declares persist !== false
        if (!isPreview) {
            const cortexWs = ops.util.get_workspace() || {}
            let storeWs: Record<string, any> = {}
            try {
                const { useSmartChatsStore } = require('../store/useSmartChatsStore')
                storeWs = useSmartChatsStore.getState().workspace || {}
            } catch { /* fallback to cortex only */ }
            const ws = { ...cortexWs, ...storeWs }
            const prefix = appId + '.'
            const schema = activeApp.manifest.state_schema || {}
            const appState: Record<string, any> = {}
            for (const [k, v] of Object.entries(ws)) {
                if (k.startsWith(prefix)) {
                    const fieldName = k.slice(prefix.length)
                    const fieldDef = schema[fieldName]
                    // Persist if: no schema entry (unknown field, keep it), or persist !== false
                    if (!fieldDef || fieldDef.persist !== false) {
                        appState[fieldName] = v
                    }
                }
            }
            await updateInstall(appId, { app_state: appState }).catch(() => {})
        }

        // Destroy sandbox
        activeSandbox.destroy()
        activeSandbox = null

        // Remove proxy module from SCM
        scm.remove_module(`app_${appId}_context`)
        rebuildAgent()

        const deactivatedId = appId
        activeApp = null

        ops.util.event({ type: 'app_deactivated', app_id: deactivatedId })
    }

    async function doActivateFromManifest(
        manifest: AppManifest,
        install: AppInstall,
        ops: any,
        options?: { preview?: boolean }
    ): Promise<string> {
        const appId = manifest.id
        const isPreview = options?.preview === true

        // Deactivate current app if one is active
        if (activeApp) {
            await doDeactivate(ops)
        }

        // Create sandbox with host handlers
        const sandbox = new AppSandbox(manifest, install, {
            onUtilCall: async (method: string, args: any) => {
                return await handleUtilCall(method, args, manifest, ops)
            },
            onLog: (msg: string) => ops.util.log(msg),
            onFeedback: (type: string) => {
                const sounds = (ops.util as any).sounds
                if (sounds && sounds[type]) sounds[type]()
            },
        })

        // Don't mount yet — the shell's AppContainer (in VisualizationWidget or mobile shell)
        // will call sandbox.mount(container) when it renders.
        activeSandbox = sandbox

        // Build proxy SCM module for agent-driven interaction
        const proxyFunctions = buildProxyFunctions(manifest, sandbox)
        const contextModule = {
            id: `app_${appId}_context`,
            name: `App: ${manifest.name}`,
            position: 60,
            system_msg: buildAppSystemMsg(manifest),
            functions: proxyFunctions,
        }
        scm.add_module(contextModule)
        rebuildAgent()

        // Initialize workspace with state_schema defaults (prefixed)
        if (manifest.state_schema) {
            const wsDefaults: Record<string, any> = {}
            for (const [key, field] of Object.entries(manifest.state_schema)) {
                const prefixedKey = `${appId}.${key}`
                const currentWs = ops.util.get_workspace()
                if (!(prefixedKey in currentWs)) {
                    wsDefaults[prefixedKey] = field.default
                }
            }
            if (Object.keys(wsDefaults).length > 0) {
                ops.util.update_workspace(wsDefaults)
            }
        }

        // Restore persisted state to workspace (skip for previews — no DB state)
        // Only restore fields where state_schema declares persist !== false
        if (!isPreview && install.app_state && Object.keys(install.app_state).length > 0) {
            const schema = manifest.state_schema || {}
            const restored: Record<string, any> = {}
            for (const [k, v] of Object.entries(install.app_state)) {
                const fieldDef = schema[k]
                if (!fieldDef || fieldDef.persist !== false) {
                    restored[`${appId}.${k}`] = v
                }
            }
            ops.util.update_workspace(restored)
        }

        // Update install record (skip for previews)
        if (!isPreview) {
            await updateInstall(appId, {
                last_activated_at: new Date().toISOString(),
                activation_count: (install.activation_count || 0) + 1,
            }).catch(() => {})
        }

        activeApp = { manifest, install, state: 'active', preview: isPreview }

        ops.util.event({ type: 'app_activated', manifest, install, sandbox })

        return `App "${manifest.name}" activated${isPreview ? ' (preview)' : ''}`
    }

    /**
     * Resolve a user/agent-provided identifier to a canonical installed app_id.
     * Tries exact match, then a normalized form (lowercase, whitespace/dashes
     * → underscores), then the manifest display name. Falls back to the input
     * so the caller can produce a specific "not installed" error with the
     * unresolved value.
     */
    async function resolveAppId(input: string): Promise<string> {
        const installs = await listInstalls()
        const ids = installs.map(i => i.app_id)
        if (ids.includes(input)) return input
        const normalized = input.toLowerCase().trim().replace(/[\s-]+/g, '_')
        if (ids.includes(normalized)) return normalized
        for (const inst of installs) {
            const m = await getApp(inst.app_id).catch(() => null)
            if (m?.name && m.name.toLowerCase() === input.toLowerCase()) return inst.app_id
        }
        return input
    }

    async function doActivate(appId: string, ops: any): Promise<string> {
        const resolved = await resolveAppId(appId)
        const install = await getInstall(resolved)
        if (!install) {
            const known = (await listInstalls()).map(i => i.app_id).join(', ') || 'none'
            throw new Error(`App '${appId}' is not installed. Installed: ${known}`)
        }
        const manifest = await getApp(resolved)
        if (!manifest) throw new Error(`App '${resolved}' not found in registry`)
        return await doActivateFromManifest(manifest, install, ops)
    }

    function buildManifestFromParams(params: any): AppManifest {
        const { name: appName, description, html, functions: fnDefs,
                state_schema, voice_hooks, tags, categories,
                permissions, requested_functions, interaction_mode } = params

        if (!appName || !description) throw new Error('name and description are required')

        const appId = toSnakeCase(appName)

        const serializedFns: SerializedAppFunction[] = (fnDefs || []).map((f: any) => ({
            name: f.name,
            description: f.description || '',
            parameters: f.parameters || null,
            return_type: f.return_type || 'any',
            code: f.code,
        }))

        return {
            id: appId,
            name: appName,
            version: '1.0.0',
            description,
            source: 'agent',
            categories: categories || [],
            tags: tags || [],
            modules: [{
                id: 'main',
                name: appName,
                position: 60,
                system_msg: description,
                functions: serializedFns,
            }],
            interaction_mode: interaction_mode || 'agent_driven',
            html_templates: html ? { main: html } : undefined,
            display_mode: 'panel',
            state_schema: state_schema || undefined,
            permissions: permissions || DEFAULT_GRANTS.agent as AppPermission[],
            requested_functions: requested_functions || [],
            voice_hooks: voice_hooks || undefined,
            version_history: [{ version: '1.0.0', published_at: new Date().toISOString() }],
        }
    }

    // ── Util Call Handler (proxies iframe Util calls to real platform) ──

    async function handleUtilCall(method: string, args: any, manifest: AppManifest, ops: any): Promise<any> {
        const appId = manifest.id

        if (method === 'update_workspace') {
            // Auto-prefix keys with app_id
            const prefixed: Record<string, any> = {}
            for (const [k, v] of Object.entries(args as Record<string, any>)) {
                prefixed[`${appId}.${k}`] = v
            }
            ops.util.update_workspace(prefixed)
            return { ok: true }
        }

        if (method === 'get_workspace') {
            const ws = ops.util.get_workspace()
            const prefix = appId + '.'
            const appState: Record<string, any> = {}
            for (const [k, v] of Object.entries(ws)) {
                if (k.startsWith(prefix)) {
                    appState[k.slice(prefix.length)] = v
                }
            }
            return appState
        }

        if (method === 'user_output') {
            ops.util.user_output(typeof args === 'string' ? args : args?.text || String(args))
            return { ok: true }
        }

        if (method === 'get_user_input') {
            // This is handled specially by AppSandbox — it sets inputRequested flag
            // and the orchestrator delivers input via deliverUserInput()
            return await ops.util.get_user_data()
        }

        if (method === 'call_llm') {
            // TODO: implement direct LLM call for apps
            // For now, use the agent's LLM infrastructure
            throw new Error('call_llm not yet implemented for apps')
        }

        if (method === 'get_embedding') {
            const text = typeof args === 'string' ? args : args?.text || String(args)
            return await ops.util.get_embedding(text)
        }

        if (method === 'query') {
            const { query, variables } = args || {}
            const response = await getBackend().data.query({ query, variables }) as any
            return response?.data?.result?.result || []
        }

        // SmartChats function proxy
        if (method.startsWith('smartchats.')) {
            const fnName = method.slice('smartchats.'.length)
            // Find the real cortex function from the built SCM
            const built = scm.build()
            const cortexFn = built.functions.find((f: any) => f.name === fnName)
            if (!cortexFn) throw new Error(`SmartChats function not found: ${fnName}`)
            return await cortexFn.fn({ params: args || {}, util: ops.util })
        }

        throw new Error(`Unknown util method: ${method}`)
    }

    // ── Proxy Function Builder ──

    function buildProxyFunctions(manifest: AppManifest, sandbox: AppSandbox): any[] {
        const proxyFns: any[] = []

        for (const mod of manifest.modules) {
            for (const fn of mod.functions || []) {
                proxyFns.push({
                    enabled: true,
                    name: `${manifest.id}_${fn.name}`,
                    description: fn.description,
                    parameters: fn.parameters,
                    return_type: fn.return_type || 'any',
                    fn: async (ops: any) => {
                        return await sandbox.callFunction(fn.name, ops.params)
                    }
                })
            }
        }

        return proxyFns
    }

    function buildAppSystemMsg(manifest: AppManifest): string {
        const mode = manifest.interaction_mode || 'agent_driven'

        // Use the module's system_msg if available (app-specific instructions), otherwise build from description
        const moduleMsg = manifest.modules?.[0]?.system_msg
        if (moduleMsg) {
            return moduleMsg
        }

        let msg = `[Active App: ${manifest.name}]\n${manifest.description}\n`

        if (mode === 'app_driven') {
            msg += `\nThis app manages its own interaction loop. It will handle user input directly.`
        } else {
            msg += `\nYou have access to this app's functions (prefixed with "${manifest.id}_"). Use them to interact with the app on behalf of the user.`
        }

        if (manifest.state_schema) {
            const keys = Object.keys(manifest.state_schema)
            msg += `\nApp state keys: ${keys.join(', ')}`
            msg += `\nAccess via ${manifest.id}_get_app_state / ${manifest.id}_set_app_state or the dedicated app functions.`
        }

        return msg
    }

    // ── The Module ──

    return {
        id: 'app_launcher',
        name: 'App Platform',
        position: 6,
        system_msg: `[App Platform]
You can manage mini-apps that extend your capabilities.
Use the app management functions to create, install, activate, or search for apps.
To iterate on an app without installing: preview_app → modify workspace.__preview_app → update_preview → repeat → save_preview when done.`,
        state: '',

        beforeBuild() {
            const appName = activeApp
                ? `${activeApp.manifest.name}${activeApp.preview ? ' (preview)' : ''}`
                : 'none'
            const appList = installedApps.length > 0
                ? installedApps.map(i => i.app_id).join(', ')
                : 'none'

            this.state = `active_app: ${appName}\ninstalled: ${appList}`
        },

        functions: [
            {
                enabled: true,
                description: 'List all installed apps with their summaries.',
                name: 'list_apps',
                parameters: null,
                fn: async (ops: any) => {
                    const { log } = ops.util
                    log('Listing installed apps')
                    const installs = await listInstalls()
                    installedApps = installs

                    const results = []
                    for (const inst of installs) {
                        const manifest = await getApp(inst.app_id).catch(() => null)
                        results.push({
                            app_id: inst.app_id,
                            name: manifest?.name || inst.app_id,
                            description: manifest?.description || '',
                            version: inst.installed_version,
                            activation_count: inst.activation_count,
                            is_active: activeApp?.manifest.id === inst.app_id,
                        })
                    }
                    return results
                },
                return_type: 'array',
            },

            {
                enabled: true,
                description: 'Search for apps in the registry by natural language query. Returns matching apps with relevance scores.',
                name: 'search_apps',
                parameters: { query: 'string' },
                fn: async (ops: any) => {
                    const { query } = ops.params
                    const { log, get_embedding } = ops.util
                    log(`Searching apps: ${query}`)
                    const embedding = await get_embedding(query)
                    const results = await searchApps(embedding, 10)
                    return results.map((r: any) => ({
                        id: r.id,
                        name: r.name,
                        description: r.description,
                        icon: r.icon,
                        source: r.source,
                        score: r.score,
                    }))
                },
                return_type: 'array',
            },

            {
                enabled: true,
                description: 'Activate an installed app. Loads its UI, functions, and context into the agent. Only one app can be active at a time.',
                name: 'activate_app',
                parameters: { app_id: 'string' },
                fn: async (ops: any) => {
                    const { app_id } = ops.params
                    const { log } = ops.util
                    log(`Activating app: ${app_id}`)
                    return await doActivate(app_id, ops)
                },
                return_type: 'string',
            },

            {
                enabled: true,
                description: 'Deactivate the currently active app. Persists its state and removes it from the agent context.',
                name: 'deactivate_app',
                parameters: null,
                fn: async (ops: any) => {
                    const { log } = ops.util
                    if (!activeApp) return 'No app is currently active'
                    const name = activeApp.manifest.name
                    log(`Deactivating app: ${name}`)
                    await doDeactivate(ops)
                    return `App "${name}" deactivated`
                },
                return_type: 'string',
            },

            {
                enabled: true,
                description: 'Install an app from the registry. Does not activate it.',
                name: 'install_app',
                parameters: { app_id: 'string' },
                fn: async (ops: any) => {
                    const { app_id } = ops.params
                    const { log } = ops.util
                    log(`Installing app: ${app_id}`)

                    const manifest = await getApp(app_id)
                    if (!manifest) throw new Error(`App '${app_id}' not found in registry`)

                    const existing = await getInstall(app_id)
                    if (existing) return `App '${app_id}' is already installed`

                    const grantedPerms = DEFAULT_GRANTS[manifest.source] || DEFAULT_GRANTS.community
                    const install = await saveInstall({
                        app_id,
                        installed_version: manifest.version,
                        granted_permissions: grantedPerms as AppPermission[],
                        app_state: {},
                        config: {},
                        activation_count: 0,
                    })

                    await incrementInstallCount(app_id).catch(() => {})
                    installedApps.push(install)

                    ops.util.event({ type: 'app_installed', manifest, install })
                    return `App "${manifest.name}" installed`
                },
                return_type: 'string',
            },

            {
                enabled: true,
                description: 'Uninstall an app. Deactivates it first if active, then removes the install record.',
                name: 'uninstall_app',
                parameters: { app_id: 'string' },
                fn: async (ops: any) => {
                    const { app_id } = ops.params
                    const { log } = ops.util
                    log(`Uninstalling app: ${app_id}`)

                    if (activeApp?.manifest.id === app_id) {
                        await doDeactivate(ops)
                    }

                    await deleteInstall(app_id)
                    installedApps = installedApps.filter(i => i.app_id !== app_id)

                    ops.util.event({ type: 'app_uninstalled', app_id })
                    return `App '${app_id}' uninstalled`
                },
                return_type: 'string',
            },

            {
                enabled: true,
                description: `Create a new mini-app, save to registry, install, and activate. Function signature: (fnArgs, app, util). app = { dom, state, fns, manifest, el(selector) }. util = { smartchats, user_output, get_user_input, update_workspace, get_workspace, log, feedback }. The html parameter is the app's iframe HTML template.`,
                name: 'create_app',
                parameters: {
                    name: 'string',
                    description: 'string',
                    html: 'string',
                    functions: 'array',
                    state_schema: 'object',
                    voice_hooks: 'object',
                    tags: 'array',
                    categories: 'array',
                    permissions: 'array',
                    requested_functions: 'array',
                    interaction_mode: 'string',
                },
                fn: async (ops: any) => {
                    const { log, get_embedding } = ops.util
                    const manifest = buildManifestFromParams(ops.params)
                    const appId = manifest.id
                    log(`Creating app: ${manifest.name} (${appId})`)

                    // Compute embedding
                    const embeddingText = `${manifest.name} ${manifest.description}`
                    const embedding = await get_embedding(embeddingText)

                    // Save to registry
                    await saveApp(manifest, embedding)

                    // Create install record
                    const grantedPerms = DEFAULT_GRANTS.agent as AppPermission[]
                    const install = await saveInstall({
                        app_id: appId,
                        installed_version: '1.0.0',
                        granted_permissions: grantedPerms,
                        app_state: {},
                        config: {},
                        activation_count: 0,
                    })

                    installedApps.push(install)
                    ops.util.event({ type: 'app_installed', manifest, install })

                    // Activate immediately
                    await doActivate(appId, ops)

                    return {
                        app_id: appId,
                        name: manifest.name,
                        message: `App "${manifest.name}" created and activated`,
                    }
                },
                return_type: 'object',
            },

            {
                enabled: true,
                description: 'Update an existing app. Can modify HTML, state_schema, description, or functions. Bumps the version and hot-reloads if the app is currently active.',
                name: 'update_app',
                parameters: {
                    app_id: 'string',
                    html: 'string',
                    description: 'string',
                    state_schema: 'object',
                    functions: 'array',
                },
                fn: async (ops: any) => {
                    const { app_id, html, description, state_schema, functions: fnDefs } = ops.params
                    const { log, get_embedding } = ops.util
                    log(`Updating app: ${app_id}`)

                    const existing = await getApp(app_id)
                    if (!existing) throw new Error(`App '${app_id}' not found`)

                    const patch: Partial<AppManifest> = {}

                    if (html !== undefined) {
                        patch.html_templates = { ...existing.html_templates, main: html }
                    }
                    if (description !== undefined) {
                        patch.description = description
                    }
                    if (state_schema !== undefined) {
                        patch.state_schema = state_schema
                    }
                    if (fnDefs !== undefined) {
                        const serializedFns = (fnDefs || []).map((f: any) => ({
                            name: f.name,
                            description: f.description || '',
                            parameters: f.parameters || null,
                            return_type: f.return_type || 'any',
                            code: f.code,
                        }))
                        patch.modules = existing.modules.map((m: any, i: number) =>
                            i === 0 ? { ...m, functions: serializedFns } : m
                        )
                    }

                    // Bump version
                    const parts = existing.version.split('.').map(Number)
                    parts[2] = (parts[2] || 0) + 1
                    patch.version = parts.join('.')
                    patch.version_history = [
                        ...(existing.version_history || []),
                        { version: patch.version, published_at: new Date().toISOString() }
                    ]

                    // Recompute embedding if description changed
                    let embedding: number[] | undefined
                    if (description) {
                        embedding = await get_embedding(`${existing.name} ${description}`)
                    }

                    await updateApp(app_id, patch, embedding)

                    const updated = { ...existing, ...patch }
                    ops.util.event({ type: 'app_updated', manifest: updated })

                    // Hot reload if active
                    if (activeApp?.manifest.id === app_id) {
                        log('Hot reloading active app...')
                        await doDeactivate(ops)
                        await doActivate(app_id, ops)
                    }

                    return { app_id, version: patch.version, message: `App updated to v${patch.version}` }
                },
                return_type: 'object',
            },

            // ── Preview App System ──

            {
                enabled: true,
                description: `Preview an app without installing it. Use update_preview to iterate and save_preview to promote.`,
                name: 'preview_app',
                parameters: {
                    name: 'string',
                    description: 'string',
                    html: 'string',
                    functions: 'array',
                    state_schema: 'object',
                    tags: 'array',
                    categories: 'array',
                    permissions: 'array',
                    requested_functions: 'array',
                    interaction_mode: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util
                    const manifest = buildManifestFromParams(ops.params)
                    log(`Preview app: ${manifest.name} (${manifest.id})`)

                    // Store manifest definition in workspace for agent iteration
                    ops.util.update_workspace({ __preview_app: ops.params })

                    // Synthetic install with full permissions for development
                    const install: AppInstall = {
                        app_id: manifest.id,
                        installed_version: manifest.version,
                        granted_permissions: DEFAULT_GRANTS.builtin as AppPermission[],
                        app_state: {},
                        config: {},
                        activation_count: 0,
                    }

                    await doActivateFromManifest(manifest, install, ops, { preview: true })

                    return {
                        app_id: manifest.id,
                        name: manifest.name,
                        message: `Preview "${manifest.name}" loaded. Modify workspace.__preview_app and call update_preview to iterate. Call save_preview to install permanently.`,
                    }
                },
                return_type: 'object',
            },

            {
                enabled: true,
                description: `Hot-reload the current preview app with an updated definition.`,
                name: 'update_preview',
                parameters: {
                    name: 'string',
                    description: 'string',
                    html: 'string',
                    functions: 'array',
                    state_schema: 'object',
                    tags: 'array',
                    categories: 'array',
                    permissions: 'array',
                    requested_functions: 'array',
                    interaction_mode: 'string',
                },
                fn: async (ops: any) => {
                    const { log } = ops.util

                    if (!activeApp?.preview) {
                        throw new Error('No preview app is active. Call preview_app first.')
                    }

                    const manifest = buildManifestFromParams(ops.params)
                    log(`Updating preview: ${manifest.name}`)

                    // Update workspace definition
                    ops.util.update_workspace({ __preview_app: ops.params })

                    // Synthetic install with full permissions
                    const install: AppInstall = {
                        app_id: manifest.id,
                        installed_version: manifest.version,
                        granted_permissions: DEFAULT_GRANTS.builtin as AppPermission[],
                        app_state: {},
                        config: {},
                        activation_count: 0,
                    }

                    // Deactivate + re-activate with new definition
                    await doActivateFromManifest(manifest, install, ops, { preview: true })

                    return {
                        app_id: manifest.id,
                        name: manifest.name,
                        message: `Preview "${manifest.name}" updated and reloaded.`,
                    }
                },
                return_type: 'object',
            },

            {
                enabled: true,
                description: 'Promote the current preview app to a permanent installed app. Saves the manifest to the database, creates an install record, and clears the preview flag. The app stays active.',
                name: 'save_preview',
                parameters: null,
                fn: async (ops: any) => {
                    const { log, get_embedding } = ops.util

                    if (!activeApp?.preview) {
                        throw new Error('No preview app is active. Nothing to save.')
                    }

                    const manifest = activeApp.manifest
                    const appId = manifest.id
                    log(`Saving preview as installed app: ${manifest.name} (${appId})`)

                    // Compute embedding
                    const embeddingText = `${manifest.name} ${manifest.description}`
                    const embedding = await get_embedding(embeddingText)

                    // Save to registry (upsert)
                    const existing = await getApp(appId).catch(() => null)
                    if (existing) {
                        await updateApp(appId, { ...manifest, published_at: new Date().toISOString() }, embedding)
                    } else {
                        await saveApp({ ...manifest, published_at: new Date().toISOString() }, embedding)
                    }

                    // Create or update install record
                    const existingInstall = await getInstall(appId).catch(() => null)
                    const grantedPerms = DEFAULT_GRANTS.agent as AppPermission[]
                    if (existingInstall) {
                        await updateInstall(appId, { installed_version: manifest.version })
                    } else {
                        const install = await saveInstall({
                            app_id: appId,
                            installed_version: manifest.version,
                            granted_permissions: grantedPerms,
                            app_state: {},
                            config: {},
                            activation_count: 1,
                        })
                        installedApps.push(install)
                    }

                    // Clear preview flag — app is now a real installed app
                    activeApp.preview = false

                    // Clean up workspace preview key
                    ops.util.update_workspace({ __preview_app: null })

                    ops.util.event({ type: 'app_installed', manifest, install: activeApp.install })

                    return {
                        app_id: appId,
                        name: manifest.name,
                        message: `Preview "${manifest.name}" saved as installed app.`,
                    }
                },
                return_type: 'object',
            },

            {
                enabled: true,
                description: 'Read from the active app\'s state. Pass a key to read one value, or omit key to get the full state object. Reads directly from the app\'s iframe.',
                name: 'get_app_state',
                parameters: { key: 'string' },
                fn: async (ops: any) => {
                    const { key } = ops.params
                    if (!activeApp) throw new Error('No app is currently active')
                    if (activeSandbox) {
                        try {
                            return await activeSandbox.callFunction('__get_state', { key: key || null })
                        } catch {
                            // Fallback to workspace
                        }
                    }
                    if (!key) {
                        const ws = ops.util.get_workspace()
                        const prefix = activeApp.manifest.id + '.'
                        const state: Record<string, any> = {}
                        for (const [k, v] of Object.entries(ws)) {
                            if (k.startsWith(prefix)) state[k.slice(prefix.length)] = v
                        }
                        return state
                    }
                    return ops.util.get_workspace()[`${activeApp.manifest.id}.${key}`]
                },
                return_type: 'any',
            },

            {
                enabled: true,
                description: 'Write a value to the active app\'s state. Keys are automatically scoped to the app.',
                name: 'set_app_state',
                parameters: { key: 'string', value: 'any' },
                fn: async (ops: any) => {
                    const { key, value } = ops.params
                    if (!activeApp) throw new Error('No app is currently active')
                    ops.util.update_workspace({ [`${activeApp.manifest.id}.${key}`]: value })

                    // Also sync to app sandbox
                    if (activeSandbox) {
                        activeSandbox.syncWorkspace({ [key]: value })
                    }

                    return { ok: true }
                },
                return_type: 'object',
            },
        ],
    }
}
