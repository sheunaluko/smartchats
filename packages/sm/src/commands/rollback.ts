/**
 * `sm rollback <target>` (cloud) — roll back functions or frontend.
 *
 *   functions  → firebase functions are not single-rollback-able; the
 *                canonical path is `firebase deploy` of an earlier git SHA.
 *                We list recent deploys + tell the user the steps.
 *
 *   frontend   → vercel rollback (uses Vercel CLI; lists recent deploys
 *                and prompts).
 *
 * Phase 2 keeps these as guided manual flows (because both CLIs are
 * interactive and have good UX). Phase 4 might add a true automated path.
 */

import { spawn, execSync } from 'node:child_process';
import * as path from 'node:path';
import consola from 'consola';

import { detectRepo } from '../lib/context.js';
import { preflight, parseCommonFlags, type PreflightCheck } from '../lib/preflight.js';
import { getExplain } from '../lib/descriptors.js';

export const rollbackHelp = `sm rollback <target> (cloud only) — roll back a deployment.

Targets:
  functions   Guided rollback: show recent commits touching functions/,
              then deploy a chosen earlier SHA via firebase deploy.
              (Firebase has no single-command rollback for Functions.)
  frontend    Delegates to \`vercel rollback\` — lists recent production
              deploys and prompts.

Flags:
  --yes       skip preflight prompt (still interactive for the CLI itself)
  --explain   print descriptor + checks then exit
`;

function spawnInherit(cmd: string, args: string[], cwd: string): Promise<number> {
    return new Promise(resolve => {
        const child = spawn(cmd, args, { cwd, stdio: 'inherit' });
        child.on('exit', code => resolve(code ?? 1));
        const fwd = (sig: NodeJS.Signals) => child.kill(sig);
        process.on('SIGINT', fwd);
        process.on('SIGTERM', fwd);
    });
}

async function rollbackFunctions(cloudRoot: string, flags: ReturnType<typeof parseCommonFlags>): Promise<number> {
    const checks: PreflightCheck[] = [
        { label: 'firebase CLI', severity: 'pass', detail: 'available (assumed)' },
    ];
    const descriptor = getExplain('rollback', 'functions')!;
    const r = await preflight({ descriptor, checks, autoConfirm: flags.yes, explainOnly: flags.explain });
    if (!r.proceed) return r.reason === 'explain-only' ? 0 : 1;

    // Show recent commits touching functions/ so the user can pick.
    consola.info('Recent commits touching packages/smartchats-cloud/functions/:');
    try {
        const log = execSync(
            'git log --oneline -10 -- packages/smartchats-cloud/functions',
            { cwd: cloudRoot, encoding: 'utf8' },
        );
        console.log(log);
    } catch {
        consola.warn('(could not read git log)');
    }
    consola.info('To roll back, check out a chosen SHA and re-run `sm deploy functions`:');
    console.log('  git checkout <sha>');
    console.log('  sm deploy functions');
    console.log('  git checkout main   # then handle the divergence manually');
    return 0;
}

async function rollbackFrontend(cloudRoot: string, flags: ReturnType<typeof parseCommonFlags>): Promise<number> {
    const checks: PreflightCheck[] = [
        { label: 'vercel CLI', severity: 'pass', detail: 'available (assumed; will error if missing)' },
    ];
    const descriptor = getExplain('rollback', 'frontend')!;
    const r = await preflight({ descriptor, checks, autoConfirm: flags.yes, explainOnly: flags.explain });
    if (!r.proceed) return r.reason === 'explain-only' ? 0 : 1;
    return await spawnInherit('vercel', ['rollback', ...flags.passthrough], cloudRoot);
}

export async function runRollback(argv: string[]): Promise<number> {
    if (argv.length === 0 || argv.includes('-h') || argv.includes('--help')) {
        console.log(rollbackHelp);
        return argv.length === 0 ? 1 : 0;
    }
    const flags = parseCommonFlags(argv);
    const target = flags.positional[0];
    if (!target) {
        consola.error('Specify a target: functions | frontend');
        return 1;
    }

    const repo = detectRepo();
    if (repo.kind !== 'cloud' || !repo.root) {
        consola.error('sm rollback is cloud-repo only.');
        return 1;
    }

    switch (target) {
        case 'functions': return rollbackFunctions(repo.root, flags);
        case 'frontend': return rollbackFrontend(repo.root, flags);
        default:
            consola.error(`Unknown rollback target: ${target}`);
            console.log(rollbackHelp);
            return 1;
    }
}
