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
}

export function parseStartArgs(rest: string[]): StartArgs {
    const args: StartArgs = {
        appPort: 3000,
        surrealPort: 8000,
        dataDir: defaultDataDir(),
        rebuild: false,
        foreground: false,
    };
    for (let i = 0; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--port') args.appPort = parseInt(rest[++i], 10);
        else if (a === '--surreal-port') args.surrealPort = parseInt(rest[++i], 10);
        else if (a === '--data-dir') args.dataDir = rest[++i];
        else if (a === '--rebuild') args.rebuild = true;
        else if (a === '-f' || a === '--foreground') args.foreground = true;
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

function runBuild(repoRoot: string, bun: string): void {
    consola.start('Building workspace (turbo run build)...');
    const env = { ...process.env, PATH: `${path.dirname(bun)}:${process.env.PATH}` };
    const result = spawnSync(bun, ['run', 'build'], {
        cwd: repoRoot,
        env,
        stdio: 'inherit',
    });
    if (result.status !== 0) throw new Error(`build failed (exit ${result.status})`);
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

    // 1. Resolve repo (start currently requires source — the bundled-binary
    //    install path is task #9; it will land alongside a detection branch
    //    here for ~/.smartchats/bin/{surreal,smartchats-server}).
    const ctx = detectContext();
    const repoRoot = requireRepo(ctx);

    // 2. Resolve binaries.
    const surrealBin = findSurreal();
    if (!surrealBin) {
        consola.error('surreal binary not found.');
        consola.info("Install: curl --proto '=https' --tlsv1.2 -sSf https://install.surrealdb.com | sh");
        return 1;
    }
    const bunBin = findBun();
    if (!bunBin) {
        consola.error('bun binary not found.');
        consola.info('Install: curl -fsSL https://bun.sh/install | bash');
        return 1;
    }
    consola.info(`bun: ${bunBin}`);
    consola.info(`surreal: ${surrealBin}`);
    consola.info(`repo: ${repoRoot}`);

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

    // 4. Ensure builds exist (auto-build on first run; --rebuild to force).
    if (args.rebuild || !workspaceBuildArtifactsExist(repoRoot)) {
        runBuild(repoRoot, bunBin);
    }

    // 5. Set up paths.
    fs.mkdirSync(args.dataDir, { recursive: true });
    const surrealLog = surrealLogPath();
    const serverLog = serverLogPath();
    const startedAt = new Date().toISOString();

    // 6. Spawn SurrealDB.
    consola.start(`Starting surreal on 127.0.0.1:${args.surrealPort}...`);
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
        repoRoot,
        surrealLog,
    );

    const surrealReady = await waitForUrl(
        `http://127.0.0.1:${args.surrealPort}/health`,
        30_000,
    );
    if (!surrealReady) {
        consola.error('SurrealDB did not become ready within 30s.');
        try { process.kill(surrealProc.pid, 'SIGTERM'); } catch { /* */ }
        consola.info(`Logs: ${surrealLog}`);
        return 1;
    }
    consola.success('surreal ready');

    // 7. Spawn smartchats-local-server (via bun, runs TS source directly).
    consola.start(`Starting smartchats-local-server on 0.0.0.0:${args.appPort}...`);
    const serverEnv = {
        ...process.env,
        SURREAL_URL: `ws://127.0.0.1:${args.surrealPort}/rpc`,
        SURREAL_NS: 'smartchats',
        SURREAL_DB: 'main',
        SURREAL_USER: 'root',
        SURREAL_PASSWORD: 'root',
        SMARTCHATS_HOST: '0.0.0.0',
        SMARTCHATS_PORT: String(args.appPort),
        SMARTCHATS_STATIC_DIR: path.join(repoRoot, 'apps/smartchats/out'),
        // Make sure nested `bun run ...` calls resolve the same bun.
        PATH: `${path.dirname(bunBin)}:${process.env.PATH}`,
    };
    const serverProc = spawnDetached(
        bunBin,
        ['--bun', 'run', 'src/cli.ts'],
        serverEnv,
        path.join(repoRoot, 'packages/smartchats-local-server'),
        serverLog,
    );

    const serverReady = await waitForUrl(
        `http://127.0.0.1:${args.appPort}/local-api/health`,
        30_000,
    );
    if (!serverReady) {
        consola.error('smartchats-local-server did not become ready within 30s.');
        try { process.kill(surrealProc.pid, 'SIGTERM'); } catch { /* */ }
        try { process.kill(serverProc.pid, 'SIGTERM'); } catch { /* */ }
        consola.info(`Server logs: ${serverLog}`);
        consola.info(`Surreal logs: ${surrealLog}`);
        return 1;
    }
    consola.success('smartchats-local-server ready');

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
