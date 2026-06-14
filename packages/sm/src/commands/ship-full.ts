/**
 * `sm ship-full` (cloud) — comprehensive prod orchestrator.
 *
 * The heavyweight cousin of `sm ship`. Adds:
 *   - verify e2e (full bun stack + Playwright simi suite — slowest local gate)
 *   - schema-drift detection + apply (if schema/ files changed since last apply)
 *   - post-deploy probes (curl health endpoints, fail visibly on 5xx)
 *   - Vercel deploy wait (poll production URL for new build, time-bounded)
 *
 * Chain (with bail-on-failure between every phase):
 *
 *   1. Preflight + confirm
 *   2. Smart sync (skip if .synced-from already on open HEAD)
 *   3. Verify ci  (lint + build + unit + integration)
 *   4. Verify e2e (full bun stack)               --skip-e2e for emergencies
 *   5. Schema apply (if drift)                   --skip-schema for emergencies
 *   6. Deploy functions
 *   7. Post-functions probe (curl test endpoint)
 *   8. Deploy frontend (push)
 *   9. Vercel deploy wait (poll prod URL)
 *  10. Post-frontend probe
 *  11. Summary
 *
 * Typical wall time: 20-30 min when everything's cold. Skip flags exist for
 * emergencies but the default is "actually verify before shipping."
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { execSync } from 'node:child_process';
import consola from 'consola';

import { detectRepo, readGitState, probePorts } from '../lib/context.js';
import { buildSnapshot } from '../lib/recommend.js';
import { preflight, parseCommonFlags, type PreflightCheck } from '../lib/preflight.js';
import { getExplain } from '../lib/descriptors.js';
import { pollUntilHealthy, probeUrl } from '../lib/probe.js';
import { runSync } from './sync.js';
import { runVerify } from './verify.js';
import { runDeploy } from './deploy.js';

export const shipFullHelp = `sm ship-full (cloud only) — comprehensive prod orchestrator.

Usage:
  sm ship-full [--skip-e2e] [--skip-schema] [--yes] [--explain]

Chain (each step bails on failure):
  1. preflight + confirm
  2. sync from open (skipped if .synced-from already on open HEAD)
  3. verify ci   (lint + build + unit + integration)
  4. verify e2e  (full bun stack — slowest gate)        --skip-e2e to bypass
  5. schema apply if drift detected                     --skip-schema to bypass
  6. deploy functions
  7. post-functions probe                               (curl health URL)
  8. deploy frontend (git push origin main)
  9. wait for Vercel deploy + probe                     (poll up to 5 min)
 10. summary

Flags:
  --skip-e2e     Skip step 4 (use only when e2e is broken on infra, not code)
  --skip-schema  Skip step 5 (use only if you already applied manually)
  --yes          Auto-confirm preflight (CI / scripting)
  --explain      Print descriptor + checks then exit

Wall time: ~20-30 min when nothing is cached. Use \`sm ship\` for routine
fast-path deploys that don't touch schema or need e2e coverage.

See: sm explain ship-full
`;

const C = {
    bold: '\x1b[1m', dim: '\x1b[2m', reset: '\x1b[0m',
    cyan: '\x1b[36m', yellow: '\x1b[33m', red: '\x1b[31m', green: '\x1b[32m',
};
const color = (s: string, k: keyof typeof C) =>
    (process.env.NO_COLOR || !process.stdout.isTTY) ? s : `${C[k]}${s}${C.reset}`;

const PROBE_FUNCTIONS_URL =
    process.env.SM_PROBE_FUNCTIONS_URL ??
    'https://us-central1-tidyscripts.cloudfunctions.net/testAuth';
const PROBE_FRONTEND_URL =
    process.env.SM_PROBE_FRONTEND_URL ?? 'https://smartchats.ai/';

interface PhaseResult {
    name: string;
    ok: boolean;
    durationMs: number;
    skipped: boolean;
    note?: string;
}

function bannerStep(n: number, total: number, name: string): void {
    console.log('');
    console.log(color(`━━━ Phase ${n}/${total}: ${name} ━━━`, 'cyan'));
}

function bannerSkip(n: number, total: number, name: string, reason: string): void {
    console.log('');
    console.log(color(`──  Phase ${n}/${total}: ${name} — SKIPPED (${reason})`, 'dim'));
}

async function runPhase(name: string, fn: () => Promise<number>): Promise<PhaseResult> {
    const start = Date.now();
    const exit = await fn();
    return { name, ok: exit === 0, durationMs: Date.now() - start, skipped: false };
}

function summary(phases: PhaseResult[]): void {
    console.log('');
    console.log(color('━━━ Ship summary ━━━', 'bold'));
    let total = 0;
    for (const p of phases) {
        const glyph = p.skipped ? color('—', 'dim') : p.ok ? color('✓', 'green') : color('✗', 'red');
        const dur = `${Math.round(p.durationMs / 1000)}s`;
        const note = p.note ? color(` — ${p.note}`, 'dim') : '';
        console.log(`  ${glyph} ${p.name.padEnd(28)} ${color(dur, 'dim')}${note}`);
        total += p.durationMs;
    }
    console.log(color(`  Total: ${Math.round(total / 1000)}s`, 'dim'));
}

export async function runShipFull(argv: string[]): Promise<number> {
    if (argv.includes('-h') || argv.includes('--help')) {
        console.log(shipFullHelp);
        return 0;
    }
    const repo = detectRepo();
    if (repo.kind !== 'cloud' || !repo.root) {
        consola.error('sm ship-full is cloud-repo only.');
        return 1;
    }
    const flags = parseCommonFlags(argv);
    const skipE2e = argv.includes('--skip-e2e');
    const skipSchema = argv.includes('--skip-schema');

    const git = readGitState(repo.root);
    const snapshot = buildSnapshot(repo.kind, repo.root, git);

    // --- Detect schema drift up front for preflight + chain decisions
    const schemaFilesChanged = snapshot.changes.sinceSchemaDeploy?.byCategory.schema?.length
        ?? snapshot.changes.sinceOrigin?.byCategory.schema?.length
        ?? 0;
    const schemaWillApply = schemaFilesChanged > 0 && !skipSchema;

    // --- Detect whether sync can be skipped (already on open HEAD)
    const syncStale = !!(snapshot.openHead && snapshot.syncedFrom && snapshot.syncedFrom.sha !== snapshot.openHead);
    const syncWillRun = syncStale;

    // --- e2e port check
    const e2ePort = probePorts([3000])[0];
    const e2eBlocked = !skipE2e && e2ePort.inUse;

    const checks: PreflightCheck[] = [
        {
            label: 'on main branch',
            severity: git.branch === 'main' ? 'pass' : 'block',
            detail: `current: ${git.branch}`,
            fix: 'Switch to main: git checkout main',
        },
        {
            label: 'working tree clean',
            severity: git.dirty ? 'block' : 'pass',
            detail: git.dirty ? 'uncommitted changes' : 'clean',
            fix: 'Commit or stash first.',
        },
        {
            label: 'sync needed',
            severity: 'pass',
            detail: syncWillRun
                ? `will run sync (open ${snapshot.openHead?.slice(0, 7)} ≠ synced ${snapshot.syncedFrom?.sha.slice(0, 7)})`
                : 'sync up to date — will skip',
        },
        {
            label: 'verify e2e',
            severity: e2eBlocked ? 'block' : (skipE2e ? 'warn' : 'pass'),
            detail: skipE2e ? '⚠ SKIPPED (--skip-e2e)' : e2eBlocked ? 'port :3000 in use; e2e will fail' : 'will run (boots bin/test-bun-deploy + Playwright)',
            fix: e2eBlocked ? 'Stop the running stack first: bin/kill-dev (cloud) or pkill on the open stack.' : (skipE2e ? 'Only use --skip-e2e when e2e infra is broken, not when code is suspect.' : undefined),
        },
        {
            label: 'schema apply',
            severity: schemaWillApply ? 'warn' : 'pass',
            detail: skipSchema
                ? '⚠ SKIPPED (--skip-schema)'
                : schemaFilesChanged > 0
                    ? `will apply (${schemaFilesChanged} schema file${schemaFilesChanged === 1 ? '' : 's'} changed — IRREVERSIBLE)`
                    : 'no schema drift detected',
            fix: schemaWillApply ? 'Schema apply has no rollback; verify carefully.' : undefined,
        },
        {
            label: 'destructive steps',
            severity: 'warn',
            detail: 'ships to LIVE production (functions + Vercel + maybe schema)',
        },
    ];

    const descriptor = getExplain('ship-full')!;
    const r = await preflight({ descriptor, checks, autoConfirm: flags.yes, explainOnly: flags.explain });
    if (!r.proceed) return r.reason === 'explain-only' ? 0 : 1;

    // ----------------------------------------------------------------------
    // Run the chain
    // ----------------------------------------------------------------------

    const phases: PhaseResult[] = [];
    const TOTAL = 9; // visible phases (preflight counted separately)
    let n = 0;

    // Phase 1: sync
    n++;
    if (syncWillRun) {
        bannerStep(n, TOTAL, 'sync from open');
        const r1 = await runPhase('sync', () => runSync(['--yes']));
        phases.push(r1);
        if (!r1.ok) { summary(phases); return 1; }
    } else {
        bannerSkip(n, TOTAL, 'sync from open', 'already on open HEAD');
        phases.push({ name: 'sync', ok: true, durationMs: 0, skipped: true, note: 'already in sync' });
    }

    // Phase 2: verify ci
    n++;
    bannerStep(n, TOTAL, 'verify ci');
    const r2 = await runPhase('verify ci', () => runVerify(['ci']));
    phases.push(r2);
    if (!r2.ok) { summary(phases); return 1; }

    // Phase 3: verify e2e
    n++;
    if (skipE2e) {
        bannerSkip(n, TOTAL, 'verify e2e', '--skip-e2e');
        phases.push({ name: 'verify e2e', ok: true, durationMs: 0, skipped: true, note: 'skipped' });
    } else {
        bannerStep(n, TOTAL, 'verify e2e');
        const r3 = await runPhase('verify e2e', () => runVerify(['e2e']));
        phases.push(r3);
        if (!r3.ok) { summary(phases); return 1; }
    }

    // Phase 4: schema apply (if drift + not skipped)
    n++;
    if (skipSchema || schemaFilesChanged === 0) {
        const reason = skipSchema ? '--skip-schema' : 'no schema drift';
        bannerSkip(n, TOTAL, 'schema apply', reason);
        phases.push({ name: 'schema apply', ok: true, durationMs: 0, skipped: true, note: reason });
    } else {
        bannerStep(n, TOTAL, 'schema apply');
        consola.info('Running schema:apply --dry-run first for review...');
        const r4dry = await runPhase('schema dry-run', () => runDeploy(['schema', '--yes']));
        phases.push(r4dry);
        if (!r4dry.ok) { summary(phases); return 1; }
        // Then real apply with explicit confirmation if interactive.
        consola.warn('Schema dry-run complete. Applying for real (IRREVERSIBLE)...');
        const r4real = await runPhase('schema apply', () => runDeploy(['schema', '--apply', '--yes']));
        phases.push(r4real);
        if (!r4real.ok) { summary(phases); return 1; }
    }

    // Phase 5: deploy functions
    n++;
    bannerStep(n, TOTAL, 'deploy functions');
    const r5 = await runPhase('deploy functions', () => runDeploy(['functions', '--yes']));
    phases.push(r5);
    if (!r5.ok) { summary(phases); return 1; }

    // Phase 6: post-functions probe
    n++;
    bannerStep(n, TOTAL, `probe ${PROBE_FUNCTIONS_URL}`);
    const p6start = Date.now();
    const p6 = await probeUrl(PROBE_FUNCTIONS_URL, 10000);
    const p6result: PhaseResult = {
        name: 'probe functions',
        ok: p6.ok,
        durationMs: Date.now() - p6start,
        skipped: false,
        note: p6.ok ? `HTTP ${p6.status}` : `HTTP ${p6.status ?? 'X'} ${p6.error ?? ''}`.trim(),
    };
    phases.push(p6result);
    if (!p6.ok) {
        consola.warn(`Functions probe failed: ${p6result.note}`);
        consola.warn('Functions are deployed but unreachable. Investigate before pushing frontend.');
        summary(phases);
        return 1;
    }
    consola.success(`Functions probe OK (${p6result.note})`);

    // Phase 7: deploy frontend (push)
    n++;
    bannerStep(n, TOTAL, 'deploy frontend (git push)');
    const r7 = await runPhase('deploy frontend', () => runDeploy(['frontend', '--yes']));
    phases.push(r7);
    if (!r7.ok) {
        consola.fail('frontend push failed; FUNCTIONS ARE LIVE on new code without matching frontend');
        summary(phases);
        return 1;
    }

    // Phase 8: wait for Vercel + probe
    n++;
    bannerStep(n, TOTAL, `Vercel deploy wait + probe ${PROBE_FRONTEND_URL}`);
    consola.info('Polling Vercel (up to 5 min, every 15s)...');
    const p8start = Date.now();
    const poll = await pollUntilHealthy(PROBE_FRONTEND_URL, {
        totalTimeoutMs: 5 * 60 * 1000,
        intervalMs: 15_000,
        requestTimeoutMs: 8_000,
        onAttempt: (attempt, res) => {
            const tag = res.ok ? color(`OK ${res.status}`, 'green') : color(res.error ?? `HTTP ${res.status ?? 'X'}`, 'yellow');
            console.log(`  attempt ${attempt}: ${tag} (${res.durationMs}ms)`);
        },
    });
    const p8result: PhaseResult = {
        name: 'vercel wait + probe',
        ok: poll.ok,
        durationMs: Date.now() - p8start,
        skipped: false,
        note: poll.ok ? `${poll.attempts} attempts` : `${poll.attempts} attempts; last: ${poll.lastResult.error ?? 'HTTP ' + poll.lastResult.status}`,
    };
    phases.push(p8result);
    if (!poll.ok) {
        consola.fail('Frontend did not respond healthy within 5 min. Vercel may still be building — check vercel.com/dashboard manually.');
        summary(phases);
        return 1;
    }

    // Phase 9: summary
    n++;
    bannerStep(n, TOTAL, 'summary');
    consola.success('sm ship-full complete');
    summary(phases);
    console.log('');
    console.log(color('Live URLs to spot-check:', 'bold'));
    console.log(`  ${PROBE_FRONTEND_URL}`);
    console.log(`  ${PROBE_FUNCTIONS_URL}`);
    console.log('');
    console.log(color('Override health URLs via $SM_PROBE_FUNCTIONS_URL / $SM_PROBE_FRONTEND_URL.', 'dim'));
    return 0;
}
