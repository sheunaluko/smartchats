/**
 * AuthProvider — minimal, backend-agnostic auth surface.
 *
 * Two real deployment targets:
 *   - Closed-cloud: full auth flow (OAuth / email / anonymous).
 *   - Self-hosted: trusted single-user, no auth flow. All sign-in/out are no-ops.
 *
 * The open-core app tree consumes only this interface; provider SDKs are
 * never imported directly from UI code. The closed wrapper (Phase 5.1)
 * injects the cloud implementation at boot.
 */

export interface AuthUser {
    uid: string
    email: string | null
    displayName: string | null
}

export type SignInMethod = 'google' | 'email' | 'anonymous'

export interface EmailCredentials {
    email: string
    password: string
    /** When true, create a new account instead of signing in. */
    signup?: boolean
}

export interface AuthCapabilities {
    /** When false, the deployment is trusted and all sign-in/out calls are no-ops. UI should hide auth affordances. */
    required: boolean
    /** Advertised sign-in methods. Only meaningful when `required === true`. */
    methods: SignInMethod[]
}

export interface AuthProvider {
    readonly capabilities: AuthCapabilities
    getCurrentUser(): AuthUser | null
    getIdToken(): Promise<string | null>
    onAuthChange(callback: (user: AuthUser | null) => void): () => void
    /**
     * Start a sign-in flow. Throws if `method` isn't in `capabilities.methods`.
     * No-op (resolves silently) when `capabilities.required === false`.
     */
    signIn(method: SignInMethod, credentials?: EmailCredentials): Promise<void>
    /** Sign out. No-op when `capabilities.required === false`. */
    signOut(): Promise<void>
}
