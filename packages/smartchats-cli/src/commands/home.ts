/**
 * `smartchats home` — print where the CLI thinks the smartchats source lives.
 *
 * Useful for debugging install path issues + for scripts that want to pin
 * SMARTCHATS_HOME to whatever the CLI auto-resolved.
 */

import consola from 'consola';
import { detectContext, describeContext } from '../lib/context.js';
import { detectBinaryInstall } from '../lib/install_root.js';

export function homeHelp(): string {
    return `smartchats home — show the resolved smartchats source root + how we found it

Usage:
  smartchats home [--path-only]

Options:
  --path-only   Print just the path (or nothing on fresh-install). Scriptable.
  -h, --help

Resolution order:
  1. \$SMARTCHATS_HOME env var
  2. Walking up from cwd looking for Dockerfile.aio
  3. config.smartchatsHome in ~/.smartchats/config.json (auto-clone remembers)
`;
}

export interface HomeArgs {
    pathOnly: boolean;
}

export function parseHomeArgs(rest: string[]): HomeArgs {
    const args: HomeArgs = { pathOnly: false };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--path-only') args.pathOnly = true;
        else if (a === '-h' || a === '--help') { console.log(homeHelp()); process.exit(0); }
    }
    return args;
}

export async function runHome(args: HomeArgs): Promise<number> {
    const ctx = detectContext();
    const install = detectBinaryInstall();

    if (args.pathOnly) {
        // Prefer install root when in binary mode — that's the canonical
        // "smartchats lives here" answer for binary users.
        const target = install?.root ?? ctx.root;
        if (target) console.log(target);
        return target ? 0 : 1;
    }

    if (install) {
        consola.info(`Binary install at ${install.root}`);
        consola.info(`  server:  ${install.serverBin}`);
        consola.info(`  surreal: ${install.surrealBin || '(not bundled — using system surreal)'}`);
        consola.info(`  spa:     ${install.staticDir}`);
    }
    consola.info(describeContext(ctx));

    if (!install && !ctx.root) {
        consola.info('Run `smartchats setup` to install or locate the smartchats source.');
        return 1;
    }
    return 0;
}
