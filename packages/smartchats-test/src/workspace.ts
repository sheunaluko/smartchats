/**
 * Workspace introspection helpers — locate the monorepo root, enumerate
 * packages + apps, read their package.json.
 *
 * Walks up from `process.cwd()` looking for a package.json with `workspaces`.
 * Pure-ish (filesystem reads only).
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export interface WorkspacePackage {
    /** Package name from package.json. */
    name: string;
    /** Absolute path to the package dir. */
    path: string;
    /** Available npm scripts (from package.json's scripts block). */
    scripts: Record<string, string>;
    /** Where it lives: 'apps' vs 'packages'. */
    kind: 'apps' | 'packages';
}

/** Find the monorepo root by walking up looking for workspaces in package.json. */
export function findRepoRoot(startDir: string = process.cwd()): string {
    let dir = resolve(startDir);
    while (true) {
        const pj = join(dir, 'package.json');
        if (existsSync(pj)) {
            try {
                const j = JSON.parse(readFileSync(pj, 'utf-8'));
                if (j.workspaces) return dir;
            } catch {
                /* keep walking */
            }
        }
        const parent = dirname(dir);
        if (parent === dir) {
            throw new Error(`No monorepo root found from ${startDir}`);
        }
        dir = parent;
    }
}

/** Enumerate every workspace package (apps/* + packages/*). */
export function listPackages(repoRoot: string): WorkspacePackage[] {
    const out: WorkspacePackage[] = [];
    for (const kind of ['apps', 'packages'] as const) {
        const root = join(repoRoot, kind);
        if (!existsSync(root)) continue;
        for (const name of readdirSync(root)) {
            const path = join(root, name);
            const pj = join(path, 'package.json');
            if (!existsSync(pj)) continue;
            try {
                const j = JSON.parse(readFileSync(pj, 'utf-8'));
                out.push({
                    name: j.name ?? name,
                    path,
                    scripts: j.scripts ?? {},
                    kind,
                });
            } catch {
                /* skip malformed */
            }
        }
    }
    return out;
}

/** Filter to packages that define a particular npm script. */
export function packagesWithScript(
    pkgs: WorkspacePackage[],
    script: string,
): WorkspacePackage[] {
    return pkgs.filter((p) => script in p.scripts);
}
