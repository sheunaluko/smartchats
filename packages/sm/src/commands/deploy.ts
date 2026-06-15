/**
 * `sm deploy <target>` (cloud) — functions / frontend / schema / all.
 *
 * Every target routes through preflight first: descriptor + checks + Y/n.
 *
 *   functions  → bin/deploy-functions
 *                  Refuses unless .env → .env.cloud, on main, clean tree,
 *                  last verify fresh (same HEAD).
 *
 *   frontend   → git push origin main (Vercel auto-deploys)
 *                  Refuses unless clean tree, on main, ahead of origin.
 *
 *   schema     → npm run schema:apply in packages/smartchats-cloud
 *                  Hard-defaults to --dry-run. Requires --apply to commit.
 *                  Refuses without SMARTCHATS_CLOUD_URL / USER / PASSWORD.
 *
 *   all        → functions, then frontend (push). Bails on first failure.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import consola from 'consola';

import {
    detectRepo,
    readGitState,
    readFunctionsEnvSymlink,
    readLastVerify,
} from '../lib/context.js';
import { preflight, parseCommonFlags, type PreflightCheck } from '../lib/preflight.js';
import { getExplain } from '../lib/descriptors.js';
import { writeLastDeploy, type DeployTarget } from '../lib/last-deploy.js';

function recordDeploy(repo: 'open' | 'cloud', root: string, target: DeployTarget): void {
    const git = readGitState(root);
    writeLastDeploy({
        repo,
        target,
        head: git.head,
        timestamp: new Date().toISOString(),
    });
}

export const deployHelp = `sm deploy <target> (cloud only) — deploy something.

Targets:
  functions    Firebase Functions + Firestore indexes (bin/deploy-functions)
  frontend     git push origin main (Vercel auto-deploys)
  schema       SurrealDB DDL apply (defaults to --dry-run; use --apply to commit)
  all          functions, then frontend

Flags:
  --yes        skip the preflight confirm prompt (for scripts/CI)
  --explain    print descriptor + checks then exit (no execution)
  --dry-run    (schema) print SQL without applying; (others) refuse
  --apply      (schema only) actually commit the schema apply
  --           forward args to the wrapped script

Examples:
  sm deploy functions
  sm deploy frontend
  sm deploy schema                # dry-run
  sm deploy schema --apply --yes  # commit, no prompt
  sm deploy all

See: sm explain deploy [target]
`;

function spawnInherit(cmd: string, args: string[], cwd: string, extraEnv: NodeJS.ProcessEnv = {}): Promise<number> {
    return new Promise(resolve => {
        const child = spawn(cmd, args, { cwd, stdio: 'inherit', env: { ...process.env, ...extraEnv } });
        child.on('exit', code => resolve(code ?? 1));
        const fwd = (sig: NodeJS.Signals) => child.kill(sig);
        process.on('SIGINT', fwd);
        process.on('SIGTERM', fwd);
    });
}

// ---------------------------------------------------------------------------
// Shared checks
// ---------------------------------------------------------------------------

function checkCleanTree(root: string): PreflightCheck {
    const git = readGitState(root);
    return {
        label: 'working tree clean',
        severity: git.dirty ? 'block' : 'pass',
        detail: git.dirty ? 'uncommitted changes present' : 'clean',
        fix: git.dirty ? 'Commit or stash first: bin/checkpoint "wip"' : undefined,
    };
}

function checkOnMain(root: string): PreflightCheck {
    const git = readGitState(root);
    return {
        label: 'on main branch',
        severity: git.branch === 'main' ? 'pass' : 'block',
        detail: `current: ${git.branch}`,
        fix: git.branch === 'main' ? undefined : 'Switch to main: git checkout main',
    };
}

function checkAheadOfOrigin(root: string): PreflightCheck {
    const git = readGitState(root);
    if (git.ahead > 0) {
        return {
            label: 'commits to push',
            severity: 'pass',
            detail: `${git.ahead} ahead of origin/main`,
        };
    }
    return {
        label: 'commits to push',
        severity: 'block',
        detail: 'no commits ahead of origin/main',
        fix: 'Nothing to deploy — make a commit first.',
    };
}

function checkLastVerifyFresh(repoKind: 'open' | 'cloud', currentHead: string): PreflightCheck {
    const last = readLastVerify(repoKind);
    if (!last) {
        return {
            label: 'verify cached',
            severity: 'block',
            detail: 'no verify ever cached',
            fix: 'Run `sm verify ci` (or `sm verify quick` for a faster gate).',
        };
    }
    if (!last.ok) {
        return {
            label: 'verify result',
            severity: 'block',
            detail: `last verify (${last.level}) FAILED`,
            fix: 'Fix the failures and re-run `sm verify`.',
        };
    }
    if (last.head !== currentHead) {
        return {
            label: 'verify on current HEAD',
            severity: 'block',
            detail: `last verify on ${last.head.slice(0, 7)}, HEAD is ${currentHead.slice(0, 7)}`,
            fix: 'Re-run `sm verify` against current HEAD.',
        };
    }
    return {
        label: 'verify cached',
        severity: 'pass',
        detail: `${last.level} passed on ${last.head.slice(0, 7)}`,
    };
}

/**
 * Cloud functions deploy doesn't need its OWN verify to have passed — the
 * verify that matters happened in open, before the sync. This check:
 *
 *   1. Reads .synced-from to find the open SHA that was rsynced in.
 *   2. Reads ~/.smartchats/sm/last-verify-open.json.
 *   3. Confirms the open verify passed against the synced SHA.
 *
 * Blocks the deploy with an actionable message at the first failing step.
 * Pass detail surfaces what's known so the maintainer can sanity-check.
 *
 * Used by `sm deploy functions` (cloud-only). Verify in cloud is currently
 * limited — `bin/test-e2e` doesn't exist there — so requiring a fresh
 * cloud verify would force a workaround (level=ci, etc.). Open is the
 * canonical place verify happens; cloud just needs to know it did.
 */
function checkOpenVerifyForSyncedCode(cloudRoot: string): PreflightCheck {
    // .synced-from is written by bin/sync-from-open with the open SHA at sync time.
    let openSha = '';
    let syncedAt = '';
    let subject = '';
    try {
        const raw = fs.readFileSync(path.join(cloudRoot, '.synced-from'), 'utf8');
        openSha = raw.match(/^open_sha:\s*(.+)$/m)?.[1]?.trim() ?? '';
        syncedAt = raw.match(/^synced_at:\s*(.+)$/m)?.[1]?.trim() ?? '';
        subject  = raw.match(/^open_subject:\s*(.+)$/m)?.[1]?.trim() ?? '';
    } catch {
        return {
            label: 'sync state',
            severity: 'block',
            detail: 'no .synced-from in cloud repo',
            fix: 'Run `sm sync` first — synced code is the deploy unit.',
        };
    }

    if (!openSha) {
        return {
            label: 'sync state',
            severity: 'block',
            detail: '.synced-from missing open_sha field',
            fix: 'Re-run `sm sync` to regenerate .synced-from.',
        };
    }

    const openVerify = readLastVerify('open');
    if (!openVerify) {
        return {
            label: 'open verify',
            severity: 'block',
            detail: 'no open verify ever cached (cloud reads ~/.smartchats/sm/last-verify-open.json)',
            fix: 'In open repo: `sm verify`',
        };
    }
    if (!openVerify.ok) {
        return {
            label: 'open verify',
            severity: 'block',
            detail: `open's last verify (${openVerify.level}) FAILED on ${openVerify.head.slice(0, 7)}`,
            fix: 'In open repo: fix the failures and re-run `sm verify`.',
        };
    }
    if (openVerify.head !== openSha) {
        return {
            label: 'open verify SHA',
            severity: 'block',
            detail: `synced from open ${openSha.slice(0, 7)} but open verify is on ${openVerify.head.slice(0, 7)}`,
            fix: 'Either re-sync (`sm sync`) so cloud has the verified code, or re-run `sm verify` in open against the current state.',
        };
    }

    const syncedAtDisplay = syncedAt || '(unknown)';
    const subjectDisplay = subject ? ` — "${subject.slice(0, 50)}${subject.length > 50 ? '…' : ''}"` : '';
    return {
        label: 'open verify + sync',
        severity: 'pass',
        detail: `open ${openVerify.level} passed on ${openSha.slice(0, 7)}${subjectDisplay} (synced ${syncedAtDisplay})`,
    };
}

function checkFunctionsEnvDeployable(cloudRoot: string): PreflightCheck {
    const env = readFunctionsEnvSymlink(cloudRoot);
    if (env.symlinkTarget === '.env.cloud') {
        return {
            label: 'functions/.env',
            severity: 'pass',
            detail: '→ .env.cloud (deploy-ready)',
        };
    }
    return {
        label: 'functions/.env',
        severity: 'warn',
        detail: `→ ${env.symlinkTarget}; ./deploy will force the symlink to .env.cloud`,
        fix: '(no action — the deploy script handles it; just be aware live keys will land in functions/.env)',
    };
}

// ---------------------------------------------------------------------------
// Per-target implementations
// ---------------------------------------------------------------------------

async function deployFunctions(cloudRoot: string, flags: ReturnType<typeof parseCommonFlags>): Promise<number> {
    const script = path.join(cloudRoot, 'bin/deploy-functions');
    if (!fs.existsSync(script)) {
        consola.error(`bin/deploy-functions not found at ${script}`);
        return 1;
    }
    const checks: PreflightCheck[] = [
        checkOnMain(cloudRoot),
        checkCleanTree(cloudRoot),
        // Cloud functions deploy gates on OPEN's verify state, not cloud's:
        // open is where verify runs (cloud has no bin/test-e2e); sync brought
        // the verified code over; deploy just ships it.
        checkOpenVerifyForSyncedCode(cloudRoot),
        checkFunctionsEnvDeployable(cloudRoot),
    ];
    const descriptor = getExplain('deploy', 'functions')!;
    const r = await preflight({ descriptor, checks, autoConfirm: flags.yes, explainOnly: flags.explain });
    if (!r.proceed) return r.reason === 'explain-only' ? 0 : 1;
    const exit = await spawnInherit(script, flags.passthrough, cloudRoot);
    if (exit === 0) recordDeploy('cloud', cloudRoot, 'functions');
    return exit;
}

async function deployFrontend(cloudRoot: string, flags: ReturnType<typeof parseCommonFlags>): Promise<number> {
    if (flags.dryRun) {
        consola.error('sm deploy frontend does not support --dry-run (it is a `git push`). Use `git push --dry-run` directly to preview.');
        return 1;
    }
    const checks: PreflightCheck[] = [
        checkOnMain(cloudRoot),
        checkCleanTree(cloudRoot),
        // Same provenance gate as deploy functions — open is where verify
        // happens, sync brought the verified code over, this push ships it
        // to Vercel.
        checkOpenVerifyForSyncedCode(cloudRoot),
        checkAheadOfOrigin(cloudRoot),
    ];
    const descriptor = getExplain('deploy', 'frontend')!;
    const r = await preflight({ descriptor, checks, autoConfirm: flags.yes, explainOnly: flags.explain });
    if (!r.proceed) return r.reason === 'explain-only' ? 0 : 1;
    const exit = await spawnInherit('git', ['push', 'origin', 'main', ...flags.passthrough], cloudRoot);
    if (exit === 0) recordDeploy('cloud', cloudRoot, 'frontend');
    return exit;
}

async function deploySchema(cloudRoot: string, flags: ReturnType<typeof parseCommonFlags>): Promise<number> {
    const apply = flags.positional.includes('--apply') || process.argv.includes('--apply');
    const cloudPackageDir = path.join(cloudRoot, 'packages/smartchats-cloud');
    if (!fs.existsSync(path.join(cloudPackageDir, 'package.json'))) {
        consola.error(`packages/smartchats-cloud not found at ${cloudPackageDir}`);
        return 1;
    }

    const requiredEnv = ['SMARTCHATS_CLOUD_URL', 'SMARTCHATS_CLOUD_USER', 'SMARTCHATS_CLOUD_PASSWORD'];
    const envChecks: PreflightCheck[] = requiredEnv.map(v => ({
        label: `env: ${v}`,
        severity: process.env[v] ? 'pass' : 'block',
        detail: process.env[v] ? 'set' : 'not set',
        fix: process.env[v] ? undefined : `Set ${v} (cloud root creds) before running.`,
    }));

    const modeCheck: PreflightCheck = apply
        ? { label: 'mode', severity: 'warn', detail: '--apply: WILL commit DDL changes', fix: 'Cannot rollback — schema migrations are idempotent only. Snapshot first if uncertain.' }
        : { label: 'mode', severity: 'pass', detail: '--dry-run (default; pass --apply to commit)' };

    const checks: PreflightCheck[] = [
        ...envChecks,
        modeCheck,
    ];
    const descriptor = getExplain('deploy', 'schema')!;
    const r = await preflight({ descriptor, checks, autoConfirm: flags.yes, explainOnly: flags.explain });
    if (!r.proceed) return r.reason === 'explain-only' ? 0 : 1;

    const args = ['run', 'schema:apply'];
    if (!apply) args.push('--', '--dry-run');
    const exit = await spawnInherit('npm', args, cloudPackageDir);
    if (exit === 0 && apply) recordDeploy('cloud', cloudRoot, 'schema');
    return exit;
}

async function deployAll(cloudRoot: string, flags: ReturnType<typeof parseCommonFlags>): Promise<number> {
    consola.info('sm deploy all → functions');
    const f = await deployFunctions(cloudRoot, flags);
    if (f !== 0) {
        consola.fail('functions deploy failed; skipping frontend');
        return f;
    }
    consola.info('sm deploy all → frontend');
    return await deployFrontend(cloudRoot, flags);
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export async function runDeploy(argv: string[]): Promise<number> {
    if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
        console.log(deployHelp);
        return argv.length === 0 ? 1 : 0;
    }
    const flags = parseCommonFlags(argv);
    const target = flags.positional[0];
    if (!target) {
        consola.error('Specify a target: functions | frontend | schema | all');
        return 1;
    }

    const repo = detectRepo();
    if (repo.kind !== 'cloud' || !repo.root) {
        consola.error('sm deploy is cloud-repo only.');
        return 1;
    }

    switch (target) {
        case 'functions': return deployFunctions(repo.root, flags);
        case 'frontend': return deployFrontend(repo.root, flags);
        case 'schema': return deploySchema(repo.root, flags);
        case 'all': return deployAll(repo.root, flags);
        default:
            consola.error(`Unknown deploy target: ${target}`);
            console.log(deployHelp);
            return 1;
    }
}
