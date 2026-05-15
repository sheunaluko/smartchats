/**
 * App-local auth facade.
 *
 * Every UI/component consumes auth through this module — never through
 * provider SDKs directly. The one file that instantiates a concrete
 * provider is the app root bootstrap (see `app/app3.tsx` / root layout);
 * callers can inject an alternative provider implementation at bootstrap
 * time without touching consumers.
 *
 * This facade exposes:
 *   - `AuthFacadeProvider` — React context provider taking an `AuthProvider` instance
 *   - `useAuth()` — hook returning `{ user, isReady, capabilities, signIn, signOut, getIdToken }`
 *   - `getAuthProvider()` — non-hook accessor for outside-React call sites
 */

'use client'

import {
    createContext,
    createElement,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useState,
    type ReactNode,
} from 'react'
import type {
    AuthProvider,
    AuthUser,
    SignInMethod,
    EmailCredentials,
    AuthCapabilities,
} from 'smartchats-backend'

interface AuthFacadeValue {
    user: AuthUser | null
    /** True once the provider has fired at least one onAuthChange callback (or is ready-by-construction). */
    isReady: boolean
    capabilities: AuthCapabilities
    signIn: (method: SignInMethod, credentials?: EmailCredentials) => Promise<void>
    signOut: () => Promise<void>
    getIdToken: () => Promise<string | null>
}

const AuthContext = createContext<AuthFacadeValue | null>(null)

// Module-level singleton for non-hook call sites (e.g., HTTP clients in src/lib/*).
// Populated by AuthFacadeProvider on mount; accessed via getAuthProvider().
let _provider: AuthProvider | null = null

export function getAuthProvider(): AuthProvider {
    if (!_provider) throw new Error('AuthProvider not initialized — AuthFacadeProvider must mount before getAuthProvider() is called')
    return _provider
}

export interface AuthFacadeProviderProps {
    provider: AuthProvider
    children: ReactNode
}

export function AuthFacadeProvider({ provider, children }: AuthFacadeProviderProps) {
    // Expose the instance to non-React call sites.
    _provider = provider

    const [user, setUser] = useState<AuthUser | null>(() => provider.getCurrentUser())
    const [isReady, setIsReady] = useState(false)

    useEffect(() => {
        const unsubscribe = provider.onAuthChange((u) => {
            setUser(u)
            setIsReady(true)
        })
        return unsubscribe
    }, [provider])

    const signIn = useCallback(
        (method: SignInMethod, credentials?: EmailCredentials) => provider.signIn(method, credentials),
        [provider],
    )
    const signOutFn = useCallback(() => provider.signOut(), [provider])
    const getIdToken = useCallback(() => provider.getIdToken(), [provider])

    const value = useMemo<AuthFacadeValue>(
        () => ({
            user,
            isReady,
            capabilities: provider.capabilities,
            signIn,
            signOut: signOutFn,
            getIdToken,
        }),
        [user, isReady, provider, signIn, signOutFn, getIdToken],
    )

    return createElement(AuthContext.Provider, { value }, children)
}

export function useAuth(): AuthFacadeValue {
    const ctx = useContext(AuthContext)
    if (!ctx) throw new Error('useAuth must be used inside <AuthFacadeProvider>')
    return ctx
}
