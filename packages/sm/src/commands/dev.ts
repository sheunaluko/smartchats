/**
 * `sm dev` — start the dev environment for this repo.
 *
 * Open repo: delegates to bin/devserve (--target=surreal default).
 * Cloud repo: delegates to bin/devserve (--target=local-test default).
 *
 * Same name in both repos because the user intent is the same; the
 * underlying implementation differs because the worlds differ. The mode
 * dimensions are surfaced by `sm explain dev`.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import consola from 'consola';

import { detectRepo } from '../lib/context.js';

export const devHelp = `sm dev [-- <devserve args>]

Open repo:    delegates to bin/devserve (--target=surreal default — Docker
              SurrealDB + Express dev + Next.js dev with HMR on :3000).

Cloud repo:   delegates to bin/devserve (--target=local-test default —
              auto-syncs from open, starts cloud_test_db on :8001 + Functions
              emulator on :5001 + Next.js dev on :3000).

Flags after \`--\` are forwarded verbatim to bin/devserve.

Examples:
  sm dev
  sm dev -- --no-sync          # cloud repo: skip sync-from-open
  sm dev -- --target=aio       # open repo: full Docker AIO instead of dev
  sm dev -- --target=cloud     # cloud repo: emulator → LIVE Surreal (danger)

See: sm explain dev
`;

export async function runDev(argv: string[]): Promise<number> {
    if (argv.includes('-h') || argv.includes('--help')) {
        console.log(devHelp);
        return 0;
    }
    const dashDash = argv.indexOf('--');
    const passthrough = dashDash >= 0 ? argv.slice(dashDash + 1) : argv.filter(a => a !== '--explain');

    if (argv.includes('--explain')) {
        console.log('Use `sm explain dev` for the full descriptor.');
        return 0;
    }

    const repo = detectRepo();
    if (repo.kind === 'unknown' || !repo.root) {
        consola.error('sm dev must be run from inside an open or cloud smartchats repo.');
        return 1;
    }
    const devserve = path.join(repo.root, 'bin/devserve');
    if (!fs.existsSync(devserve)) {
        consola.error(`bin/devserve not found at ${devserve}`);
        return 1;
    }

    consola.info(`Delegating to ${devserve} (repo: ${repo.name})`);
    return new Promise<number>(resolve => {
        const child = spawn(devserve, passthrough, { cwd: repo.root!, stdio: 'inherit' });
        child.on('exit', code => resolve(code ?? 0));
        process.on('SIGINT', () => child.kill('SIGINT'));
        process.on('SIGTERM', () => child.kill('SIGTERM'));
    });
}
