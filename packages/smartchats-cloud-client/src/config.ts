/**
 * Cloud client configuration.
 *
 * Defaults point at the smartchats.ai SaaS — Firebase project `tidyscripts`,
 * cloud functions deployed at `us-central1-tidyscripts.cloudfunctions.net`.
 * End users running the open-core MCP/CLI without configuration sign into
 * the smartchats.ai SaaS as customers.
 *
 * Env vars override the defaults — useful for staging deployments and dev:
 *   SMARTCHATS_FIREBASE_API_KEY
 *   SMARTCHATS_FIREBASE_AUTH_DOMAIN
 *   SMARTCHATS_FIREBASE_PROJECT_ID
 *   SMARTCHATS_CLOUD_FUNCTIONS_BASE
 *
 * Firebase API keys are public identifiers, not secrets — see
 * https://firebase.google.com/docs/projects/api-keys. Hardcoding the
 * smartchats.ai defaults in open source is intentional: it makes the
 * single-tenant install-and-go experience friction-free.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

export interface CloudClientConfig {
    firebase: {
        apiKey: string;
        authDomain: string;
        projectId: string;
    };
    /** Base URL for httpsCallable invocations, no trailing slash. */
    cloudFunctionsBase: string;
    /** Path to credentials file. Cached refresh tokens persist here. */
    credentialsFile: string;
}

const DEFAULT_FIREBASE = {
    apiKey: 'AIzaSyByjw-kqCpeYXQpApAeUU3GAnh1WfSQd7I',
    authDomain: 'tidyscripts.firebaseapp.com',
    projectId: 'tidyscripts',
};

const DEFAULT_CLOUD_FUNCTIONS_BASE = 'https://us-central1-tidyscripts.cloudfunctions.net';

/**
 * Resolve the active configuration. Env vars override defaults; missing
 * values use the smartchats.ai SaaS defaults.
 */
export function resolveConfig(overrides: Partial<CloudClientConfig> = {}): CloudClientConfig {
    return {
        firebase: {
            apiKey:
                overrides.firebase?.apiKey ??
                process.env.SMARTCHATS_FIREBASE_API_KEY ??
                DEFAULT_FIREBASE.apiKey,
            authDomain:
                overrides.firebase?.authDomain ??
                process.env.SMARTCHATS_FIREBASE_AUTH_DOMAIN ??
                DEFAULT_FIREBASE.authDomain,
            projectId:
                overrides.firebase?.projectId ??
                process.env.SMARTCHATS_FIREBASE_PROJECT_ID ??
                DEFAULT_FIREBASE.projectId,
        },
        cloudFunctionsBase:
            overrides.cloudFunctionsBase ??
            process.env.SMARTCHATS_CLOUD_FUNCTIONS_BASE ??
            DEFAULT_CLOUD_FUNCTIONS_BASE,
        credentialsFile:
            overrides.credentialsFile ??
            process.env.SMARTCHATS_CREDENTIALS_FILE ??
            join(homedir(), '.smartchats-mcp', 'credentials.json'),
    };
}
