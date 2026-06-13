/**
 * `sm doctor` — environment health check.
 *
 * Phase 1: open repo delegates to `smartchats doctor`. Cloud repo doctor is
 * a Phase-later implementation; for now we'd want it to check firebase
 * login state, .env file presence, ports free, stripe CLI installed, etc.
 */

import { spawn } from 'node:child_process';
import * as path from 'node:path';
import * as fs from 'node:fs';
import consola from 'consola';

import { detectRepo } from '../lib/context.js';

export const doctorHelp = `sm doctor — environment health check for this repo.

Open repo:  delegates to \`smartchats doctor\` (CLI).
Cloud repo: not yet implemented in Phase 1.

See: sm explain doctor
`;

export async function runDoctor(_argv: string[]): Promise<number> {
    const repo = detectRepo();
    if (repo.kind === 'unknown' || !repo.root) {
        consola.error('sm doctor must be run from inside a smartchats repo.');
        return 1;
    }
    if (repo.kind === 'open') {
        // smartchats CLI doctor lives in packages/smartchats-cli/dist/cli.js
        const cliBin = path.join(repo.root, 'node_modules/.bin/smartchats');
        if (fs.existsSync(cliBin)) {
            return new Promise<number>(resolve => {
                const child = spawn(cliBin, ['doctor'], { cwd: repo.root!, stdio: 'inherit' });
                child.on('exit', code => resolve(code ?? 0));
            });
        }
        consola.warn('smartchats CLI not built. Run `npm run build` in packages/smartchats-cli first.');
        return 1;
    }
    consola.info('sm doctor is not yet implemented for the cloud repo (Phase-later).');
    consola.info('For now: check `firebase login`, .env.local-test exists, ports 3000/5001/8001 free.');
    return 0;
}
