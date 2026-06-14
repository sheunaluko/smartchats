/**
 * `sm sync` (cloud) — sync from open repo.
 *
 * Wraps bin/sync-from-open. Surfaces the captured commit range from
 * .synced-from afterward so the maintainer sees exactly what landed.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import consola from 'consola';

import { detectRepo, readGitState } from '../lib/context.js';
import { preflight, parseCommonFlags, type PreflightCheck } from '../lib/preflight.js';
import { getExplain } from '../lib/descriptors.js';

export const syncHelp = `sm sync (cloud only) — rsync open packages + app into cloud vendored tree.

Usage:
  sm sync [--dry-run] [--yes] [--explain] [-- <bin/sync-from-open args>]

Wraps bin/sync-from-open. Forwards --dry-run + --no-install to the script.

See: sm explain sync
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

export async function runSync(argv: string[]): Promise<number> {
    if (argv.includes('-h') || argv.includes('--help')) {
        console.log(syncHelp);
        return 0;
    }
    const flags = parseCommonFlags(argv);

    const repo = detectRepo();
    if (repo.kind !== 'cloud' || !repo.root) {
        consola.error('sm sync is cloud-repo only. Run from inside ~/dev/smartchats-cloud.');
        return 1;
    }
    const script = path.join(repo.root, 'bin/sync-from-open');
    if (!fs.existsSync(script)) {
        consola.error(`bin/sync-from-open not found at ${script}`);
        return 1;
    }

    const openHome = process.env.SMARTCHATS_PATH ?? `${process.env.HOME}/dev/smartchats`;
    const openReachable = fs.existsSync(path.join(openHome, '.git'));

    const checks: PreflightCheck[] = [
        {
            label: 'open repo reachable',
            severity: openReachable ? 'pass' : 'block',
            detail: openReachable ? openHome : `${openHome} not found`,
            fix: openReachable ? undefined : 'Set $SMARTCHATS_PATH to the open repo clone.',
        },
    ];
    if (openReachable) {
        const openGit = readGitState(openHome);
        checks.push({
            label: 'open repo state',
            severity: openGit.dirty ? 'warn' : 'pass',
            detail: `${openGit.branch} (${openGit.headShort})${openGit.dirty ? ' — DIRTY' : ''}`,
            fix: openGit.dirty ? 'Open has uncommitted changes; they will be synced into cloud as-is.' : undefined,
        });
    }

    const descriptor = getExplain('sync') ?? null;
    if (!descriptor) {
        consola.error('No descriptor for sync. (Bug — report it.)');
        return 1;
    }

    const result = await preflight({
        descriptor,
        checks,
        autoConfirm: flags.yes,
        explainOnly: flags.explain,
    });
    if (!result.proceed) return result.reason === 'explain-only' ? 0 : 1;

    const args = [...flags.passthrough];
    if (flags.dryRun && !args.includes('--dry-run')) args.push('--dry-run');

    const exit = await spawnInherit(script, args, repo.root);
    if (exit === 0 && !flags.dryRun) {
        // Surface what landed.
        try {
            const synced = fs.readFileSync(path.join(repo.root, '.synced-from'), 'utf8');
            const captured = (synced.match(/^captured_commits:\s*(.+)$/m) ?? [])[1] ?? '';
            const subject = (synced.match(/^open_subject:\s*(.+)$/m) ?? [])[1] ?? '';
            console.log('');
            consola.info(`Synced through: ${subject}`);
            if (captured) consola.info(`Captured commits: ${captured}`);
        } catch { /* .synced-from missing — sync-from-open will have errored already */ }
    }
    return exit;
}
