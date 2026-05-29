/**
 * Detect whether the CLI is running from a binary install (curl|sh path)
 * or from a source checkout (dev / npm-install path).
 *
 * Binary install layout (per install.sh + the release tarball spec):
 *   $PREFIX/bin/smartchats         (bun-compiled CLI — this binary)
 *   $PREFIX/bin/smartchats-server  (bun-compiled local server)
 *   $PREFIX/bin/surreal            (native binary)
 *   $PREFIX/app/out/               (static SPA bundle)
 *
 * Detection: walk up from process.argv[0] looking for `bin/smartchats-server`
 * + `app/out/` siblings. If found, we're in a binary install and can spawn
 * the bundled binaries directly. Otherwise fall through to source mode.
 *
 * This is what lets `smartchats start` work cleanly across:
 *   - curl|sh user installs (binary mode)
 *   - npm install -g + bun --bun run src/cli.ts contributors (source mode)
 *   - git clone + npm link contributors (source mode)
 *   - bun-compiled binaries in dist-bun/ pointed at a checkout (binary mode)
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

export interface BinaryInstall {
    /** Install root, typically ~/.smartchats. */
    root: string;
    /** Bundled smartchats-server executable. */
    serverBin: string;
    /** Bundled SurrealDB binary. */
    surrealBin: string;
    /** Static SPA directory (passed to server as SMARTCHATS_STATIC_DIR). */
    staticDir: string;
}

function looksLikeInstallRoot(candidate: string): BinaryInstall | null {
    const serverBin = path.join(candidate, 'bin', 'smartchats-server');
    const surrealBin = path.join(candidate, 'bin', 'surreal');
    const staticDir = path.join(candidate, 'app', 'out');
    if (fs.existsSync(serverBin) && fs.existsSync(staticDir)) {
        return {
            root: candidate,
            serverBin,
            // Surreal may have been pre-installed elsewhere on the user's
            // machine — fall back to the system one if the bundled binary
            // isn't present (forward-compat with slimmer tarballs that
            // assume system surreal).
            surrealBin: fs.existsSync(surrealBin) ? surrealBin : '',
            staticDir,
        };
    }
    return null;
}

/**
 * Detect a binary install by walking up from the running executable. Used
 * by `smartchats start` to decide whether to spawn pre-built binaries or
 * run the source tree via bun.
 *
 * Returns null in source mode (dev / npm install / contributor checkout).
 */
export function detectBinaryInstall(): BinaryInstall | null {
    // process.argv[0] when bun-compiled is the path to the binary itself.
    // When running via `bun src/cli.ts` it's the path to bun.
    const exe = process.argv[0];
    if (!exe) return null;

    // Walk up from the executable's directory looking for the layout.
    let dir = path.dirname(path.resolve(exe));
    for (let i = 0; i < 6; i++) {
        const hit = looksLikeInstallRoot(dir);
        if (hit) return hit;
        // Try one level up.
        const parent = path.dirname(dir);
        if (parent === dir) break;
        dir = parent;
    }

    // Fallback: check the conventional install location explicitly. Catches
    // cases where the CLI is invoked via a symlink (e.g. /usr/local/bin/smartchats
    // → ~/.smartchats/bin/smartchats) and argv[0] is the symlink, not the
    // resolved target.
    const conventional = path.join(process.env.HOME ?? '', '.smartchats');
    return looksLikeInstallRoot(conventional);
}

/**
 * Description for logging.
 */
export function describeInstall(install: BinaryInstall | null): string {
    if (!install) return 'source mode (running from a smartchats checkout)';
    return `binary install at ${install.root}`;
}
