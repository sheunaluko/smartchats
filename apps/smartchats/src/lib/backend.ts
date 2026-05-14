/**
 * Thin non-React accessors for the `SmartChatsBackend` instance.
 *
 * The concrete backend is constructed at app bootstrap and exposed via
 * `BackendFacadeProvider` (see `backend_facade.ts`). This module is only a
 * convenience for non-React call sites (HTTP clients, vendor shims) and for
 * compatibility shims that predate the facade.
 *
 * No provider classes are imported here — open-core rule.
 */

'use client';

import type { SmartChatsBackend } from 'smartchats-backend';
import { getBackendInstance } from './backend_facade';

export function getBackend(): SmartChatsBackend {
    return getBackendInstance();
}

/**
 * Signature-compatible shim for the legacy `get_cloud_embedding(text, dims?)`
 * callback pattern — returns just the vector so existing callers don't change.
 * New code should use `useBackend().embeddings.embed(...)` directly.
 */
export async function embed_vector(text: string, dimensions?: number): Promise<number[]> {
    const result = await getBackendInstance().embeddings.embed({ text, dimensions });
    return result.embedding;
}

/**
 * Compatibility shim for AppDataStore / migrateLocalToCloud / switchToLocal,
 * which consume a callable-shaped function and rely on the
 * `.data.result.result = [{status, result, time}]` envelope. Wraps
 * `backend.data.query()` to reproduce that shape without leaking backend
 * abstractions into the ts_next_app-sourced AppDataStore.
 */
export async function surreal_query_compat(args: { query: string; variables?: Record<string, any> }): Promise<any> {
    const result = await getBackendInstance().data.query(args);
    return {
        data: {
            result: {
                result: result.statements,
            },
        },
    };
}
