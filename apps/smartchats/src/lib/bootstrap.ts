/**
 * Open-core bootstrap entrypoint.
 *
 * `bootstrap(config?)` returns a wired `{ auth, backend }` pair ready to be
 * passed to the facade providers in `app/layout.tsx`. With no config supplied
 * it defaults to LocalAuthProvider + LocalBackend — the open-core deployment.
 *
 * Closed-source wrappers consume this entrypoint by passing their own
 * provider implementations:
 *
 *     bootstrap({
 *         auth:    new MyClosedAuthProvider(),
 *         backend: new MyClosedBackend({ ... }),
 *     })
 *
 * This file is the canonical open-core surface. It must not import any
 * provider implementations beyond the local defaults shipped by the open
 * packages — wrappers wire their own providers in their own bootstrap files.
 */

'use client';

import type { AuthProvider, SmartChatsBackend } from 'smartchats-backend';
import { SMARTCHATS_DEFAULT_LOCAL_URL } from 'smartchats-backend';
import { LocalAuthProvider, LocalBackend } from 'smartchats-backend-local';

export interface SmartChatsConfig {
    /** Inject a pre-built auth provider. Default: `new LocalAuthProvider()`. */
    auth?: AuthProvider;
    /** Inject a pre-built backend. Default: `new LocalBackend({ baseUrl: localServerUrl })`. */
    backend?: SmartChatsBackend;
    /** Override the default local server URL. Ignored if `backend` is supplied. */
    localServerUrl?: string;
    /** Bearer token for an auth-gated local server. Ignored if `backend` is supplied. */
    localApiKey?: string;
}

export interface BootstrapResult {
    auth: AuthProvider;
    backend: SmartChatsBackend;
}

/**
 * Resolve the LocalBackend `baseUrl`.
 *
 * Priority:
 *  1. Explicit `config.localServerUrl` (caller wins)
 *  2. `NEXT_PUBLIC_SMARTCHATS_LOCAL_URL` (build-time override)
 *  3. `/local-api` when `NEXT_PUBLIC_SMARTCHATS_INTERNAL_PROXY` is truthy —
 *     the AIO container path: the Next.js server proxies same-origin requests
 *     to the Express server on container loopback, so the browser only needs
 *     port 3000.
 *  4. `SMARTCHATS_DEFAULT_LOCAL_URL` (`http://localhost:4242`) — the
 *     dev / 3-service-compose path where the browser hits the server directly.
 */
function resolveLocalServerUrl(explicit?: string): string {
    if (explicit) return explicit;
    if (process.env.NEXT_PUBLIC_SMARTCHATS_LOCAL_URL) return process.env.NEXT_PUBLIC_SMARTCHATS_LOCAL_URL;
    if (process.env.NEXT_PUBLIC_SMARTCHATS_INTERNAL_PROXY) return '/local-api';
    return SMARTCHATS_DEFAULT_LOCAL_URL;
}

export function bootstrap(config: SmartChatsConfig = {}): BootstrapResult {
    const auth = config.auth ?? new LocalAuthProvider();
    const backend = config.backend ?? new LocalBackend({
        baseUrl: resolveLocalServerUrl(config.localServerUrl),
        ...(config.localApiKey || process.env.NEXT_PUBLIC_SMARTCHATS_LOCAL_API_KEY
            ? { apiKey: config.localApiKey ?? process.env.NEXT_PUBLIC_SMARTCHATS_LOCAL_API_KEY }
            : {}),
    });
    return { auth, backend };
}
