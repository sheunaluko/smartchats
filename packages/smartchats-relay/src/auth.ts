import { config } from './config.js';

export interface VerifiedIdentity {
    uid: string;
    exp: number;
}

let firebaseAuthPromise: Promise<typeof import('firebase-admin/auth')['getAuth']> | null = null;

async function getVerifier() {
    if (firebaseAuthPromise) return firebaseAuthPromise;
    firebaseAuthPromise = (async () => {
        const [{ initializeApp, cert, getApps }, { getAuth }] = await Promise.all([
            import('firebase-admin/app'),
            import('firebase-admin/auth'),
        ]);
        if (getApps().length === 0) {
            if (config.firebaseCredentials) {
                const sa = JSON.parse(Buffer.from(config.firebaseCredentials, 'base64').toString('utf8'));
                initializeApp({ credential: cert(sa), projectId: config.firebaseProjectId ?? sa.project_id });
            } else {
                // Project ID alone is sufficient for verifyIdToken — Firebase
                // signing keys are publicly fetchable. Service account creds
                // would only be needed for admin ops (revocation, user mgmt).
                initializeApp({ projectId: config.firebaseProjectId });
            }
        }
        return getAuth;
    })();
    return firebaseAuthPromise;
}

export async function verifyToken(token: string): Promise<VerifiedIdentity> {
    if (!token) throw new Error('missing token');
    if (config.devTokenBypass && config.nodeEnv !== 'production') {
        return { uid: `dev:${token.slice(0, 32)}`, exp: Math.floor(Date.now() / 1000) + 3600 };
    }
    const getAuth = await getVerifier();
    const decoded = await getAuth().verifyIdToken(token);
    return { uid: decoded.uid, exp: decoded.exp };
}
