/**
 * Auto-clone the smartchats repo for fresh-install users.
 *
 * The CLI needs the repo's `Dockerfile.aio` + build context to launch the
 * AIO stack. In Phase 1 there's no prebuilt image yet, so when the user
 * does `npx smartchats-ai launch` from a machine with no clone, we
 * silently clone the repo into a known location and use that as the
 * repo root.
 *
 * Default clone location (matches launch.ts data-dir pattern):
 *   - $XDG_DATA_HOME/smartchats/repo
 *   - ~/.smartchats/repo
 *
 * Override with --repo-path or $SMARTCHATS_REPO_PATH.
 * Override the source URL with $SMARTCHATS_REPO_URL (mostly for testing).
 *
 * Re-running the CLI on a machine that already has the clone reuses it
 * (no auto-update yet — that's a Phase 2 concern).
 */

import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import consola from 'consola';

import { detectContext, type SmartChatsContext } from './context.js';

const DEFAULT_REPO_URL = 'https://github.com/sheunaluko/smartchats.git';
const DOCKERFILE_MARKER = 'Dockerfile.aio';
const PACKAGE_JSON = 'package.json';

export function defaultClonePath(): string {
    if (process.env.SMARTCHATS_REPO_PATH) {
        return path.resolve(process.env.SMARTCHATS_REPO_PATH);
    }
    const xdgData = process.env.XDG_DATA_HOME;
    if (xdgData) return path.join(xdgData, 'smartchats', 'repo');
    return path.join(process.env.HOME ?? '/tmp', '.smartchats', 'repo');
}

function checkGit(): boolean {
    return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
}

function looksLikeRepoRoot(dir: string): boolean {
    return fs.existsSync(path.join(dir, PACKAGE_JSON))
        && fs.existsSync(path.join(dir, DOCKERFILE_MARKER));
}

export interface EnsureRepoOptions {
    /** Override the default clone location. */
    repoPath?: string;
    /** Disable the auto-clone behavior; throw instead. */
    autoClone?: boolean;
}

/**
 * Resolve a usable repo root: detect via env / dir walk, or auto-clone if
 * we're in fresh-install mode. Throws with a friendly message if cloning
 * fails or is disabled.
 */
export async function ensureRepoRoot(opts: EnsureRepoOptions = {}): Promise<string> {
    const ctx: SmartChatsContext = detectContext(process.cwd());
    if (ctx.root) return ctx.root;

    // fresh-install path
    if (opts.autoClone === false) {
        throw new Error(
            'No smartchats repo found and auto-clone is disabled.\n'
            + 'Set $SMARTCHATS_HOME or run from inside a clone.',
        );
    }

    if (!checkGit()) {
        throw new Error(
            'git not found, and the CLI needs to clone the smartchats repo on first run.\n'
            + 'Install git (e.g. `brew install git` or `apt install git`) and try again.',
        );
    }

    const target = opts.repoPath ? path.resolve(opts.repoPath) : defaultClonePath();

    // Already cloned (or pre-existing valid checkout) — reuse.
    if (looksLikeRepoRoot(target)) {
        return target;
    }

    // Bail if the path exists but isn't a valid repo root — don't clobber.
    if (fs.existsSync(target)) {
        throw new Error(
            `Cannot clone into ${target}: directory exists but doesn't look like a smartchats clone.\n`
            + 'Remove it or pick a different path with --repo-path / $SMARTCHATS_REPO_PATH.',
        );
    }

    const url = process.env.SMARTCHATS_REPO_URL ?? DEFAULT_REPO_URL;

    consola.start(`Cloning ${url} → ${target} (one-time, ~30s)`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const result = spawnSync('git', ['clone', '--depth=1', url, target], { stdio: 'inherit' });
    if (result.status !== 0) {
        // Clean up partial clone so a retry isn't blocked by "path exists".
        try { fs.rmSync(target, { recursive: true, force: true }); } catch { /* ignore */ }
        throw new Error(
            `git clone failed (exit ${result.status}). Check network + git auth and try again.`,
        );
    }

    if (!looksLikeRepoRoot(target)) {
        throw new Error(
            `Cloned ${url} but ${DOCKERFILE_MARKER} is missing at the root. `
            + 'The remote may have moved or been restructured.',
        );
    }

    consola.success(`Cloned smartchats → ${target}`);
    return target;
}
