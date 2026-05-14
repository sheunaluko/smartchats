import type {
    AuthProvider,
    AuthUser,
    AuthCapabilities,
    SignInMethod,
} from 'smartchats-backend'

/**
 * LocalAuthProvider — dummy auth for trusted self-hosted deployments.
 *
 * Always reports a stable local user; sign-in/out are no-ops. UI components
 * that gate on `capabilities.required` hide their auth affordances entirely.
 */

const LOCAL_USER: AuthUser = {
    uid: 'local-user',
    email: null,
    displayName: 'Local User',
}

const LOCAL_CAPABILITIES: AuthCapabilities = {
    required: false,
    methods: [],
}

export class LocalAuthProvider implements AuthProvider {
    readonly capabilities = LOCAL_CAPABILITIES

    getCurrentUser(): AuthUser | null {
        return LOCAL_USER
    }

    async getIdToken(): Promise<string | null> {
        return null
    }

    onAuthChange(callback: (user: AuthUser | null) => void): () => void {
        // Fire once on next tick so subscribers can rely on an initial callback,
        // then never again — local user never changes.
        queueMicrotask(() => callback(LOCAL_USER))
        return () => {}
    }

    async signIn(_method: SignInMethod): Promise<void> {
        // No-op — `capabilities.required` is false.
    }

    async signOut(): Promise<void> {
        // No-op — `capabilities.required` is false.
    }
}
