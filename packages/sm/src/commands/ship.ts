/**
 * `sm ship` (cloud) — the single-command full deploy.
 *
 * Sequence: sync → check open-verify gate → deploy functions → deploy frontend.
 *
 * Cloud doesn't re-run verify locally — bin/test-e2e lives in open only
 * and the code being shipped IS open's code (rsynced in). The
 * "verify step" is now a gate check that confirms open's verify cache
 * matches the synced SHA. Failure modes (open didn't verify; verify
 * FAILED; verify was at a different SHA) all surface with concrete
 * fixes via sm/lib/open_verify_gate.ts.
 *
 * --skip-verify still bypasses the gate for emergency hotfixes.
 * --quick-verify is a no-op alias for backwards compatibility.
 */

import consola from 'consola';

import { detectRepo } from '../lib/context.js';
import { preflight, parseCommonFlags, type PreflightCheck } from '../lib/preflight.js';
import { getExplain } from '../lib/descriptors.js';
import { computeOpenVerifyGate, openVerifyGateAsCheck } from '../lib/open_verify_gate.js';
import { runSync } from './sync.js';
import { runDeploy } from './deploy.js';

export const shipHelp = `sm ship (cloud only) — sync + check open-verify + deploy functions + push frontend.

Usage:
  sm ship [--skip-verify] [--yes] [--explain]

Flags:
  --skip-verify   Skip the open-verify gate (emergency hotfix only).
  --yes           Auto-confirm every preflight (CI / scripting).
  --explain       Print descriptor + checks then exit.

What it does, in order:
  1. sm sync                 (rsync open → cloud, updates .synced-from)
  2. open-verify gate        (confirms open verified the synced SHA;
                              cloud does NOT re-run verify — bin/test-e2e
                              lives only in open)
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
    const skipVerify = argv.includes('--skip-verify');
    // --quick-verify is silently accepted for backwards compatibility — no
    // longer meaningful since we're not re-running verify in cloud.

    // Top-level ship preflight — checks before kicking off the chain.
    const checks: PreflightCheck[] = [
        {
            label: 'verify plan',
            severity: skipVerify ? 'warn' : 'pass',
            detail: skipVerify
                ? '⚠ open-verify gate SKIPPED'
                : 'will check open-verify gate after sync (cloud does not re-run verify)',
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

    // Step 2: open-verify gate. Reads .synced-from (just updated by sync) +
    // ~/.smartchats/sm/last-verify-open.json. Cheap.
    if (!skipVerify) {
        consola.start('sm ship → open-verify gate');
        const gate = computeOpenVerifyGate(repo.root);
        const check = openVerifyGateAsCheck(gate);
        if (check.severity === 'block') {
            consola.fail(`${check.label}: ${check.detail}`);
            if (check.fix) consola.info(`  → ${check.fix}`);
            return 1;
        }
        consola.success(`open-verify gate OK: ${check.detail}`);
    } else {
        consola.warn('sm ship → open-verify gate SKIPPED (--skip-verify)');
    }

    // Step 3: deploy functions (will run its own open-verify gate too — belt-and-braces)
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
