/**
 * SmartChats context detection.
 *
 * The CLI runs in three contexts:
 *   - `explicit`     — `$SMARTCHATS_HOME` is set and points at a valid repo root.
 *   - `cloned-repo`  — caller is inside (or in a descendant of) a smartchats clone.
 *   - `fresh-install`— CLI installed from npm, no clone in sight. Phase 1 doesn't
 *                      support running launch in this mode (Dockerfile.aio not
 *                      reachable); Phase 3 will bundle prebuilt assets to fix this.
 *
 * Resolution order:
 *   1. `$SMARTCHATS_HOME` — if set, validate it has `Dockerfile.aio` and use it.
 *   2. Walk up from cwd looking for `package.json` + `Dockerfile.aio` in the same dir.
 *   3. Return fresh-install.
 *
 * A directory counts as a "smartchats repo root" if it has BOTH a `package.json`
 * (any package) AND a `Dockerfile.aio`. The Dockerfile.aio is the canonical
 * marker — there's only one place in the repo where it lives, and its presence
 * means we can `docker build` the AIO image locally.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export type SmartChatsContext =
    | { mode: 'explicit'; root: string }
    | { mode: 'cloned-repo'; root: string }
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
        case 'fresh-install':
            return 'fresh install (no repo clone reachable)';
    }
}
