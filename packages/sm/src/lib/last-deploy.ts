/**
 * Last-deploy cache.
 *
 * Each successful `sm deploy <target>` writes a tiny JSON record with the
 * deployed commit SHA + timestamp + target. `sm status` reads these to
 * compute "what's changed since the last deploy" per target, so
 * recommendations like "you touched functions/ — run `sm deploy functions`"
 * have real ground truth.
 *
 * Cache lives at:
 *   ~/.smartchats/sm/last-deploy-<repo>-<target>.json
 *
 * Phase 4 may augment / replace this with remote reads (Vercel API,
 * firebase functions:list) for higher fidelity, but the local cache stays
 * because it's fast and works offline.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import type { RepoKind } from './context.js';

export type DeployTarget = 'functions' | 'frontend' | 'schema';

export interface LastDeploy {
    repo: RepoKind;
    target: DeployTarget;
    head: string;
    timestamp: string;
    /** Optional extras (durations, deploy URLs) for Phase 4. */
    extra?: Record<string, unknown>;
}

function smCacheDir(): string {
    const home = process.env.HOME ?? '/tmp';
    const dir = path.join(home, '.smartchats', 'sm');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function lastDeployPath(repo: RepoKind, target: DeployTarget): string {
    return path.join(smCacheDir(), `last-deploy-${repo}-${target}.json`);
}

export function readLastDeploy(repo: RepoKind, target: DeployTarget): LastDeploy | null {
    try {
        const raw = fs.readFileSync(lastDeployPath(repo, target), 'utf8');
        return JSON.parse(raw) as LastDeploy;
    } catch {
        return null;
    }
}

export function writeLastDeploy(d: LastDeploy): void {
    fs.writeFileSync(lastDeployPath(d.repo, d.target), JSON.stringify(d, null, 2));
}

/** Read all three cloud-target records at once. Missing ones return null. */
export function readAllDeploys(repo: RepoKind): Record<DeployTarget, LastDeploy | null> {
    return {
        functions: readLastDeploy(repo, 'functions'),
        frontend: readLastDeploy(repo, 'frontend'),
        schema: readLastDeploy(repo, 'schema'),
    };
}
