import {
    getAuth,
    onAuthStateChanged,
    signInAnonymously,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    signInWithPopup,
    signOut,
    GoogleAuthProvider,
    type User as FirebaseUser,
} from 'firebase/auth'
import type {
    AuthProvider,
    AuthUser,
    AuthCapabilities,
    SignInMethod,
    EmailCredentials,
} from 'smartchats-backend'

/**
 * FirebaseAuthProvider — wraps `firebase/auth` behind the SmartChatsBackend
 * `AuthProvider` interface. The open-core app tree never imports this class
 * directly; the closed wrapper constructs it at boot and injects it through
 * the app's AuthContext.
 */

const CAPABILITIES: AuthCapabilities = {
    required: true,
    methods: ['google', 'email', 'anonymous'],
}

function toAuthUser(u: FirebaseUser | null): AuthUser | null {
    if (!u) return null
    return {
        uid: u.uid,
        email: u.email,
        displayName: u.displayName,
    }
}

export class FirebaseAuthProvider implements AuthProvider {
    readonly capabilities = CAPABILITIES

    getCurrentUser(): AuthUser | null {
        try {
            return toAuthUser(getAuth().currentUser)
        } catch {
            return null
        }
    }

    async getIdToken(): Promise<string | null> {
        try {
            return (await getAuth().currentUser?.getIdToken()) ?? null
        } catch {
            return null
        }
    }

    onAuthChange(callback: (user: AuthUser | null) => void): () => void {
        const auth = getAuth()
        return onAuthStateChanged(auth, (u) => callback(toAuthUser(u)))
    }

    async signIn(method: SignInMethod, credentials?: EmailCredentials): Promise<void> {
        if (!CAPABILITIES.methods.includes(method)) {
            throw new Error(`sign-in method not supported: ${method}`)
        }
        const auth = getAuth()
        switch (method) {
            case 'google':
                await signInWithPopup(auth, new GoogleAuthProvider())
                return
            case 'anonymous':
                await signInAnonymously(auth)
                return
            case 'email': {
                if (!credentials) throw new Error('email sign-in requires credentials')
                if (credentials.signup) {
                    await createUserWithEmailAndPassword(auth, credentials.email, credentials.password)
                } else {
                    await signInWithEmailAndPassword(auth, credentials.email, credentials.password)
                }
                return
            }
        }
    }

    async signOut(): Promise<void> {
        await signOut(getAuth())
    }
}
