/**
 * SmartChats context detection.
 *
 * The CLI runs in four contexts (was three before persistence landed):
 *   - `explicit`     — `$SMARTCHATS_HOME` is set and points at a valid repo root.
 *   - `cloned-repo`  — caller is inside (or in a descendant of) a smartchats clone.
 *   - `config`       — config file has `smartchatsHome` (written after auto-clone).
 *   - `fresh-install`— CLI installed from npm, no clone in sight, nothing in config.
 *
 * Resolution order:
 *   1. `$SMARTCHATS_HOME` — explicit env override.
 *   2. Walk up from cwd looking for repo markers in the same dir.
 *   3. `config.smartchatsHome` from `~/.smartchats/config.json` — auto-discovery
 *      after a prior auto-clone, no env var needed for subsequent invocations.
 *   4. Return fresh-install (callers can then ensureRepoRoot to auto-clone).
 *
 * A directory counts as a "smartchats repo root" if it has BOTH a `package.json`
 * (any package) AND a `Dockerfile.aio`. The Dockerfile.aio is the canonical
 * marker — there's only one place in the repo where it lives.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

import { loadConfig } from './config.js';

export type SmartChatsContext =
    | { mode: 'explicit'; root: string }
    | { mode: 'cloned-repo'; root: string }
    | { mode: 'config'; root: string }
    | { mode: 'fresh-install'; root: null };

const DOCKERFILE_MARKER = 'Dockerfile.aio';
const PACKAGE_JSON = 'package.json';

function isRepoRoot(dir: string): boolean {
    return fs.existsSync(path.join(dir, PACKAGE_JSON))
        && fs.existsSync(path.join(dir, DOCKERFILE_MARKER));
}

function walkUpForRepoRoot(start: string): string | null {
    let dir = path.resolve(start);
    while (dir !== path.dirname(dir)) {
        if (isRepoRoot(dir)) return dir;
        dir = path.dirname(dir);
    }
    return null;
}

export function detectContext(cwd: string = process.cwd()): SmartChatsContext {
    const envHome = process.env.SMARTCHATS_HOME;
    if (envHome) {
        const resolved = path.resolve(envHome);
        if (!isRepoRoot(resolved)) {
            throw new Error(
                `SMARTCHATS_HOME=${envHome} does not look like a smartchats repo root `
                + `(missing ${DOCKERFILE_MARKER} or ${PACKAGE_JSON}).`,
            );
        }
        return { mode: 'explicit', root: resolved };
    }

    const walked = walkUpForRepoRoot(cwd);
    if (walked) {
        return { mode: 'cloned-repo', root: walked };
    }

    // Third tier: config file remembers where we cloned to last.
    try {
        const cfgHome = loadConfig().smartchatsHome;
        if (cfgHome) {
            const resolved = path.resolve(cfgHome);
            if (isRepoRoot(resolved)) {
                return { mode: 'config', root: resolved };
            }
            // Stale entry — fall through to fresh-install rather than crashing.
            // ensureRepoRoot will re-clone if needed and overwrite this.
        }
    } catch { /* config unreadable — ignore */ }

    return { mode: 'fresh-install', root: null };
}

/**
 * Return the repo root or throw a friendly error describing why we can't.
 * Use this from subcommands that fundamentally cannot work without source
 * access (Phase 1: all of `launch`).
 */
export function requireRepo(ctx: SmartChatsContext): string {
    if (ctx.mode === 'fresh-install') {
        throw new Error(
            'Could not find a smartchats repo. This command currently requires running\n'
            + 'from inside a smartchats clone (or with $SMARTCHATS_HOME pointing at one).\n'
            + '\n'
            + 'To get a clone:    git clone https://github.com/sheunaluko/smartchats.git\n'
            + 'To point at it:    export SMARTCHATS_HOME=/path/to/clone',
        );
    }
    return ctx.root;
}

/**
 * Human-readable description for status output.
 */
export function describeContext(ctx: SmartChatsContext): string {
    switch (ctx.mode) {
        case 'explicit':
            return `repo root from $SMARTCHATS_HOME (${ctx.root})`;
        case 'cloned-repo':
            return `repo root found via dir walk (${ctx.root})`;
        case 'config':
            return `repo root from config.smartchatsHome (${ctx.root})`;
        case 'fresh-install':
            return 'fresh install (no repo clone reachable)';
    }
}
