/**
 * `sm verify [level]` — unified test entry point.
 *
 * Levels and how they map today:
 *
 *   quick / lint / build / unit / integration / e2e / install / stripe / all / ci
 *
 *   quick        → `npx smartchats-test quick`
 *   lint         → `npx smartchats-test lint`
 *   build        → `npx smartchats-test build`
 *   unit         → `npx smartchats-test unit`
 *   integration  → `npx smartchats-test integration` (today: stub; promotion of
 *                   verify_surreal_rpc_path.ts is open follow-on per STATUS ★)
 *   e2e          → `bin/test-e2e` (orchestrates bin/test-bun-deploy + Playwright)
 *   install      → `scripts/test-install.sh` (open repo only)
 *   stripe       → `bin/test-stripe` (cloud repo only; preflight terminals required)
 *   all          → quick + unit + integration + e2e + (cloud: stripe)
 *   ci           → quick + unit + integration (curated CI set)
 *
 * After each run, cache the result at ~/.smartchats/sm/last-verify-<repo>.json
 * so `sm status` and `sm ship` can read it.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import consola from 'consola';

import { detectRepo, writeLastVerify, readGitState } from '../lib/context.js';

export const verifyHelp = `sm verify [level] [--explain] [-- <passthrough>]

Levels:
  quick         lint + build (default; ~30s; pre-commit gate)
  lint          turbo run lint
  build         turbo run build (type-check via emit)
  unit          vitest in packages with test:unit
  integration   wire-format / DB integration tests (self-managed surreal)
  e2e           bin/test-e2e — full Playwright simi suite on native binaries
  install       scripts/test-install.sh — tarball + Docker rehearsal (open repo)
  stripe        bin/test-stripe — sandbox lifecycle (cloud repo, prerequisites)
  all           everything applicable in this repo
  ci            curated CI set: quick + unit + integration

Flags:
  --explain     print what this verb would do, then exit (no execution)
  --            forward remaining args to the underlying runner

Examples:
  sm verify
  sm verify e2e
  sm verify all
  sm verify e2e -- --headed --workers 1
  sm verify --explain

See: sm explain verify [level]
`;

interface RunResult {
    ok: boolean;
    durationMs: number;
}

function spawnInherit(cmd: string, args: string[], cwd: string): Promise<number> {
    return new Promise(resolve => {
        const child = spawn(cmd, args, { cwd, stdio: 'inherit', shell: false });
        child.on('exit', code => resolve(code ?? 1));
        child.on('error', err => {
            consola.error(`Failed to spawn ${cmd}:`, err.message);
            resolve(1);
        });
        const fwd = (sig: NodeJS.Signals) => child.kill(sig);
        process.on('SIGINT', fwd);
        process.on('SIGTERM', fwd);
    });
}

async function runLevel(level: string, repoRoot: string, passthrough: string[]): Promise<RunResult> {
    const start = Date.now();
    let exit = 0;

    switch (level) {
        case 'quick':
        case 'lint':
        case 'build':
        case 'unit':
        case 'integration':
            exit = await spawnInherit('npx', ['smartchats-test', level, ...passthrough], repoRoot);
            break;

        case 'e2e': {
            const testE2e = path.join(repoRoot, 'bin/test-e2e');
            if (!fs.existsSync(testE2e)) {
                consola.error(`bin/test-e2e not found at ${testE2e}`);
                consola.info('e2e level is currently open-repo only (wraps bin/test-bun-deploy + Playwright).');
                exit = 1;
                break;
            }
            exit = await spawnInherit(testE2e, passthrough, repoRoot);
            break;
        }

        case 'install': {
            const installSh = path.join(repoRoot, 'scripts/test-install.sh');
            if (!fs.existsSync(installSh)) {
                consola.error(`scripts/test-install.sh not found at ${installSh}`);
                exit = 1;
                break;
            }
            exit = await spawnInherit(installSh, passthrough, repoRoot);
            break;
        }

        case 'stripe': {
            const testStripe = path.join(repoRoot, 'bin/test-stripe');
            if (!fs.existsSync(testStripe)) {
                consola.error(`bin/test-stripe not found at ${testStripe}`);
                consola.info('stripe level is cloud-repo only.');
                exit = 1;
                break;
            }
            exit = await spawnInherit(testStripe, passthrough, repoRoot);
            break;
        }

        case 'all': {
            // Sequential bail-on-first-failure.
            for (const sub of ['quick', 'unit', 'integration', 'e2e']) {
                consola.info(`sm verify all → ${sub}`);
                const r = await runLevel(sub, repoRoot, []);
                if (!r.ok) { exit = 1; break; }
            }
            break;
        }

        case 'ci': {
            for (const sub of ['quick', 'unit', 'integration']) {
                consola.info(`sm verify ci → ${sub}`);
                const r = await runLevel(sub, repoRoot, []);
                if (!r.ok) { exit = 1; break; }
            }
            break;
        }

        default:
            consola.error(`Unknown level: ${level}`);
            consola.info('Run `sm verify --help` for the list.');
            exit = 1;
    }

    return { ok: exit === 0, durationMs: Date.now() - start };
}

export async function runVerify(argv: string[]): Promise<number> {
    if (argv.includes('-h') || argv.includes('--help')) {
        console.log(verifyHelp);
        return 0;
    }

    const explain = argv.includes('--explain');
    const dashDash = argv.indexOf('--');
    const passthrough = dashDash >= 0 ? argv.slice(dashDash + 1) : [];
    const positional = (dashDash >= 0 ? argv.slice(0, dashDash) : argv)
        .filter(a => !a.startsWith('--'));
    const level = positional[0] ?? 'quick';

    if (explain) {
        // Delegated to the explain command via main router; print short notice.
        console.log(`Use \`sm explain verify ${level}\` for the full descriptor.`);
        return 0;
    }

    const repo = detectRepo();
    if (repo.kind === 'unknown' || !repo.root) {
        consola.error('sm verify must be run from inside an open or cloud smartchats repo.');
        return 1;
    }

    consola.start(`sm verify ${level} (repo: ${repo.name})`);
    const result = await runLevel(level, repo.root, passthrough);
    const git = readGitState(repo.root);

    writeLastVerify({
        repo: repo.kind,
        level,
        ok: result.ok,
        timestamp: new Date().toISOString(),
        head: git.head,
        durationMs: result.durationMs,
    });

    if (result.ok) {
        consola.success(`sm verify ${level} passed in ${Math.round(result.durationMs / 1000)}s`);
        return 0;
    }
    consola.fail(`sm verify ${level} FAILED after ${Math.round(result.durationMs / 1000)}s`);
    return 1;
}
