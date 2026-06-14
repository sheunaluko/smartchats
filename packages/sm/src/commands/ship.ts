/**
 * `sm ship` (cloud) — the single-command full deploy.
 *
 * Sequence: sync → verify ci → deploy functions → deploy frontend (push).
 * Each step preflights itself and bails on first failure.
 *
 * The verify level is `ci` by default (quick + unit + integration; ~2 min).
 * Use --quick-verify to drop to `quick` (lint + build only) when iterating.
 */

import consola from 'consola';

import { detectRepo } from '../lib/context.js';
import { preflight, parseCommonFlags, type PreflightCheck } from '../lib/preflight.js';
import { getExplain } from '../lib/descriptors.js';
import { runSync } from './sync.js';
import { runVerify } from './verify.js';
import { runDeploy } from './deploy.js';

export const shipHelp = `sm ship (cloud only) — sync + verify + deploy functions + push frontend.

Usage:
  sm ship [--quick-verify] [--skip-verify] [--yes] [--explain]

Flags:
  --quick-verify  Use verify level "quick" (lint + build only) instead of "ci"
  --skip-verify   Skip the verify step entirely (NOT RECOMMENDED — debugging only)
  --yes           Auto-confirm every preflight (CI / scripting)
  --explain       Print descriptor + checks then exit

What it does, in order:
  1. sm sync                 (rsync open → cloud)
  2. sm verify ci            (or --quick-verify → quick; or --skip-verify → skip)
  3. sm deploy functions     (firebase deploy)
  4. sm deploy frontend      (git push origin main → Vercel auto-deploys)

Bails on first failure with clear messaging.

See: sm explain ship
`;

export async function runShip(argv: string[]): Promise<number> {
    if (argv.includes('-h') || argv.includes('--help')) {
        console.log(shipHelp);
        return 0;
    }
    const repo = detectRepo();
    if (repo.kind !== 'cloud' || !repo.root) {
        consola.error('sm ship is cloud-repo only.');
        return 1;
    }

    const flags = parseCommonFlags(argv);
    const quickVerify = argv.includes('--quick-verify');
    const skipVerify = argv.includes('--skip-verify');
    const verifyLevel = skipVerify ? null : (quickVerify ? 'quick' : 'ci');

    // Top-level ship preflight — checks before kicking off the chain.
    const checks: PreflightCheck[] = [
        {
            label: 'verify plan',
            severity: skipVerify ? 'warn' : 'pass',
            detail: skipVerify ? '⚠ SKIPPED' : `will run: sm verify ${verifyLevel}`,
            fix: skipVerify ? 'Only use --skip-verify when you have already verified manually.' : undefined,
        },
        {
            label: 'destructive steps',
            severity: 'warn',
            detail: 'this command deploys to LIVE production (functions + Vercel)',
        },
    ];
    const descriptor = getExplain('ship')!;
    const r = await preflight({ descriptor, checks, autoConfirm: flags.yes, explainOnly: flags.explain });
    if (!r.proceed) return r.reason === 'explain-only' ? 0 : 1;

    // Step 1: sync
    consola.start('sm ship → sync');
    const syncExit = await runSync(['--yes']);
    if (syncExit !== 0) { consola.fail('sync failed; aborting ship'); return syncExit; }

    // Step 2: verify
    if (verifyLevel) {
        consola.start(`sm ship → verify ${verifyLevel}`);
        const verifyExit = await runVerify([verifyLevel]);
        if (verifyExit !== 0) { consola.fail(`verify ${verifyLevel} failed; aborting ship`); return verifyExit; }
    } else {
        consola.warn('sm ship → verify SKIPPED (--skip-verify)');
    }

    // Step 3: deploy functions
    consola.start('sm ship → deploy functions');
    const funcExit = await runDeploy(['functions', '--yes']);
    if (funcExit !== 0) { consola.fail('functions deploy failed; frontend NOT pushed'); return funcExit; }

    // Step 4: deploy frontend (push)
    consola.start('sm ship → deploy frontend');
    const fexit = await runDeploy(['frontend', '--yes']);
    if (fexit !== 0) { consola.fail('frontend push failed; functions ARE deployed'); return fexit; }

    consola.success('sm ship complete — Vercel will pick up the push within ~1 minute');
    return 0;
}
