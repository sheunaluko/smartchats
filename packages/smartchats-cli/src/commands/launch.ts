/**
 * `smartchats launch` (default subcommand) — interactive launcher for
 * the SmartChats docker stack.
 *
 * Resolves provider API keys from the environment (matching
 * smartchats-local-server's precedence: SMARTCHATS_<PROV>_API_KEY →
 * <PROV>_API_KEY), prompts for the rest, persists chosen values to
 * `.env`, builds the AIO image if missing, and runs `docker run`.
 *
 * This is the original `smartchats` behavior — the entry point falls
 * through here when no subcommand is given, preserving prior usage.
 */

import { spawnSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { confirm, input, password } from '@inquirer/prompts';
import consola from 'consola';

import { detectContext, requireRepo } from '../lib/context.js';
import { updateConfig } from '../lib/config.js';
import { runDoctor } from './doctor.js';

interface ProviderSpec {
    label: string;
    canonical: string;
    envNames: string[];
    required: boolean;
    skipNote: string;
}

const PROVIDERS: ProviderSpec[] = [
    {
        label: 'OpenAI',
        canonical: 'OPENAI_API_KEY',
        envNames: ['SMARTCHATS_OPENAI_API_KEY', 'OPENAI_API_KEY'],
        required: true,
        skipNote: 'chat + embeddings + TTS will all be unavailable',
    },
    {
        label: 'Anthropic (Claude)',
        canonical: 'ANTHROPIC_API_KEY',
        envNames: ['SMARTCHATS_ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'],
        required: false,
        skipNote: 'Claude models won\'t be selectable',
    },
    {
        label: 'Google (Gemini)',
        canonical: 'GOOGLE_API_KEY',
        envNames: ['SMARTCHATS_GOOGLE_API_KEY', 'GOOGLE_API_KEY', 'GEMINI_API_KEY'],
        required: false,
        skipNote: 'Gemini models won\'t be selectable',
    },
    {
        label: 'Serper (web search)',
        canonical: 'SERPER_API_KEY',
        envNames: ['SMARTCHATS_SERPER_API_KEY', 'SERPER_API_KEY'],
        required: false,
        skipNote: 'the agent\'s web-search tool will be a no-op',
    },
];

function maskKey(value: string): string {
    if (value.length <= 8) return '*'.repeat(value.length);
    return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

function findExistingValue(spec: ProviderSpec, dotenv: Record<string, string>): { value: string; source: string } | null {
    for (const name of spec.envNames) {
        if (process.env[name]) return { value: process.env[name]!, source: `env $${name}` };
    }
    for (const name of spec.envNames) {
        if (dotenv[name]) return { value: dotenv[name], source: `.env $${name}` };
    }
    return null;
}

function parseDotenv(file: string): Record<string, string> {
    if (!fs.existsSync(file)) return {};
    const out: Record<string, string> = {};
    for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq < 0) continue;
        const key = line.slice(0, eq).trim();
        let val = line.slice(eq + 1).trim();
        // Strip surrounding quotes (consistent with bash `KEY="value"` style).
        if ((val.startsWith('"') && val.endsWith('"')) ||
            (val.startsWith("'") && val.endsWith("'"))) {
            val = val.slice(1, -1);
        }
        out[key] = val;
    }
    return out;
}

function writeDotenv(file: string, values: Record<string, string>): void {
    const lines: string[] = [];
    const written = new Set<string>();
    if (fs.existsSync(file)) {
        for (const raw of fs.readFileSync(file, 'utf8').split('\n')) {
            const line = raw.trim();
            if (!line || line.startsWith('#')) {
                lines.push(raw);
                continue;
            }
            const eq = line.indexOf('=');
            if (eq < 0) { lines.push(raw); continue; }
            const key = line.slice(0, eq).trim();
            if (key in values) {
                lines.push(`${key}=${values[key]}`);
                written.add(key);
            } else {
                lines.push(raw);
            }
        }
    }
    for (const [key, value] of Object.entries(values)) {
        if (!written.has(key)) lines.push(`${key}=${value}`);
    }
    fs.writeFileSync(file, lines.join('\n') + '\n');
}

/**
 * @deprecated Use `detectContext()` + `requireRepo()` from `lib/context.ts`.
 * Kept as a thin wrapper for callers we haven't migrated yet.
 */
export function findRepoRoot(start: string): string {
    return requireRepo(detectContext(start));
}

function checkDocker(): boolean {
    return spawnSync('docker', ['version'], { stdio: 'ignore' }).status === 0;
}

function imageExists(tag: string): boolean {
    return spawnSync('docker', ['image', 'inspect', tag], { stdio: 'ignore' }).status === 0;
}

function defaultDataDir(): string {
    const xdgData = process.env.XDG_DATA_HOME;
    if (xdgData) return path.join(xdgData, 'smartchats', 'aio');
    return path.join(process.env.HOME ?? '/tmp', '.smartchats', 'aio');
}

export interface LaunchArgs {
    noPrompt: boolean;
    rebuild: boolean;
    detached: boolean;
    port: number;
    dataDir: string;
    imageTag: string;
    test: boolean;
}

export function parseLaunchArgs(rest: string[]): LaunchArgs {
    const args: LaunchArgs = {
        noPrompt: false,
        rebuild: false,
        detached: false,
        port: 3000,
        dataDir: defaultDataDir(),
        imageTag: 'smartchats-aio:latest',
        test: false,
    };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--no-prompt') args.noPrompt = true;
        else if (a === '--rebuild') args.rebuild = true;
        else if (a === '-d' || a === '--detached') args.detached = true;
        else if (a === '--port') args.port = parseInt(rest[++i], 10);
        else if (a === '--data-dir') args.dataDir = rest[++i];
        else if (a === '--tag') args.imageTag = rest[++i];
        else if (a === '--test') args.test = true;
        else if (a === '--help' || a === '-h') {
            console.log(launchHelp());
            process.exit(0);
        }
    }
    // --test implies --no-prompt (no human at the keyboard) + --detached
    // (the test path needs the launch call to return so it can poll + doctor).
    if (args.test) {
        args.noPrompt = true;
        args.detached = true;
    }
    return args;
}

export function launchHelp(): string {
    return `smartchats launch — interactive launcher for the local docker stack

Usage:
  smartchats launch [options]
  smartchats          (alias — defaults to 'launch' for backward compat)

Options:
  --no-prompt        Use existing env / .env values; don't prompt.
  --rebuild          Rebuild the docker image before starting.
  -d, --detached     Run the container in the background.
  --port <n>         Host port to expose (default 3000).
  --data-dir <path>  Where to persist SurrealDB data (default ${defaultDataDir()}).
  --tag <tag>        Docker image tag (default smartchats-aio:latest).
  --test             Launch detached, wait until the stack is ready, run
                     \`smartchats doctor\`, exit with doctor's exit code.
                     Implies --no-prompt and --detached.
  -h, --help         Show this help.
`;
}

/**
 * Poll an HTTP URL until it returns 2xx or the timeout elapses.
 * Returns true on success, false on timeout.
 */
async function waitForHttp(url: string, timeoutMs: number, intervalMs: number = 1000): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 2000);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(t);
            if (res.ok) return true;
        } catch {
            // Not up yet — keep polling.
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}

export async function runLaunch(args: LaunchArgs): Promise<void> {
    consola.box('SmartChats — local stack');

    if (!checkDocker()) {
        consola.error('docker not found.');
        consola.info('Install Docker Desktop (https://www.docker.com/products/docker-desktop/) and try again.');
        process.exit(1);
    }

    const ctx = detectContext(process.cwd());
    const repoRoot = requireRepo(ctx);
    if (ctx.mode === 'explicit') {
        consola.info(`Using $SMARTCHATS_HOME=${repoRoot}`);
    }
    process.chdir(repoRoot);

    const dotenvPath = path.join(repoRoot, '.env');
    const existing = parseDotenv(dotenvPath);
    const resolved: Record<string, string> = { ...existing };

    consola.info(`Working dir: ${repoRoot}`);
    if (Object.keys(existing).length) {
        consola.info(`Found existing .env (${Object.keys(existing).length} entries) — values will be reused unless you change them below.`);
    }

    for (const spec of PROVIDERS) {
        const found = findExistingValue(spec, existing);

        if (args.noPrompt) {
            if (found) {
                resolved[spec.canonical] = found.value;
                consola.success(`${spec.label}: ${maskKey(found.value)} (from ${found.source})`);
            } else if (spec.required) {
                consola.warn(`${spec.label}: no key found — ${spec.skipNote}.`);
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

    if (!args.noPrompt && !resolved.SMARTCHATS_API_KEY) {
        const wantsAuth = await confirm({
            message: 'Require a bearer token on every request to smartchats-server? (recommended only for non-localhost deployments)',
            default: false,
        });
        if (wantsAuth) {
            const token = await input({ message: 'Enter token (any string):' });
            if (token.trim()) resolved.SMARTCHATS_API_KEY = token.trim();
        }
    }

    writeDotenv(dotenvPath, resolved);
    consola.success(`Wrote ${Object.keys(resolved).length} entries to .env`);

    if (args.rebuild || !imageExists(args.imageTag)) {
        consola.start(`Building ${args.imageTag} (this can take a few minutes on first run)...`);
        const buildResult = spawnSync(
            'docker',
            ['build', '-f', 'Dockerfile.aio', '-t', args.imageTag, '.'],
            { stdio: 'inherit' },
        );
        if (buildResult.status !== 0) {
            consola.error(`docker build failed (exit ${buildResult.status})`);
            process.exit(buildResult.status ?? 1);
        }
        consola.success(`Built ${args.imageTag}`);
    } else {
        consola.info(`Reusing existing image ${args.imageTag} (pass --rebuild to force).`);
    }

    fs.mkdirSync(args.dataDir, { recursive: true });

    const runArgs = [
        'run',
        '--rm',
        '-p', `${args.port}:3000`,
        '-v', `${args.dataDir}:/data`,
        '--env-file', dotenvPath,
        '--name', 'smartchats',
    ];
    if (args.detached) runArgs.push('-d');
    else runArgs.push('-it');
    runArgs.push(args.imageTag);

    consola.start(`Running: docker ${runArgs.join(' ')}`);
    consola.info(`  Open:  http://localhost:${args.port}`);
    consola.info(`  Data:  ${args.dataDir}`);
    if (args.detached) {
        consola.info(`  Stop:  docker stop smartchats`);
        consola.info(`  Logs:  docker logs -f smartchats`);
    }

    // Persist preferences for next time / doctor's default port.
    updateConfig({ lastUsedMode: 'aio', lastUsedPort: args.port });

    const proc = spawn('docker', runArgs, { stdio: 'inherit' });

    // --test path: container is detached, so the spawn returns once docker
    // hands off. Poll for the stack to come up, then run doctor.
    if (args.test) {
        const ready = await waitForHttp(`http://localhost:${args.port}`, 90_000);
        if (!ready) {
            consola.error(`Stack did not become ready on port ${args.port} within 90s.`);
            consola.info('Inspect with: docker logs smartchats');
            process.exit(1);
        }
        consola.success(`Stack responded on port ${args.port}. Running doctor...`);
        const exit = await runDoctor({ port: args.port, json: false });
        process.exit(exit);
    }

    proc.on('exit', (code) => process.exit(code ?? 0));

    process.on('SIGINT', () => spawnSync('docker', ['stop', 'smartchats']));
    process.on('SIGTERM', () => spawnSync('docker', ['stop', 'smartchats']));
}
