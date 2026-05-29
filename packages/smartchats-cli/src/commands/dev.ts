/**
 * `smartchats dev` — hot-reload development stack.
 *
 * Interim implementation: shells out to `bin/devserve --target=surreal` in
 * the resolved repo. `devserve` already orchestrates SurrealDB + Express +
 * Next.js dev with HMR; reimplementing it in TS is Phase-later work. The
 * CLI's job here is to give devs the same one-command UX as start / stop /
 * status whether they want production or dev mode.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import consola from 'consola';

import { detectContext, requireRepo } from '../lib/context.js';

export function devHelp(): string {
    return `smartchats dev — hot-reload development stack (delegates to bin/devserve)

Usage:
  smartchats dev [-- <devserve args>]

Anything after \`--\` is forwarded verbatim to bin/devserve. See:
  bin/devserve --help

Examples:
  smartchats dev
  smartchats dev -- --port=3030
  smartchats dev -- --target=aio --rebuild
`;
}

export interface DevArgs {
    /** Args passed through to bin/devserve. */
    passthrough: string[];
}

export function parseDevArgs(rest: string[]): DevArgs {
    const dashDash = rest.indexOf('--');
    if (rest.includes('-h') || rest.includes('--help')) {
        console.log(devHelp()); process.exit(0);
    }
    return { passthrough: dashDash >= 0 ? rest.slice(dashDash + 1) : [] };
}

export async function runDev(args: DevArgs): Promise<number> {
    const ctx = detectContext();
    const root = requireRepo(ctx);
    const devserve = path.join(root, 'bin/devserve');
    if (!fs.existsSync(devserve)) {
        consola.error(`bin/devserve not found at ${devserve}`);
        consola.info('This command requires running from a smartchats source checkout.');
        return 1;
    }
    consola.info(`Delegating to ${devserve}`);
    return new Promise<number>((resolve) => {
        const child = spawn(devserve, args.passthrough, { cwd: root, stdio: 'inherit' });
        child.on('exit', (code) => resolve(code ?? 0));
        process.on('SIGINT', () => child.kill('SIGINT'));
        process.on('SIGTERM', () => child.kill('SIGTERM'));
    });
}
