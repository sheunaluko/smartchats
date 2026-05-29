/**
 * Bootstrap entrypoint.
 *
 * `bootstrap(config?)` returns a wired `{ auth, backend }` pair ready to be
 * passed to the facade providers in `app/layout.tsx`. With no config supplied
 * it defaults to LocalAuthProvider + LocalBackend — the standard self-hosted
 * deployment.
 *
 * Callers can override either provider by passing their own implementations:
 *
 *     bootstrap({
 *         auth:    new MyAuthProvider(),
 *         backend: new MyBackend({ ... }),
 *     })
 *
 * This file is the canonical open-core surface. It must not import any
 * provider implementations beyond the local defaults shipped by the open
 * packages — wrappers wire their own providers in their own bootstrap files.
 */

'use client';

import type { AuthProvider, SmartChatsBackend } from 'smartchats-backend';
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
 *  2. `NEXT_PUBLIC_SMARTCHATS_LOCAL_URL` (build-time override — bypass the
 *     proxy entirely, e.g. browser talks directly to a remote Express)
 *  3. `/local-api` (default) — Next.js proxies same-origin requests to the
 *     Express server. Upstream host/port configurable via `SMARTCHATS_LOCAL_HOST`
 *     and `SMARTCHATS_LOCAL_PORT` (see next.config.mjs).
 */
function resolveLocalServerUrl(explicit?: string): string {
    if (explicit) return explicit;
    if (process.env.NEXT_PUBLIC_SMARTCHATS_LOCAL_URL) return process.env.NEXT_PUBLIC_SMARTCHATS_LOCAL_URL;
    return '/local-api';
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
