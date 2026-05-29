/**
 * `smartchats setup` — guided first-run for the native-binary stack.
 *
 * Flow:
 *   1. Resolve repo root (auto-clones if fresh install).
 *   2. System analysis — bun, surreal, Node version, free disk. Surfaces what's
 *      missing with install instructions; bun/surreal are blocking.
 *   3. Provider keys — interactive prompts walking PROVIDERS, masked, with
 *      "found this in env/.env, use it?" confirmation for existing values.
 *   4. Optional bearer token (for non-localhost deploys).
 *   5. Write .env at repo root (merge-write, preserves comments + order).
 *   6. Invoke `start` with defaults — user is in front of the running app
 *      when the wizard exits.
 *
 * This is the post-friend-failure on-ramp: every step that previously had
 * to succeed silently (env detection, dep presence, .env, docker, the
 * right path) is made explicit here.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { confirm, input, password } from '@inquirer/prompts';
import consola from 'consola';

import { ensureRepoRoot } from '../lib/clone.js';
import {
    PROVIDERS,
    dotenvPath,
    findExistingValue,
    maskKey,
    parseDotenv,
    writeDotenv,
} from '../lib/env.js';
import { runStart } from './start.js';

// ─── Args + help ──────────────────────────────────────────────────────

export interface SetupArgs {
    /** Skip prompts, use what's already in env / .env. */
    noPrompt: boolean;
    /** Skip the final `smartchats start` invocation. */
    noStart: boolean;
    /** Override the clone location (passed through to ensureRepoRoot). */
    repoPath?: string;
}

export function parseSetupArgs(rest: string[]): SetupArgs {
    const args: SetupArgs = { noPrompt: false, noStart: false };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--no-prompt') args.noPrompt = true;
        else if (a === '--no-start') args.noStart = true;
        else if (a === '--repo-path') args.repoPath = rest[++i];
        else if (a === '-h' || a === '--help') { console.log(setupHelp()); process.exit(0); }
    }
    return args;
}

export function setupHelp(): string {
    return `smartchats setup — guided first-run

Usage:
  smartchats setup [options]

Options:
  --no-prompt        Use existing env / .env values; don't prompt.
  --no-start         Just collect config; don't start the stack.
  --repo-path <path> Override repo location (default: ~/.smartchats/cli/source
                     on fresh installs, or wherever \$SMARTCHATS_HOME points).
  -h, --help

What it does:
  1. Resolves (or clones) the smartchats source tree.
  2. Checks system: bun, surreal binary, Node version, free disk.
  3. Walks you through provider API keys, persists to <repo>/.env.
  4. Starts the stack and opens http://localhost:3000.
`;
}

// ─── System analysis ──────────────────────────────────────────────────

interface SystemCheck {
    name: string;
    status: 'ok' | 'missing' | 'warn';
    detail: string;
    /** If non-empty, blocks setup until resolved. */
    blocking: boolean;
    /** Optional install hint to print on failure. */
    fix?: string;
}

function which(cmd: string): string | null {
    const r: SpawnSyncReturns<string> = spawnSync('which', [cmd], { encoding: 'utf8' });
    if (r.status === 0) return r.stdout.trim();
    return null;
}

function checkBun(): SystemCheck {
    const bin = which('bun')
        ?? (fs.existsSync(`${process.env.HOME}/.bun/bin/bun`) ? `${process.env.HOME}/.bun/bin/bun` : null);
    if (!bin) {
        return {
            name: 'bun',
            status: 'missing',
            detail: 'not found on PATH or ~/.bun/bin',
            blocking: true,
            fix: 'curl -fsSL https://bun.sh/install | bash',
        };
    }
    const ver = spawnSync(bin, ['--version'], { encoding: 'utf8' });
    return { name: 'bun', status: 'ok', detail: `${bin} (${ver.stdout.trim()})`, blocking: false };
}

function checkSurreal(): SystemCheck {
    const bin = which('surreal')
        ?? (fs.existsSync(`${process.env.HOME}/.surrealdb/surreal`) ? `${process.env.HOME}/.surrealdb/surreal` : null);
    if (!bin) {
        return {
            name: 'surreal',
            status: 'missing',
            detail: 'not found on PATH or ~/.surrealdb',
            blocking: true,
            fix: "curl --proto '=https' --tlsv1.2 -sSf https://install.surrealdb.com | sh",
        };
    }
    const ver = spawnSync(bin, ['version'], { encoding: 'utf8' });
    const first = (ver.stdout || ver.stderr).split('\n')[0]?.trim() ?? '?';
    return { name: 'surreal', status: 'ok', detail: `${bin} (${first})`, blocking: false };
}

function checkDisk(): SystemCheck {
    // `df -k $HOME` → second line, 4th field = free KB.
    const home = process.env.HOME ?? '/';
    const r = spawnSync('df', ['-k', home], { encoding: 'utf8' });
    if (r.status !== 0) return { name: 'disk', status: 'warn', detail: 'df failed — skipping', blocking: false };
    const lines = r.stdout.trim().split('\n');
    const fields = lines[lines.length - 1]?.trim().split(/\s+/) ?? [];
    const freeKb = parseInt(fields[3] ?? '0', 10);
    const freeGb = freeKb / (1024 * 1024);
    const detail = `${freeGb.toFixed(1)} GB free at ${home}`;
    if (freeGb < 3) {
        return {
            name: 'disk',
            status: 'warn',
            detail: `${detail} — need ≥3 GB for builds + SurrealDB`,
            blocking: false,
        };
    }
    return { name: 'disk', status: 'ok', detail, blocking: false };
}

function printSystemChecks(checks: SystemCheck[]): void {
    const nameWidth = Math.max(...checks.map((c) => c.name.length));
    console.log('');
    for (const c of checks) {
        const icon = c.status === 'ok' ? '✓' : c.status === 'warn' ? '!' : '✗';
        console.log(`  ${icon}  ${c.name.padEnd(nameWidth)}  ${c.detail}`);
    }
    console.log('');
    for (const c of checks) {
        if (c.status !== 'ok' && c.fix) {
            consola.info(`Fix for ${c.name}:\n    ${c.fix}`);
        }
    }
}

// ─── runSetup ─────────────────────────────────────────────────────────

export async function runSetup(args: SetupArgs): Promise<number> {
    consola.box('SmartChats — guided setup');

    // 1. Repo.
    consola.start('Locating smartchats source...');
    let repoRoot: string;
    try {
        repoRoot = await ensureRepoRoot({ repoPath: args.repoPath });
    } catch (err) {
        consola.error((err as Error).message);
        return 1;
    }
    consola.success(`Repo: ${repoRoot}`);

    // 2. System analysis. Node is deliberately not checked — see doctor.ts
    //    for the reasoning (Bun runtime is bundled with the binaries; npm
    //    install gates Node via package.json `engines`).
    consola.start('Checking system...');
    const checks: SystemCheck[] = [checkBun(), checkSurreal(), checkDisk()];
    printSystemChecks(checks);
    const blocking = checks.filter((c) => c.blocking);
    if (blocking.length > 0) {
        consola.fail(`Cannot continue — missing: ${blocking.map((c) => c.name).join(', ')}`);
        consola.info('Install the missing dependencies and re-run `smartchats setup`.');
        return 1;
    }

    // 3. Provider keys.
    consola.start('Provider API keys');
    const dotenv = dotenvPath(repoRoot);
    const existing = parseDotenv(dotenv);
    const resolved: Record<string, string> = { ...existing };

    for (const spec of PROVIDERS) {
        const found = findExistingValue(spec, existing);

        if (args.noPrompt) {
            if (found) {
                resolved[spec.canonical] = found.value;
                consola.success(`${spec.label}: ${maskKey(found.value)} (from ${found.source})`);
            } else if (spec.required) {
                consola.warn(`${spec.label}: missing — ${spec.skipNote}.`);
            }
            continue;
        }

        if (found) {
            const useExisting = await confirm({
                message: `${spec.label}: detected ${maskKey(found.value)} from ${found.source}. Use this?`,
                default: true,
            });
            if (useExisting) {
                resolved[spec.canonical] = found.value;
                continue;
            }
        }

        const fresh = await password({
            message: found
                ? `Enter a different ${spec.label} key (empty to skip):`
                : `Enter ${spec.label} key (empty to ${spec.required ? `skip — ${spec.skipNote}` : 'skip'}):`,
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

    // 4. Bearer token (optional, for non-localhost deploys).
    if (!args.noPrompt && !resolved.SMARTCHATS_API_KEY) {
        const wantsAuth = await confirm({
            message: 'Require a bearer token on every API request? (recommended only for non-localhost deployments)',
            default: false,
        });
        if (wantsAuth) {
            const token = await input({ message: 'Enter token (any string):' });
            if (token.trim()) resolved.SMARTCHATS_API_KEY = token.trim();
        }
    }

    // 5. Persist .env.
    writeDotenv(dotenv, resolved);
    consola.success(`Wrote ${Object.keys(resolved).length} entries to ${path.relative(process.cwd(), dotenv)}`);

    // 6. Hand off to start.
    if (args.noStart) {
        consola.info('Skipping start (--no-start). Run `smartchats start` when ready.');
        return 0;
    }

    consola.start('Starting the stack...');
    return runStart({
        appPort: 3000,
        surrealPort: 8000,
        dataDir: path.join(process.env.HOME ?? '/tmp', '.smartchats', 'data'),
        rebuild: false,
        foreground: false,
    });
}
