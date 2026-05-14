/**
 * App Platform — AppSandbox
 *
 * Manages a persistent app iframe with bidirectional postMessage communication.
 * The iframe IS the app runtime — all app code, UI, and state live inside it.
 * The sandbox enforces permissions and proxies Util calls to the host.
 */

import { getAppBridgeSource } from './app_bridge'
import { buildGrantedUtilMethods, filterGrantedFunctions, UTIL_TO_PERMISSION } from './permissions'
import { themeTokensToCss } from '../../core/DesignPackBridge'
import type { AppManifest, AppInstall, AppPermission } from '../../core/types/app'

export interface AppSandboxHostHandlers {
    onUtilCall: (method: string, args: any) => Promise<any>
    onLog: (msg: string) => void
    onFeedback: (type: string) => void
}

export class AppSandbox {
    private iframe: HTMLIFrameElement | null = null
    private pendingCalls: Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }> = new Map()
    private callId = 0
    private messageHandler: ((event: MessageEvent) => void) | null = null
    private grantedPermissions: AppPermission[]
    private grantedFunctions: string[]
    private grantedUtilMethods: string[]
    private manifest: AppManifest
    private install: AppInstall
    private hostHandlers: AppSandboxHostHandlers
    private themeHandler: ((e: Event) => void) | null = null
    private inputRequested = false
    private mounted = false
    private lastState: Record<string, any> | null = null

    constructor(
        manifest: AppManifest,
        install: AppInstall,
        hostHandlers: AppSandboxHostHandlers
    ) {
        this.manifest = manifest
        this.install = install
        this.grantedPermissions = install.granted_permissions
        this.grantedFunctions = filterGrantedFunctions(
            manifest.requested_functions || [],
            install.granted_permissions
        )
        this.grantedUtilMethods = buildGrantedUtilMethods(install.granted_permissions)
        this.hostHandlers = hostHandlers
    }

    // ── Lifecycle ──

    async mount(container?: HTMLElement): Promise<void> {
        // If iframe was removed from DOM (e.g. fullscreen toggle), allow remount
        if (this.mounted && this.iframe && !this.iframe.isConnected) {
            if (this.messageHandler) window.removeEventListener('message', this.messageHandler)
            if (this.themeHandler) window.removeEventListener('smartchats:theme_change', this.themeHandler)
            this.iframe = null
            this.mounted = false
        }
        if (this.mounted) return

        // Create iframe
        this.iframe = document.createElement('iframe')
        this.iframe.sandbox.add('allow-scripts')
        this.iframe.sandbox.add('allow-modals')
        this.iframe.style.cssText = 'width:100%;height:100%;border:none;'
        this.iframe.setAttribute('data-app-id', this.manifest.id)

        // Build and set srcdoc
        this.iframe.srcdoc = this.buildSrcdoc()

        // Listen for messages from iframe
        this.messageHandler = this.handleMessage.bind(this)
        window.addEventListener('message', this.messageHandler)

        // Wait for bridge ready, then send init config
        const initPromise = new Promise<void>((resolve) => {
            const onReady = (e: MessageEvent) => {
                if (e.data?.type === 'app_bridge_ready' && e.source === this.iframe?.contentWindow) {
                    window.removeEventListener('message', onReady)
                    this.sendInit()
                    resolve()
                }
            }
            window.addEventListener('message', onReady)
        })

        // Append to container (or a hidden div if no container)
        if (container) {
            container.appendChild(this.iframe)
        } else {
            const hidden = document.createElement('div')
            hidden.style.cssText = 'position:fixed;width:0;height:0;overflow:hidden;pointer-events:none;'
            hidden.appendChild(this.iframe)
            document.body.appendChild(hidden)
        }

        // Listen for theme changes and push to iframe
        this.themeHandler = (e: Event) => {
            const tokens = (e as CustomEvent).detail?.tokens
            if (tokens && this.iframe?.contentWindow) {
                this.iframe.contentWindow.postMessage({ type: 'theme_update', tokens }, '*')
            }
        }
        window.addEventListener('smartchats:theme_change', this.themeHandler)

        this.mounted = true
        await initPromise
    }

    /** Snapshot the full app.state from the iframe. Call before unmounting the container. */
    async snapshotState(): Promise<Record<string, any> | null> {
        try {
            const state = await this.callFunction('__get_state', {})
            this.lastState = state
            return state
        } catch {
            return this.lastState
        }
    }

    destroy(): void {
        if (this.themeHandler) {
            window.removeEventListener('smartchats:theme_change', this.themeHandler)
            this.themeHandler = null
        }
        if (this.messageHandler) {
            window.removeEventListener('message', this.messageHandler)
            this.messageHandler = null
        }

        // Reject any pending calls
        for (const [, pending] of this.pendingCalls) {
            pending.reject(new Error('App sandbox destroyed'))
        }
        this.pendingCalls.clear()

        // Remove iframe
        if (this.iframe) {
            this.iframe.parentElement?.removeChild(this.iframe)
            this.iframe = null
        }

        this.mounted = false
        this.lastState = null
    }

    getIframe(): HTMLIFrameElement | null {
        return this.iframe
    }

    // ── Host → Iframe ──

    async callFunction(name: string, args: any): Promise<any> {
        if (!this.iframe?.contentWindow) {
            throw new Error('App sandbox not mounted')
        }

        const callId = ++this.callId
        return new Promise((resolve, reject) => {
            this.pendingCalls.set(callId, { resolve, reject })

            // Timeout after 30s
            setTimeout(() => {
                if (this.pendingCalls.has(callId)) {
                    this.pendingCalls.delete(callId)
                    reject(new Error(`App function '${name}' timed out`))
                }
            }, 30000)

            this.iframe!.contentWindow!.postMessage({
                type: 'call_function',
                name,
                args: args || {},
                callId
            }, '*')
        })
    }

    deliverUserInput(text: string): void {
        if (!this.iframe?.contentWindow) return
        this.iframe.contentWindow.postMessage({ type: 'user_input', text }, '*')
        this.inputRequested = false
    }

    syncWorkspace(state: Record<string, any>): void {
        if (!this.iframe?.contentWindow) return
        this.iframe.contentWindow.postMessage({ type: 'workspace_sync', state }, '*')
    }

    isInputRequested(): boolean {
        return this.inputRequested
    }

    // ── Iframe → Host (message handler) ──

    private handleMessage(event: MessageEvent): void {
        // Only accept messages from our iframe
        if (!this.iframe || event.source !== this.iframe.contentWindow) return

        const msg = event.data
        if (!msg || !msg.type) return

        switch (msg.type) {
            case 'app_util_call':
                this.handleUtilCall(msg.method, msg.args, msg.callId)
                break

            case 'app_function_result': {
                const pending = this.pendingCalls.get(msg.callId)
                if (pending) {
                    pending.resolve(msg.result)
                    this.pendingCalls.delete(msg.callId)
                }
                break
            }

            case 'app_function_error': {
                const pending = this.pendingCalls.get(msg.callId)
                if (pending) {
                    pending.reject(new Error(msg.error || 'App function error'))
                    this.pendingCalls.delete(msg.callId)
                }
                break
            }

            case 'app_log':
                this.hostHandlers.onLog(`[app:${this.manifest.id}] ${msg.message}`)
                break

            case 'app_feedback':
                this.hostHandlers.onFeedback(msg.feedbackType)
                break
        }
    }

    private async handleUtilCall(method: string, args: any, callId: number): Promise<void> {
        if (!this.iframe?.contentWindow) return

        // Special case: get_user_input sets a flag for the orchestrator
        if (method === 'get_user_input') {
            // Check permission
            const requiredPerm = UTIL_TO_PERMISSION[method]
            if (requiredPerm && !this.grantedPermissions.includes(requiredPerm)) {
                this.respondError(callId, `Permission denied: ${method} requires ${requiredPerm}`)
                return
            }
            this.inputRequested = true
            // Don't respond yet — response comes when deliverUserInput() is called
            return
        }

        // Check if method is granted (for non-tier-0 methods)
        const requiredPerm = UTIL_TO_PERMISSION[method.startsWith('smartchats.') ? method : method]
        if (method.startsWith('smartchats.')) {
            // Check function-level grant
            const fnName = method.slice('smartchats.'.length)
            if (!this.grantedFunctions.includes(fnName)) {
                this.respondError(callId, `Permission denied: function '${fnName}' not granted`)
                return
            }
        } else if (requiredPerm && !this.grantedPermissions.includes(requiredPerm)) {
            this.respondError(callId, `Permission denied: ${method} requires ${requiredPerm}`)
            return
        }

        try {
            const result = await this.hostHandlers.onUtilCall(method, args)
            this.respond(callId, result)
        } catch (err: any) {
            this.respondError(callId, err.message || String(err))
        }
    }

    private respond(callId: number, result: any): void {
        if (!this.iframe?.contentWindow) return
        this.iframe.contentWindow.postMessage({ type: 'util_result', callId, result }, '*')
    }

    private respondError(callId: number, error: string): void {
        if (!this.iframe?.contentWindow) return
        this.iframe.contentWindow.postMessage({ type: 'util_error', callId, error }, '*')
    }

    // ── Init ──

    private sendInit(): void {
        if (!this.iframe?.contentWindow) return

        // Build initial state from state_schema defaults
        const initialState: Record<string, any> = {}
        if (this.manifest.state_schema) {
            for (const [key, field] of Object.entries(this.manifest.state_schema)) {
                initialState[key] = field.default
            }
        }
        // Merge persisted app state from install record
        if (this.install.app_state) {
            Object.assign(initialState, this.install.app_state)
        }
        // Restore from snapshot if available (e.g. after fullscreen remount)
        if (this.lastState) {
            Object.assign(initialState, this.lastState)
        }

        this.iframe.contentWindow.postMessage({
            type: 'app_init',
            config: {
                manifest: {
                    id: this.manifest.id,
                    name: this.manifest.name,
                    version: this.manifest.version,
                    description: this.manifest.description,
                    icon: this.manifest.icon,
                    interaction_mode: this.manifest.interaction_mode || 'agent_driven',
                },
                initialState,
                grantedUtilMethods: this.grantedUtilMethods,
                grantedFunctions: this.grantedFunctions,
                onActivate: this.manifest.on_activate || null,
            }
        }, '*')
    }

    // ── Srcdoc Construction ──

    /**
     * Resolve a manifest-declared script URL to an absolute URL.
     *
     * Same-origin paths (starting with `/`) are common in self-hosted setups
     * — e.g. `/lib/graphology.umd.min.js` served from the Next.js public dir.
     * The iframe is `srcdoc`, which creates an opaque origin; relative URLs
     * resolve against `about:srcdoc`, NOT the parent. So we explicitly
     * absolutize same-origin paths against the parent's `window.location.origin`.
     */
    private resolveScriptUrl(url: string): string | null {
        const absolute = url.startsWith('/') && typeof window !== 'undefined'
            ? `${window.location.origin}${url}`
            : url
        try { new URL(absolute); return absolute } catch { return null }
    }

    /**
     * Build a CSP meta tag that restricts external script loading.
     * - Apps with no `external_scripts` → only inline scripts allowed
     * - Apps with declared scripts → only those exact URLs + inline allowed
     * Browser-enforced — cannot be bypassed from inside the iframe.
     */
    private buildCspMeta(): string {
        const scripts = this.manifest.external_scripts || []
        if (scripts.length === 0) {
            return `<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline';">`
        }
        const sources = scripts.map(url => this.resolveScriptUrl(url)).filter(Boolean).join(' ')
        return `<meta http-equiv="Content-Security-Policy" content="script-src 'unsafe-inline' ${sources};">`
    }

    /**
     * Build `<script src="...">` tags for declared external scripts.
     * Auto-injected so apps don't need manual script tags in HTML templates.
     */
    private buildExternalScriptTags(): string {
        const scripts = this.manifest.external_scripts || []
        return scripts
            .map(url => this.resolveScriptUrl(url))
            .filter((url): url is string => !!url)
            .map(url => `<script src="${url}"><\/script>`)
            .join('\n')
    }

    private buildSrcdoc(): string {
        const bridgeSource = getAppBridgeSource()

        // Snapshot current theme tokens for initial render (no flash)
        let themeCss = ''
        try {
            const style = getComputedStyle(document.documentElement)
            const tokens: Record<string, string> = {}
            // Read all --sc-* properties from the live DOM
            for (const prop of Array.from(document.documentElement.style)) {
                if (prop.startsWith('--sc-')) {
                    tokens[prop] = style.getPropertyValue(prop).trim()
                }
            }
            if (Object.keys(tokens).length > 0) {
                themeCss = themeTokensToCss(tokens)
            }
        } catch { /* fallback to app defaults */ }

        // Collect all function registration statements from modules
        const fnRegistrations = this.manifest.modules
            .flatMap(m => (m.functions || []).map(f =>
                `SmartChats.registerFunction(${JSON.stringify(f.name)}, ${f.code});`
            ))
            .join('\n')

        const appHtml = this.manifest.html_templates?.main || ''
        const cspMeta = this.buildCspMeta()
        const externalScripts = this.buildExternalScriptTags()

        return `<!DOCTYPE html>
<html><head>
${cspMeta}
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
${themeCss}
  * { margin: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }
  body { font-family: var(--sc-font-sans, -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif);
         background: var(--sc-background, #0d1117); color: var(--sc-text, #e6edf3); }
</style>
${externalScripts}
</head><body>

<script>${bridgeSource}</script>

${appHtml}

<script>
${fnRegistrations}
</script>

</body></html>`
    }
}
