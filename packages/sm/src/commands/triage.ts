/**
 * `sm triage [local|cloud]` (both) — error session triage.
 *
 * Defaults to whichever repo you're in (local → bin/triage-local,
 * cloud → bin/triage-cloud). You can override by passing the other target.
 *
 * Pass-through: --since, --limit, --force, --no-triage, --bundles.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import consola from 'consola';

import { detectRepo } from '../lib/context.js';

export const triageHelp = `sm triage [local|cloud] [-- <bin/triage-* args>]

Defaults: in the open repo → local; in the cloud repo → cloud.

Cross-repo: from the open repo, \`sm triage cloud\` runs bin/triage-cloud
from the cloud repo (if reachable at ~/dev/smartchats-cloud).

Flags after \`--\` forward to the underlying bin/triage-* script.

Examples:
  sm triage                          # auto-pick based on repo
  sm triage local
  sm triage cloud -- --since 7d --limit 50
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

export async function runTriage(argv: string[]): Promise<number> {
    if (argv.includes('-h') || argv.includes('--help')) {
        console.log(triageHelp);
        return 0;
    }

    const dashDash = argv.indexOf('--');
    const head = dashDash >= 0 ? argv.slice(0, dashDash) : argv;
    const passthrough = dashDash >= 0 ? argv.slice(dashDash + 1) : [];

    const repo = detectRepo();
    let target = head.find(a => a === 'local' || a === 'cloud');
    if (!target) {
        if (repo.kind === 'open') target = 'local';
        else if (repo.kind === 'cloud') target = 'cloud';
        else {
            consola.error('Specify a target: sm triage local | sm triage cloud');
            return 1;
        }
    }

    // Resolve which repo's bin/triage-* to run.
    let runRoot: string | null = null;
    let scriptName: 'triage-local' | 'triage-cloud';
    if (target === 'local') {
        scriptName = 'triage-local';
        runRoot = repo.kind === 'open' ? repo.root : (process.env.SMARTCHATS_PATH ?? `${process.env.HOME}/dev/smartchats`);
    } else {
        scriptName = 'triage-cloud';
        runRoot = repo.kind === 'cloud' ? repo.root : `${process.env.HOME}/dev/smartchats-cloud`;
    }
    if (!runRoot || !fs.existsSync(path.join(runRoot, 'bin', scriptName))) {
        consola.error(`bin/${scriptName} not found at ${runRoot}`);
        return 1;
    }

    const script = path.join(runRoot, 'bin', scriptName);
    consola.info(`sm triage ${target} → ${script}`);
    return await spawnInherit(script, passthrough, runRoot);
}
