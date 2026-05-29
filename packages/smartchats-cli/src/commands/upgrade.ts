/**
 * `smartchats upgrade` — fetch a newer release.
 *
 * Binary install (curl|sh path):
 *   Re-runs install.sh pinned to the requested version (default: latest).
 *   The new install drops in over the old one — `~/.smartchats/bin/*` and
 *   `~/.smartchats/app/out/` get overwritten; `~/.smartchats/data/`,
 *   `~/.smartchats/.env`, and `~/.smartchats/config.json` are preserved.
 *
 * Source install (git clone / contributor path):
 *   Upgrade-via-installer doesn't apply — `git pull` is the right move.
 *   This command surfaces that message and exits non-zero so it's caught
 *   by anyone scripting against `smartchats upgrade`.
 *
 * Npm install (`npm install -g smartchats-ai`):
 *   Similar to source mode — `npm install -g smartchats-ai@latest` is
 *   how that path updates. We detect it heuristically (executable path
 *   under a node_modules tree) and tell the user.
 */

import { spawnSync } from 'node:child_process';
import * as path from 'node:path';
import consola from 'consola';

import { detectBinaryInstall } from '../lib/install_root.js';

export interface UpgradeArgs {
    version: string;
    yes: boolean;
}

export function parseUpgradeArgs(rest: string[]): UpgradeArgs {
    const args: UpgradeArgs = { version: 'latest', yes: false };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--version') args.version = rest[++i];
        else if (a === '-y' || a === '--yes') args.yes = true;
        else if (a === '-h' || a === '--help') { console.log(upgradeHelp()); process.exit(0); }
    }
    return args;
}

export function upgradeHelp(): string {
    return `smartchats upgrade — upgrade to a newer release

Usage:
  smartchats upgrade [options]

Options:
  --version <tag>   Pin to a specific version (default: latest).
  -y, --yes         Skip the confirmation prompt.
  -h, --help

What it does:
  Binary install     → re-runs install.sh pinned to <version>. Preserves
                       your data dir, .env, and config.json.
  Source install     → tells you to \`git pull\`. Upgrade-via-installer
                       doesn't apply.
  npm install        → tells you to \`npm install -g smartchats-ai@latest\`.
`;
}

const INSTALL_URL = 'https://smartchats.ai/install';

function isNpmInstall(): boolean {
    // Heuristic: if the executable path traverses node_modules, we were
    // installed via npm. Bun-compiled binaries living at ~/.smartchats/bin
    // won't match this.
    const exe = process.argv[1] ?? process.argv[0] ?? '';
    return /[\\/]node_modules[\\/]/.test(exe);
}

export async function runUpgrade(args: UpgradeArgs): Promise<number> {
    const install = detectBinaryInstall();

    if (!install) {
        if (isNpmInstall()) {
            consola.info('smartchats was installed via npm.');
            consola.info('Upgrade with: npm install -g smartchats-ai@latest');
            return 1;
        }
        consola.info('smartchats is running from source (git clone).');
        consola.info('Upgrade with: cd <repo> && git pull');
        return 1;
    }

    consola.box('SmartChats — upgrade');
    consola.info(`Install root: ${install.root}`);
    consola.info(`Target version: ${args.version}`);
    consola.info('Re-runs install.sh in place. Your data dir, .env, and config.json are preserved.');

    if (!args.yes) {
        const { confirm } = await import('@inquirer/prompts');
        const ok = await confirm({
            message: `Proceed with upgrade to ${args.version}?`,
            default: true,
        });
        if (!ok) {
            consola.info('Cancelled.');
            return 0;
        }
    }

    // Re-run install.sh with the requested version. We curl-pipe to bash
    // exactly the way a fresh install would — single code path for both.
    const cmd = `curl -fsSL ${INSTALL_URL} | bash -s -- --non-interactive --version ${args.version} --prefix ${install.root}`;
    consola.start('Running installer...');
    const r = spawnSync('bash', ['-c', cmd], { stdio: 'inherit' });
    if (r.status !== 0) {
        consola.error(`Installer exited ${r.status}.`);
        return r.status ?? 1;
    }
    consola.success('Upgrade complete.');
    consola.info('Restart the stack to pick up the new binaries: smartchats restart');
    return 0;
}
