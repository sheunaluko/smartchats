/**
 * `smartchats env` — interactive provider-key configuration.
 *
 * Same prompt loop as `smartchats setup`, scoped to just the keys: no
 * system-deps check, no auto-clone, no auto-start. For the common case
 * where you already have a working install and you're rotating keys or
 * adding a new provider (e.g. enabling Serper web search).
 *
 * Writes to the same .env file `smartchats start` reads on boot:
 *   - Binary install: ~/.smartchats/.env (the file Docker mounts at
 *     /root/.smartchats/.env)
 *   - Source install: <repo>/.env
 */

import { confirm, password } from '@inquirer/prompts';
import consola from 'consola';

import { ensureRepoRoot } from '../lib/clone.js';
import { detectContext } from '../lib/context.js';
import {
    PROVIDERS,
    dotenvPath,
    findExistingValue,
    maskKey,
    parseDotenv,
    writeDotenv,
} from '../lib/env.js';
import { detectBinaryInstall } from '../lib/install_root.js';

// ─── Args + help ──────────────────────────────────────────────────────

export interface EnvArgs {
    /** Show what's configured (masked); don't prompt for changes. */
    list: boolean;
}

export function parseEnvArgs(rest: string[]): EnvArgs {
    const args: EnvArgs = { list: false };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--list' || a === '-l') args.list = true;
        else if (a === '-h' || a === '--help') { console.log(envHelp()); process.exit(0); }
    }
    return args;
}

export function envHelp(): string {
    return `smartchats env — interactively configure provider API keys

Usage:
  smartchats env [options]

Options:
  -l, --list   Show what's configured (masked); don't prompt for changes.
  -h, --help

What it does:
  Walks each LLM provider — OpenAI, Anthropic, Google (Gemini), and
  Serper (web search) — and lets you set or update each key. Writes to
  the .env file at the install root (~/.smartchats/.env for binary
  installs; the same file Docker mounts into the container).

  If the stack is already running, restart afterwards to pick up the
  changes:
      smartchats restart        # bare-metal install
      docker restart smartchats # docker install
`;
}

// ─── runEnv ───────────────────────────────────────────────────────────

async function resolveEnvRoot(): Promise<string | null> {
    const install = detectBinaryInstall();
    if (install) return install.root;
    const ctx = detectContext();
    if (ctx.root) return ctx.root;
    // Fresh install with no source: lazily clone so we have a place to
    // write .env. (Mirrors what setup does.)
    try {
        return await ensureRepoRoot({});
    } catch (err) {
        consola.error((err as Error).message);
        return null;
    }
}

export async function runEnv(args: EnvArgs): Promise<number> {
    const envRoot = await resolveEnvRoot();
    if (!envRoot) return 1;

    const dotenv = dotenvPath(envRoot);
    const existing = parseDotenv(dotenv);
    const resolved: Record<string, string> = { ...existing };

    if (args.list) {
        consola.info(`Provider keys (from ${dotenv} and process.env):`);
        console.log('');
        for (const spec of PROVIDERS) {
            const found = findExistingValue(spec, existing);
            if (found) {
                console.log(`  ✓ ${spec.label.padEnd(24)} ${maskKey(found.value)}  (${found.source})`);
            } else {
                const tag = spec.required ? '(required)' : '(optional)';
                console.log(`  ✗ ${spec.label.padEnd(24)} not set  ${tag}`);
            }
        }
        console.log('');
        return 0;
    }

    consola.info(`Configuring provider keys → ${dotenv}\n`);

    for (const spec of PROVIDERS) {
        const found = findExistingValue(spec, existing);

        if (found) {
            const useExisting = await confirm({
                message: `${spec.label}: ${maskKey(found.value)} (from ${found.source}). Keep?`,
                default: true,
            });
            if (useExisting) {
                resolved[spec.canonical] = found.value;
                continue;
            }
        }

        const fresh = await password({
            message: found
                ? `Enter a different ${spec.label} key (empty to remove):`
                : `Enter ${spec.label} key (empty to skip${spec.required ? ` — ${spec.skipNote}` : ''}):`,
            mask: '*',
        });
        if (fresh.trim()) {
            resolved[spec.canonical] = fresh.trim();
        } else if (spec.required) {
            consola.warn(`Skipping ${spec.label}: ${spec.skipNote}.`);
            delete resolved[spec.canonical];
        } else {
            delete resolved[spec.canonical];
        }
    }

    writeDotenv(dotenv, resolved);
    consola.success(`Wrote ${Object.keys(resolved).length} entries to ${dotenv}`);
    consola.info('Restart the stack to pick up the new keys:');
    consola.info('  bare-metal: smartchats restart');
    consola.info('  docker:     docker restart <container-name>');
    return 0;
}
