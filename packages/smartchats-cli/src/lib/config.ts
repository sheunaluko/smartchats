/**
 * Persistent CLI config.
 *
 * Path resolution (matches launch.ts data-dir pattern):
 *   1. $XDG_CONFIG_HOME/smartchats/config.json (XDG-compliant)
 *   2. ~/.smartchats/config.json (fallback)
 *
 * Override the whole path with $SMARTCHATS_CONFIG_FILE if you need to.
 *
 * Config holds **preferences** only — what mode was used last, what port,
 * what BYO-SurrealDB target was configured. Secrets stay separate:
 *   - Cloud login creds: ~/.smartchats-mcp/credentials.json (shared w/ MCP)
 *   - Provider API keys: <repo-root>/.env (managed by `launch`)
 *
 * Forward compat: unknown fields are preserved on save. Bump `schemaVersion`
 * + write a migration when removing fields.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

const CURRENT_SCHEMA_VERSION = 1;

export type LaunchMode = 'aio' | 'byo-db' | 'dev';

export interface SmartChatsConfig {
    schemaVersion: number;
    /** Most recent launch mode the user picked. Phase 1: always 'aio'. */
    lastUsedMode?: LaunchMode;
    /** Last host port used for the local stack. */
    lastUsedPort?: number;
    /** BYO SurrealDB target. Phase 2+. */
    byo?: {
        surrealUrl?: string;
        surrealUser?: string;
        // We deliberately do NOT store passwords here — keep them in .env or env vars.
    };
    /** Preserve unknown fields across CLI versions. */
    [extra: string]: unknown;
}

const DEFAULT_CONFIG: SmartChatsConfig = {
    schemaVersion: CURRENT_SCHEMA_VERSION,
};

export function getConfigPath(): string {
    if (process.env.SMARTCHATS_CONFIG_FILE) {
        return path.resolve(process.env.SMARTCHATS_CONFIG_FILE);
    }
    const xdgConfig = process.env.XDG_CONFIG_HOME;
    if (xdgConfig) return path.join(xdgConfig, 'smartchats', 'config.json');
    return path.join(process.env.HOME ?? '/tmp', '.smartchats', 'config.json');
}

export function loadConfig(): SmartChatsConfig {
    const file = getConfigPath();
    if (!fs.existsSync(file)) return { ...DEFAULT_CONFIG };
    try {
        const raw = fs.readFileSync(file, 'utf8');
        const parsed = JSON.parse(raw) as SmartChatsConfig;
        if (typeof parsed !== 'object' || parsed === null) return { ...DEFAULT_CONFIG };
        return { ...DEFAULT_CONFIG, ...parsed };
    } catch {
        // Corrupted file — start fresh rather than crash. The next save
        // overwrites it with a clean state.
        return { ...DEFAULT_CONFIG };
    }
}

export function saveConfig(config: SmartChatsConfig): void {
    const file = getConfigPath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const next = { ...config, schemaVersion: CURRENT_SCHEMA_VERSION };
    fs.writeFileSync(file, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
}

/** Merge a partial update into the on-disk config. */
export function updateConfig(patch: Partial<SmartChatsConfig>): SmartChatsConfig {
    const current = loadConfig();
    const next = { ...current, ...patch, schemaVersion: CURRENT_SCHEMA_VERSION };
    saveConfig(next);
    return next;
}
