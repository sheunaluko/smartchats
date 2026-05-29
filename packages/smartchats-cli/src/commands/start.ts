/**
 * `smartchats start` — launch the local stack as detached child processes.
 *
 * Architecture mirrors bin/test-bun-deploy (the empirical reference impl):
 *   1. surreal binary                — port 8000, persistent rocksdb at DATA_DIR
 *   2. smartchats-local-server (bun) — port 3000, serves API at /local-api/*
 *                                      AND the static SPA from STATIC_DIR
 *
 * Lifecycle:
 *   - PID file at ~/.smartchats/run/pids.json
 *   - Per-process logs at ~/.smartchats/logs/{surreal,server}.log
 *   - Detached children survive the parent's exit so `start` returns 0
 *     and the user can keep using their terminal. `stop` reads the PID
 *     file to bring it down.
 *
 * Idempotent: if a stack is already running (PID file points at live PIDs
 * AND ports respond), the second invocation is a no-op + prints the URL.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import consola from 'consola';

import { requireRepo, detectContext } from '../lib/context.js';
import { updateConfig } from '../lib/config.js';
import { PROVIDERS, dotenvPath, findExistingValue, parseDotenv } from '../lib/env.js';
import { detectBinaryInstall, describeInstall, type BinaryInstall } from '../lib/install_root.js';
import { runEnv } from './env.js';
import {
    type PidFile,
    defaultDataDir,
    isProcessAlive,
    logDir,
    pidFilePath,
    probePort,
    readPidFile,
    serverLogPath,
    surrealLogPath,
    writePidFile,
} from '../lib/runstate.js';
import { withWave } from '../lib/visuals.js';

// ─── Binary resolution ────────────────────────────────────────────────

function findSurreal(): string | null {
    const fromPath = spawnSync('which', ['surreal'], { encoding: 'utf8' });
    if (fromPath.status === 0) return fromPath.stdout.trim();
    const home = path.join(process.env.HOME ?? '', '.surrealdb', 'surreal');
    if (fs.existsSync(home)) return home;
    if (fs.existsSync('/usr/local/bin/surreal')) return '/usr/local/bin/surreal';
    return null;
}

function findBun(): string | null {
    const fromPath = spawnSync('which', ['bun'], { encoding: 'utf8' });
    if (fromPath.status === 0) return fromPath.stdout.trim();
    const home = path.join(process.env.HOME ?? '', '.bun', 'bin', 'bun');
    if (fs.existsSync(home)) return home;
    return null;
}

// ─── Readiness probing ────────────────────────────────────────────────

async function waitForUrl(url: string, timeoutMs: number, intervalMs = 500): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            const controller = new AbortController();
            const t = setTimeout(() => controller.abort(), 1500);
            const res = await fetch(url, { signal: controller.signal });
            clearTimeout(t);
            if (res.ok) return true;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    return false;
}

// ─── Args + help ──────────────────────────────────────────────────────

export interface StartArgs {
    appPort: number;
    surrealPort: number;
    dataDir: string;
    rebuild: boolean;
    foreground: boolean;
    noPrompt: boolean;
}

export function parseStartArgs(rest: string[]): StartArgs {
    const args: StartArgs = {
        appPort: 3000,
        surrealPort: 8000,
        dataDir: defaultDataDir(),
        rebuild: false,
        foreground: false,
        noPrompt: false,
    };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--port') args.appPort = parseInt(rest[++i], 10);
        else if (a === '--surreal-port') args.surrealPort = parseInt(rest[++i], 10);
        else if (a === '--data-dir') args.dataDir = rest[++i];
        else if (a === '--rebuild') args.rebuild = true;
        else if (a === '-f' || a === '--foreground') args.foreground = true;
        else if (a === '--no-prompt') args.noPrompt = true;
        else if (a === '-h' || a === '--help') {
            console.log(startHelp());
            process.exit(0);
        }
    }
    return args;
}

export function startHelp(): string {
    return `smartchats start — launch the local stack (surreal + server)

Usage:
  smartchats start [options]

Options:
  --port <n>           App port (default 3000). Browser connects here.
  --surreal-port <n>   SurrealDB port (default 8000, loopback only).
  --data-dir <path>    Persistent SurrealDB data dir (default ~/.smartchats/data).
  --rebuild            Force workspace rebuild (turbo run build) before start.
  -f, --foreground     Attach to children; Ctrl-C stops the stack.
                       (Default: detach, start returns immediately.)
  --no-prompt          Skip the interactive "configure keys?" preflight that
                       fires when no provider keys are detected. Use in
                       scripts, CI, and Docker entrypoints.
  -h, --help           Show this help.

Lifecycle:
  smartchats stop      Stop the running stack.
  smartchats status    Show what's running, on what ports.
  smartchats logs      Tail per-process logs.

Files:
  ~/.smartchats/run/pids.json   PID + port + start time per process.
  ~/.smartchats/logs/*.log      Per-process stdout/stderr (surreal, server).
  ~/.smartchats/data            SurrealDB persistent storage.
`;
}

// ─── Build (if needed) ─────────────────────────────────────────────────

function workspaceBuildArtifactsExist(repoRoot: string): boolean {
    const spa = path.join(repoRoot, 'apps/smartchats/out');
    const dbDist = path.join(repoRoot, 'packages/smartchats-database/dist');
    return fs.existsSync(spa) && fs.existsSync(dbDist);
}

async function runBuild(repoRoot: string, bun: string): Promise<void> {
    const env = { ...process.env, PATH: `${path.dirname(bun)}:${process.env.PATH}` };
    // Capture build output (pipe instead of inherit) so the wave isn't fighting
    // turbo's status spam. Logs to the build log file on failure for debugging.
    await withWave('Building workspace', async () => {
        const result = spawnSync(bun, ['run', 'build'], { cwd: repoRoot, env, stdio: 'pipe' });
        if (result.status !== 0) {
            // Surface the captured output before throwing so the user can see why.
            process.stderr.write(result.stdout?.toString() ?? '');
            process.stderr.write(result.stderr?.toString() ?? '');
            throw new Error(`build failed (exit ${result.status})`);
        }
    });
    consola.success('Workspace built');
}

// ─── Already-running detection ────────────────────────────────────────

async function isStackUp(rec: PidFile): Promise<boolean> {
    if (!isProcessAlive(rec.surreal.pid) || !isProcessAlive(rec.server.pid)) return false;
    // Both PIDs alive; verify they're actually serving (a stale PID could be
    // re-issued to an unrelated process).
    const [surrealOk, serverOk] = await Promise.all([
        probePort(rec.surreal.port, '/health'),
        probePort(rec.server.port, '/local-api/health'),
    ]);
    return surrealOk && serverOk;
}

// ─── Spawn helpers ────────────────────────────────────────────────────

interface SpawnedProc {
    pid: number;
    child: ChildProcess;
    logPath: string;
}

function spawnDetached(
    bin: string,
    args: string[],
    env: NodeJS.ProcessEnv,
    cwd: string,
    logPath: string,
): SpawnedProc {
    fs.mkdirSync(logDir(), { recursive: true });
    // Append mode so successive starts don't wipe history.
    const fd = fs.openSync(logPath, 'a');
    const child = spawn(bin, args, {
        cwd,
        env,
        detached: true,
        stdio: ['ignore', fd, fd],
    });
    // Caller is responsible for fs.closeSync(fd) once the child has cloned it
    // (which happens immediately on spawn). We close to avoid leaking the fd
    // in the parent.
    try { fs.closeSync(fd); } catch { /* */ }
    if (!child.pid) throw new Error(`failed to spawn ${bin}`);
    return { pid: child.pid, child, logPath };
}

// ─── runStart ─────────────────────────────────────────────────────────

export async function runStart(args: StartArgs): Promise<number> {
    consola.box('SmartChats — start');

    // 1. Mode detection. Binary install (curl|sh) → spawn bundled binaries.
    //    Source mode (dev / npm install) → use bun + run TS from the repo.
    const install = detectBinaryInstall();
    consola.info(describeInstall(install));

    // 2. Resolve binaries + spawn spec based on mode.
    let surrealBin: string;
    let serverBin: string;
    let serverArgs: string[];
    let serverCwd: string;
    let staticDir: string;
    let bunBin: string | null = null;
    let repoRoot: string | null = null;

    if (install) {
        // Binary mode. Surreal may be bundled or pre-installed system-wide.
        surrealBin = install.surrealBin || findSurreal() || '';
        if (!surrealBin) {
            consola.error('surreal binary not found (neither bundled nor on PATH).');
            consola.info("Install: curl --proto '=https' --tlsv1.2 -sSf https://install.surrealdb.com | sh");
            return 1;
        }
        serverBin = install.serverBin;
        serverArgs = [];
        serverCwd = install.root;
        staticDir = install.staticDir;
        consola.info(`surreal: ${surrealBin}`);
        consola.info(`server:  ${serverBin}`);
    } else {
        // Source mode. Need bun to execute the TS server entrypoint, and a
        // repo with .next /out to point SMARTCHATS_STATIC_DIR at.
        const ctx = detectContext();
        repoRoot = requireRepo(ctx);
        const sb = findSurreal();
        if (!sb) {
            consola.error('surreal binary not found.');
            consola.info("Install: curl --proto '=https' --tlsv1.2 -sSf https://install.surrealdb.com | sh");
            return 1;
        }
        const bb = findBun();
        if (!bb) {
            consola.error('bun binary not found.');
            consola.info('Install: curl -fsSL https://bun.sh/install | bash');
            return 1;
        }
        surrealBin = sb;
        bunBin = bb;
        serverBin = bunBin;
        serverArgs = ['--bun', 'run', 'src/cli.ts'];
        serverCwd = path.join(repoRoot, 'packages/smartchats-local-server');
        staticDir = path.join(repoRoot, 'apps/smartchats/out');
        consola.info(`bun:     ${bunBin}`);
        consola.info(`surreal: ${surrealBin}`);
        consola.info(`repo:    ${repoRoot}`);
    }

    // 3. Idempotency check.
    const existing = readPidFile();
    if (existing && await isStackUp(existing)) {
        consola.success(`Stack already running. Open: http://localhost:${existing.server.port}`);
        return 0;
    }
    if (existing) {
        consola.warn('Stale PID file (process gone or port silent) — overwriting.');
        try { fs.rmSync(pidFilePath()); } catch { /* */ }
    }

    // 4. Source-mode only: ensure workspace builds exist.
    if (!install) {
        if (args.rebuild || !workspaceBuildArtifactsExist(repoRoot!)) {
            await runBuild(repoRoot!, bunBin!);
        }
    } else if (args.rebuild) {
        consola.warn('--rebuild ignored in binary install mode (binaries ship pre-built).');
    }

    // 5. Set up paths.
    fs.mkdirSync(args.dataDir, { recursive: true });
    const surrealLog = surrealLogPath();
    const serverLog = serverLogPath();
    const startedAt = new Date().toISOString();

    // 5b. Preflight provider keys. If none are configured AND we're
    //     interactive AND --no-prompt wasn't passed, offer to walk the
    //     user through `smartchats env` before launching anything.
    //     Skipped in non-interactive contexts (Docker, CI, --no-prompt)
    //     since the post-ready box already surfaces the warning there.
    const preflightEnvRoot = install ? install.root : repoRoot!;
    const preflightDotenv = parseDotenv(dotenvPath(preflightEnvRoot));
    const anyKeyConfigured = PROVIDERS.some((spec) => findExistingValue(spec, preflightDotenv) !== null);
    if (!anyKeyConfigured && !args.noPrompt && process.stdin.isTTY && process.stdout.isTTY) {
        consola.warn('No LLM provider keys found in environment or .env.');
        consola.info(`Looked in: ${dotenvPath(preflightEnvRoot)}`);
        const { confirm } = await import('@inquirer/prompts');
        const wantConfigure = await confirm({
            message: 'Run `smartchats env` to configure keys interactively now?',
            default: true,
        });
        if (wantConfigure) {
            const envExit = await runEnv({ list: false });
            if (envExit !== 0) {
                consola.warn('Key configuration cancelled or failed — continuing with launch anyway.');
            }
        } else {
            consola.info('Proceeding without keys. The agent will not be able to reply until keys are configured.');
        }
    }

    // 6. Spawn SurrealDB.
    const surrealProc = spawnDetached(
        surrealBin,
        [
            'start',
            '--user', 'root', '--pass', 'root',
            '--bind', `127.0.0.1:${args.surrealPort}`,
            '--log', 'info',
            `rocksdb:${path.join(args.dataDir, 'surreal.db')}`,
        ],
        process.env,
        repoRoot ?? install!.root,
        surrealLog,
    );

    const surrealReady = await withWave(
        `Starting surreal on :${args.surrealPort}`,
        () => waitForUrl(`http://127.0.0.1:${args.surrealPort}/health`, 30_000),
    );
    if (!surrealReady) {
        consola.error('SurrealDB did not become ready within 30s.');
        try { process.kill(surrealProc.pid, 'SIGTERM'); } catch { /* */ }
        consola.info(`Logs: ${surrealLog}`);
        return 1;
    }
    consola.success(`surreal ready on :${args.surrealPort}`);

    // 7. Spawn smartchats-local-server.
    //    Binary mode: invoke the compiled binary directly.
    //    Source mode: invoke bun --bun run src/cli.ts in the local-server pkg.
    //    Either mode: merge .env from the right root (install root or repo
    //    root) into the spawn env. process.env wins on collision so users
    //    can override per-launch with `KEY=val smartchats start`.
    const envRoot = install ? install.root : repoRoot!;
    const dotenv = parseDotenv(dotenvPath(envRoot));
    const serverEnv: NodeJS.ProcessEnv = {
        ...dotenv,
        ...process.env,
        SURREAL_URL: `ws://127.0.0.1:${args.surrealPort}/rpc`,
        SURREAL_NS: 'smartchats',
        SURREAL_DB: 'main',
        SURREAL_USER: 'root',
        SURREAL_PASSWORD: 'root',
        SMARTCHATS_HOST: '0.0.0.0',
        SMARTCHATS_PORT: String(args.appPort),
        SMARTCHATS_STATIC_DIR: staticDir,
    };
    if (bunBin) {
        // Source mode: ensure nested `bun run ...` calls resolve the same bun.
        serverEnv.PATH = `${path.dirname(bunBin)}:${process.env.PATH}`;
    }
    const serverProc = spawnDetached(serverBin, serverArgs, serverEnv, serverCwd, serverLog);

    const serverReady = await withWave(
        `Starting smartchats-server on :${args.appPort}`,
        () => waitForUrl(`http://127.0.0.1:${args.appPort}/local-api/health`, 30_000),
    );
    if (!serverReady) {
        consola.error('smartchats-local-server did not become ready within 30s.');
        try { process.kill(surrealProc.pid, 'SIGTERM'); } catch { /* */ }
        try { process.kill(serverProc.pid, 'SIGTERM'); } catch { /* */ }
        consola.info(`Server logs: ${serverLog}`);
        consola.info(`Surreal logs: ${surrealLog}`);
        return 1;
    }
    consola.success(`smartchats-server ready on :${args.appPort}`);

    // Probe /health and surface a loud warning if no provider keys are
    // configured. This catches the Docker user who never runs `smartchats
    // setup` and would otherwise discover "agent can't reply" only after
    // opening the SPA + sending their first message.
    try {
        const healthRes = await fetch(`http://127.0.0.1:${args.appPort}/local-api/health`);
        const health = await healthRes.json() as { checks?: { providers?: { ok?: boolean } } };
        if (health.checks?.providers?.ok === false) {
            const dotenvLoc = path.join(envRoot, '.env');
            consola.box(
                'NO API KEYS CONFIGURED — agent will not be able to reply\n\n'
                + 'The stack is up and the SPA loads, but every LLM call will fail\n'
                + 'until you configure at least one provider key. Three ways to fix,\n'
                + 'easiest first:\n\n'
                + '  1. Interactive walkthrough (RECOMMENDED):\n'
                + '       smartchats env\n'
                + '     Prompts for OpenAI, Anthropic, Google, and Serper keys.\n'
                + `     Writes to ${dotenvLoc}.\n\n`
                + '  2. Edit the .env file directly. The file at\n'
                + `       ${dotenvLoc}\n`
                + '     is the same file Docker mounts into the container. Add:\n'
                + '       OPENAI_API_KEY=sk-...\n'
                + '       SERPER_API_KEY=...           # for web-search tool\n'
                + '       (optional) ANTHROPIC_API_KEY=sk-ant-...\n'
                + '       (optional) GOOGLE_API_KEY=AIza...\n'
                + '     Then restart: `smartchats restart` (or `docker restart <name>`)\n\n'
                + '  3. Open the SPA → Settings → BYO Keys, paste keys there.\n'
                + '     Stored in SurrealDB; no restart needed.\n\n'
                + 'Docs: https://smartchats.ai/docs/self-host#environment-configuration',
            );
        }
    } catch { /* health probe is best-effort polish; don't fail start on it */ }

    // 8. Persist PID file.
    const pidRecord: PidFile = {
        version: 1,
        surreal: { pid: surrealProc.pid, port: args.surrealPort, startedAt },
        server: { pid: serverProc.pid, port: args.appPort, startedAt },
    };
    writePidFile(pidRecord);

    // 9. Record last-used config (so `doctor` etc. know the port to probe).
    updateConfig({ lastUsedMode: 'aio', lastUsedPort: args.appPort });

    // 10. Detach (default) or stay attached (--foreground).
    if (args.foreground) {
        consola.success(`Stack up. Open: http://localhost:${args.appPort}  (foreground; Ctrl-C to stop)`);
        const stopAll = () => {
            consola.info('Stopping...');
            try { process.kill(surrealProc.pid, 'SIGTERM'); } catch { /* */ }
            try { process.kill(serverProc.pid, 'SIGTERM'); } catch { /* */ }
            try { fs.rmSync(pidFilePath()); } catch { /* */ }
        };
        process.on('SIGINT', () => { stopAll(); process.exit(0); });
        process.on('SIGTERM', () => { stopAll(); process.exit(0); });
        // Block forever; user Ctrl-C exits.
        await new Promise(() => { /* never resolves */ });
        return 0; // unreachable
    }

    // Detach: unref children so parent can exit cleanly.
    surrealProc.child.unref();
    serverProc.child.unref();
    consola.success(`Stack up. Open: http://localhost:${args.appPort}`);
    consola.info(`Stop with: smartchats stop`);
    consola.info(`Status:    smartchats status`);
    consola.info(`Logs:      smartchats logs`);
    return 0;
}
