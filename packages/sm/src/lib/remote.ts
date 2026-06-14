/**
 * Remote-state fetchers.
 *
 * Each fetcher answers one question about the live world:
 *
 *   fetchVercelDeployment    — what's serving smartchats.ai right now?
 *   fetchFirebaseFunctions   — which Cloud Functions are deployed?
 *   fetchNpmVersion          — what's the latest smartchats-ai on the registry?
 *   fetchGitRemoteHead       — what SHA is at <remote>/<ref> right now?
 *
 * All fetchers return a uniform shape so the cache + renderer can treat them
 * the same way. Each has a hard timeout (default 5s) so a slow / down service
 * never blocks `sm status`.
 *
 * The fetchers shell out to the canonical CLIs (firebase, npm, git, curl/node)
 * rather than reimplementing API clients — keeps the deps minimal and reuses
 * the user's existing auth context (firebase login, vercel login, ssh keys).
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { request as httpsRequest } from 'node:https';
import { URL } from 'node:url';

const execFileAsync = promisify(execFile);

export interface FetchResult<T> {
    ok: boolean;
    value: T | null;
    error?: string;
    durationMs: number;
}

async function timeBox<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
    return await Promise.race<T>([
        p,
        new Promise<T>((_resolve, reject) => setTimeout(() => reject(new Error(`${label}: timeout after ${ms}ms`)), ms)),
    ]);
}

async function timed<T>(fn: () => Promise<T>): Promise<FetchResult<T>> {
    const start = Date.now();
    try {
        const value = await fn();
        return { ok: true, value, durationMs: Date.now() - start };
    } catch (e: any) {
        return { ok: false, value: null, error: e?.message ?? String(e), durationMs: Date.now() - start };
    }
}

// ---------------------------------------------------------------------------
// Vercel
// ---------------------------------------------------------------------------

export interface VercelDeployment {
    /** Short deployment id (uid). */
    uid: string;
    /** Production URL (e.g. https://smartchats.ai). */
    url: string;
    /** READY | BUILDING | ERROR | QUEUED | CANCELED. */
    state: string;
    /** Git commit SHA the deployment was built from (if available). */
    sha: string | null;
    /** When the deployment was created (ISO). */
    createdAt: string;
    /** Project name as Vercel knows it. */
    projectName: string;
}

/**
 * Fetch the current production deployment from Vercel.
 *
 * Strategy: REST API with $VERCEL_TOKEN. If the token is missing, bail
 * with a useful error so the renderer can suggest setting it.
 *
 * If $VERCEL_PROJECT_ID is set, filter to that project. Otherwise, return
 * the most recent production deployment across the team (which is what the
 * user usually means anyway).
 */
export async function fetchVercelDeployment(opts: {
    timeoutMs?: number;
    projectId?: string;
    teamId?: string;
} = {}): Promise<FetchResult<VercelDeployment>> {
    return timed(async () => {
        const token = process.env.VERCEL_TOKEN;
        if (!token) {
            throw new Error('set $VERCEL_TOKEN (https://vercel.com/account/tokens) to enable Vercel state');
        }
        const params = new URLSearchParams({ limit: '1', target: 'production' });
        if (opts.projectId ?? process.env.VERCEL_PROJECT_ID) {
            params.set('projectId', opts.projectId ?? process.env.VERCEL_PROJECT_ID!);
        }
        if (opts.teamId ?? process.env.VERCEL_TEAM_ID) {
            params.set('teamId', opts.teamId ?? process.env.VERCEL_TEAM_ID!);
        }
        const url = `https://api.vercel.com/v6/deployments?${params.toString()}`;
        const json = await timeBox(vercelGet(url, token), opts.timeoutMs ?? 5000, 'vercel');
        const dep = (json?.deployments ?? [])[0];
        if (!dep) throw new Error('no production deployments returned');
        return {
            uid: dep.uid ?? dep.id ?? '',
            url: `https://${dep.url ?? ''}`,
            state: dep.state ?? dep.readyState ?? 'unknown',
            sha: dep.meta?.githubCommitSha ?? dep.meta?.gitCommitSha ?? null,
            createdAt: new Date(dep.createdAt ?? dep.created ?? Date.now()).toISOString(),
            projectName: dep.name ?? '',
        };
    });
}

function vercelGet(url: string, token: string): Promise<any> {
    return new Promise((resolve, reject) => {
        const parsed = new URL(url);
        const req = httpsRequest({
            method: 'GET',
            hostname: parsed.hostname,
            path: parsed.pathname + parsed.search,
            headers: { Authorization: `Bearer ${token}` },
            timeout: 5000,
        }, res => {
            const chunks: Buffer[] = [];
            res.on('data', c => chunks.push(c));
            res.on('end', () => {
                const body = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode && res.statusCode >= 400) {
                    reject(new Error(`vercel API HTTP ${res.statusCode}: ${body.slice(0, 200)}`));
                    return;
                }
                try { resolve(JSON.parse(body)); } catch { reject(new Error('vercel API bad JSON')); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => req.destroy(new Error('vercel API timeout')));
        req.end();
    });
}

// ---------------------------------------------------------------------------
// Firebase Functions
// ---------------------------------------------------------------------------

export interface FirebaseFunctionsSummary {
    /** Total functions deployed. */
    count: number;
    /** Most recent updateTime across all functions (ISO). */
    lastDeploy: string | null;
    /** Any functions in non-ACTIVE state. */
    unhealthy: Array<{ name: string; status: string }>;
}

/**
 * `firebase functions:list --json --project <id>`.
 *
 * Requires firebase CLI auth (handled by `firebase login` ambient). Default
 * project is `tidyscripts` (per STATUS.txt); override via $FIREBASE_PROJECT.
 */
export async function fetchFirebaseFunctions(opts: {
    timeoutMs?: number;
    project?: string;
} = {}): Promise<FetchResult<FirebaseFunctionsSummary>> {
    return timed(async () => {
        const project = opts.project ?? process.env.FIREBASE_PROJECT ?? 'tidyscripts';
        const { stdout } = await timeBox(
            execFileAsync('firebase', ['functions:list', '--json', '--project', project]),
            opts.timeoutMs ?? 8000,
            'firebase'
        );
        const parsed = JSON.parse(stdout);
        // Shape: { status: "success", result: [{ id, name, status, runtime, updateTime, ... }, ...] }
        const list: any[] = parsed?.result ?? [];
        const unhealthy = list
            .filter(f => f.status && f.status !== 'ACTIVE')
            .map(f => ({ name: f.id ?? f.name ?? '?', status: f.status }));
        const lastDeploy = list
            .map(f => f.updateTime)
            .filter(Boolean)
            .sort()
            .pop() ?? null;
        return { count: list.length, lastDeploy, unhealthy };
    });
}

// ---------------------------------------------------------------------------
// npm
// ---------------------------------------------------------------------------

/** Latest published version of a public npm package. */
export async function fetchNpmVersion(pkg: string, opts: { timeoutMs?: number } = {}): Promise<FetchResult<string>> {
    return timed(async () => {
        const { stdout } = await timeBox(
            execFileAsync('npm', ['view', pkg, 'version']),
            opts.timeoutMs ?? 5000,
            'npm'
        );
        const v = stdout.trim();
        if (!v) throw new Error('empty version response');
        return v;
    });
}

// ---------------------------------------------------------------------------
// git ls-remote (used for cloud + open public remote heads)
// ---------------------------------------------------------------------------

/** SHA at <remote>/<ref> right now. */
export async function fetchGitRemoteHead(opts: {
    cwd: string;
    remote?: string;
    ref?: string;
    timeoutMs?: number;
}): Promise<FetchResult<string>> {
    return timed(async () => {
        const { stdout } = await timeBox(
            execFileAsync('git', ['ls-remote', opts.remote ?? 'origin', opts.ref ?? 'main'], { cwd: opts.cwd }),
            opts.timeoutMs ?? 5000,
            'git-ls-remote'
        );
        const line = stdout.split('\n')[0]?.trim();
        const sha = line?.split(/\s+/)[0] ?? '';
        if (!sha) throw new Error('no SHA in ls-remote response');
        return sha;
    });
}

// ---------------------------------------------------------------------------
// Bundle: fan-out
// ---------------------------------------------------------------------------

export interface RemoteBundle {
    vercel: FetchResult<VercelDeployment>;
    firebase: FetchResult<FirebaseFunctionsSummary>;
    npm: FetchResult<string>;
    cloudOrigin: FetchResult<string>;
    openOrigin: FetchResult<string>;
}

/**
 * Fire all relevant remote fetches in parallel.
 *
 * Cloud + Vercel + Firebase only run when we have a cloud repo context;
 * npm + open-origin run regardless. Pass nullable paths to skip those.
 */
export async function fetchAllRemotes(opts: {
    cloudRoot?: string | null;
    openRoot?: string | null;
    timeoutMs?: number;
}): Promise<RemoteBundle> {
    const t = opts.timeoutMs ?? 5000;
    const [vercel, firebase, npm, cloudOrigin, openOrigin] = await Promise.all([
        opts.cloudRoot
            ? fetchVercelDeployment({ timeoutMs: t })
            : Promise.resolve<FetchResult<VercelDeployment>>({ ok: false, value: null, error: 'no cloud repo', durationMs: 0 }),
        opts.cloudRoot
            ? fetchFirebaseFunctions({ timeoutMs: t * 2 })  // firebase functions:list is slower
            : Promise.resolve<FetchResult<FirebaseFunctionsSummary>>({ ok: false, value: null, error: 'no cloud repo', durationMs: 0 }),
        fetchNpmVersion('smartchats-ai', { timeoutMs: t }),
        opts.cloudRoot
            ? fetchGitRemoteHead({ cwd: opts.cloudRoot, timeoutMs: t })
            : Promise.resolve<FetchResult<string>>({ ok: false, value: null, error: 'no cloud repo', durationMs: 0 }),
        opts.openRoot
            ? fetchGitRemoteHead({ cwd: opts.openRoot, timeoutMs: t })
            : Promise.resolve<FetchResult<string>>({ ok: false, value: null, error: 'no open repo', durationMs: 0 }),
    ]);
    return { vercel, firebase, npm, cloudOrigin, openOrigin };
}
