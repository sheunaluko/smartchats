/**
 * Remote-state TTL cache.
 *
 * Bare `sm` runs constantly. Hitting Vercel + Firebase + npm + git ls-remote
 * every time would take 3-5s and burn quota. Cache for 60s by default; let
 * `sm status --refresh` bust the cache when the user explicitly wants fresh.
 *
 * Per-entry timestamps so the renderer can show "cached 47s ago" and the
 * user knows how stale each line is.
 *
 * The cache lives at ~/.smartchats/sm/remote-cache.json (a single file
 * shared across repos — the bundle struct keeps cloud + open data
 * separately keyed).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RemoteBundle } from './remote.js';

const DEFAULT_TTL_MS = 60_000;

export interface CachedRemoteBundle {
    /** When this whole bundle was fetched. */
    fetchedAt: string;
    bundle: RemoteBundle;
}

function cachePath(): string {
    const home = process.env.HOME ?? '/tmp';
    const dir = path.join(home, '.smartchats', 'sm');
    fs.mkdirSync(dir, { recursive: true });
    return path.join(dir, 'remote-cache.json');
}

export function readRemoteCache(ttlMs = DEFAULT_TTL_MS): CachedRemoteBundle | null {
    try {
        const raw = fs.readFileSync(cachePath(), 'utf8');
        const parsed = JSON.parse(raw) as CachedRemoteBundle;
        const age = Date.now() - new Date(parsed.fetchedAt).getTime();
        if (age > ttlMs) return null;
        return parsed;
    } catch {
        return null;
    }
}

export function writeRemoteCache(bundle: RemoteBundle): CachedRemoteBundle {
    const c: CachedRemoteBundle = {
        fetchedAt: new Date().toISOString(),
        bundle,
    };
    fs.writeFileSync(cachePath(), JSON.stringify(c, null, 2));
    return c;
}

/** Age of the cached bundle in seconds, or null if no cache. */
export function cacheAgeSeconds(c: CachedRemoteBundle): number {
    return Math.max(0, Math.floor((Date.now() - new Date(c.fetchedAt).getTime()) / 1000));
}
