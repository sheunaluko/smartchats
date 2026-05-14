/**
 * App-local backend facade.
 *
 * Every open-core UI/component consumes the SmartChatsBackend through this
 * module — never by importing provider classes directly. The only place a
 * concrete backend class is constructed is the app bootstrap; the closed
 * production wrapper replaces that bootstrap with one that injects the
 * closed-source backend variant.
 *
 * This facade exposes:
 *   - `BackendFacadeProvider` — React context provider taking a `SmartChatsBackend`
 *   - `useBackend()` — hook returning the injected backend
 *   - `getBackendInstance()` — non-hook accessor for outside-React call sites
 */

'use client'

import { createContext, createElement, useContext, type ReactNode } from 'react'
import type { SmartChatsBackend } from 'smartchats-backend'

const BackendContext = createContext<SmartChatsBackend | null>(null)

// Module-level singleton for non-hook call sites (HTTP clients, vendor shims).
// Populated by BackendFacadeProvider on mount; accessed via getBackendInstance().
let _backend: SmartChatsBackend | null = null

export function getBackendInstance(): SmartChatsBackend {
    if (!_backend) throw new Error('SmartChatsBackend not initialized — BackendFacadeProvider must mount before getBackendInstance() is called')
    return _backend
}

export interface BackendFacadeProviderProps {
    backend: SmartChatsBackend
    children: ReactNode
}

export function BackendFacadeProvider({ backend, children }: BackendFacadeProviderProps) {
    _backend = backend
    return createElement(BackendContext.Provider, { value: backend }, children)
}

export function useBackend(): SmartChatsBackend {
    const ctx = useContext(BackendContext)
    if (!ctx) throw new Error('useBackend must be used inside <BackendFacadeProvider>')
    return ctx
}
