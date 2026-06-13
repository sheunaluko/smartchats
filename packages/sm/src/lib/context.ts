/**
 * Repo + ambient-state detection.
 *
 * The user is constantly switching between the open repo (smartchats) and the
 * cloud repo (smartchats-cloud). Many toggles only make sense in one or the
 * other (e.g. `bin/devserve --target=local-test` is cloud-only). `sm` walks
 * up from cwd to figure out which world we're in, then reads ambient state
 * (env symlinks, running containers, etc.) that affects how a verb behaves.
 *
 * Detection is intentionally read-only and cheap (no network, sub-100ms).
 * The expensive bits (Vercel state, npm versions) live in lib/remote.ts and
 * are only fetched when `sm status` actually needs them.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { execSync } from 'node:child_process';

export type RepoKind = 'open' | 'cloud' | 'unknown';

export interface RepoContext {
    kind: RepoKind;
    root: string | null;
    /** Display name for messages. */
    name: string;
}

/**
 * An open-repo root has Dockerfile.aio + bin/aio.
 * A cloud-repo root has bin/sync-from-open + bin/deploy-functions.
 */
function classifyRoot(dir: string): RepoKind {
    const hasFile = (name: string) => fs.existsSync(path.join(dir, name));
    if (hasFile('bin/sync-from-open') && hasFile('bin/deploy-functions')) return 'cloud';
    if (hasFile('Dockerfile.aio') && hasFile('bin/aio')) return 'open';
    return 'unknown';
}

function walkUp(start: string): { root: string; kind: RepoKind } | null {
    let dir = path.resolve(start);
    while (dir !== path.dirname(dir)) {
        const kind = classifyRoot(dir);
        if (kind !== 'unknown') return { root: dir, kind };
        dir = path.dirname(dir);
    }
    return null;
}

export function detectRepo(cwd: string = process.cwd()): RepoContext {
    const walked = walkUp(cwd);
    if (!walked) return { kind: 'unknown', root: null, name: '(no repo)' };
    const name = walked.kind === 'open' ? 'smartchats' : 'smartchats-cloud';
    return { kind: walked.kind, root: walked.root, name };
}

// ---------------------------------------------------------------------------
// Git state
// ---------------------------------------------------------------------------

export interface GitState {
    branch: string;
    dirty: boolean;
    ahead: number;
    behind: number;
    head: string;
    headShort: string;
}

function gitOut(root: string, args: string[]): string {
    try {
        return execSync(`git ${args.join(' ')}`, {
            cwd: root,
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
    } catch {
        return '';
    }
}

export function readGitState(root: string): GitState {
    const branch = gitOut(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || '(detached)';
    const head = gitOut(root, ['rev-parse', 'HEAD']);
    const headShort = head ? head.slice(0, 7) : '';
    const status = gitOut(root, ['status', '--porcelain']);
    const dirty = status.length > 0;
    let ahead = 0;
    let behind = 0;
    const counts = gitOut(root, ['rev-list', '--left-right', '--count', `${branch}...@{upstream}`]);
    if (counts) {
        const [a, b] = counts.split(/\s+/).map(n => parseInt(n, 10));
        if (!Number.isNaN(a)) ahead = a;
        if (!Number.isNaN(b)) behind = b;
    }
    return { branch, dirty, ahead, behind, head, headShort };
}

// ---------------------------------------------------------------------------
// Cloud-repo ambient state
// ---------------------------------------------------------------------------

export interface CloudFunctionsEnv {
    /** What `functions/.env` symlink points to. "missing" if absent. */
    symlinkTarget: '.env.local-test' | '.env.cloud' | 'other' | 'missing';
    /** The raw resolved path, for display. */
    resolvedPath: string | null;
}

export function readFunctionsEnvSymlink(cloudRoot: string): CloudFunctionsEnv {
    const link = path.join(cloudRoot, 'packages/smartchats-cloud/functions/.env');
    try {
        const stat = fs.lstatSync(link);
        if (!stat.isSymbolicLink()) {
            return { symlinkTarget: 'other', resolvedPath: link };
        }
        const target = fs.readlinkSync(link);
        const base = path.basename(target);
        if (base === '.env.local-test') return { symlinkTarget: '.env.local-test', resolvedPath: target };
        if (base === '.env.cloud') return { symlinkTarget: '.env.cloud', resolvedPath: target };
        return { symlinkTarget: 'other', resolvedPath: target };
    } catch {
        return { symlinkTarget: 'missing', resolvedPath: null };
    }
}

export interface PortProbe {
    port: number;
    inUse: boolean;
}

/** Synchronously probe localhost ports (lsof). Returns inUse=false on any error. */
export function probePorts(ports: number[]): PortProbe[] {
    return ports.map(port => {
        try {
            const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true`, {
                encoding: 'utf8',
                stdio: ['ignore', 'pipe', 'ignore'],
            }).trim();
            return { port, inUse: out.length > 0 };
        } catch {
            return { port, inUse: false };
        }
    });
}

export interface DockerContainer {
    name: string;
    running: boolean;
}

/** Check if a docker container by name is running. Returns false if docker unreachable. */
export function probeDockerContainer(name: string): DockerContainer {
    try {
        const out = execSync(`docker ps --filter "name=${name}" --format "{{.Names}}" 2>/dev/null || true`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        return { name, running: out.includes(name) };
    } catch {
        return { name, running: false };
    }
}

// ---------------------------------------------------------------------------
// Last-verify cache (~/.smartchats/sm/last-verify.json per repo)
// ---------------------------------------------------------------------------

export interface LastVerify {
    repo: RepoKind;
    level: string;
    ok: boolean;
    timestamp: string;
    head: string;
    durationMs: number;
}

function smCacheDir(): string {
    const home = process.env.HOME ?? '/tmp';
    const dir = path.join(home, '.smartchats', 'sm');
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

function lastVerifyPath(repo: RepoKind): string {
    return path.join(smCacheDir(), `last-verify-${repo}.json`);
}

export function readLastVerify(repo: RepoKind): LastVerify | null {
    try {
        const raw = fs.readFileSync(lastVerifyPath(repo), 'utf8');
        return JSON.parse(raw) as LastVerify;
    } catch {
        return null;
    }
}

export function writeLastVerify(v: LastVerify): void {
    fs.writeFileSync(lastVerifyPath(v.repo), JSON.stringify(v, null, 2));
}
