import type { Level, LevelContext, LevelResult } from '../types.js';
import { runCmd } from '../exec.js';
import { listPackages } from '../workspace.js';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * L3 — integration tests against a *managed* SurrealDB.
 *
 * The level spawns `surreal start --memory` on a free random port,
 * waits for it to accept connections, runs the integration suite
 * against it, and tears down via try/finally. No pre-staged AIO, no
 * `bin/aio` / `smartchats launch`, no user setup — just `surreal` on
 * PATH (which `smartchats-cli doctor` already flags as a critical
 * install dependency).
 *
 * Currently wires:
 *   - smartchats-database `test:aggregation` — end-to-end SurrealQL
 *     correctness for the 1.5.0 event-time convention (daily buckets,
 *     DST fall-back ordering, cross-tz, calendar/duration filters).
 *
 * `requiresInfra: false` — because the level manages its own infra,
 * it runs in the default `npx smartchats-test` invocation alongside
 * lint/build/unit. No flag needed.
 *
 * Future suites to add here (in order of how flaky they probably are):
 *   - smartchats-database local_crud.test.ts (full round-trip CRUD)
 *   - smartchats-mcp stdio smoke
 *   - bundle import/export round-trip
 *
 * Surreal lookup mirrors `bin/test-bun-deploy` and the smartchats-cli
 * `start` command: PATH, then ~/.surrealdb/surreal, then
 * /usr/local/bin/surreal. SKIPs with the install hint if missing.
 */

/** Probe PATH + the two well-known install locations. */
function findSurrealBin(): string | null {
    const fromPath = spawnSync('which', ['surreal'], { encoding: 'utf8' });
    if (fromPath.status === 0 && fromPath.stdout.trim()) return fromPath.stdout.trim();
    const home = path.join(process.env.HOME ?? '', '.surrealdb', 'surreal');
    if (fs.existsSync(home)) return home;
    if (fs.existsSync('/usr/local/bin/surreal')) return '/usr/local/bin/surreal';
    return null;
}

/**
 * Ask the kernel for a free TCP port by binding to :0 and reading back
 * the assignment. Briefly closes the bound socket before returning so
 * surreal can bind it — the race window is microseconds and has never
 * collided in practice.
 */
function pickFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
        const srv = createServer();
        srv.on('error', reject);
        srv.listen(0, '127.0.0.1', () => {
            const addr = srv.address();
            if (!addr || typeof addr === 'string') {
                srv.close();
                reject(new Error('failed to read assigned port'));
                return;
            }
            const port = addr.port;
            srv.close(() => resolve(port));
        });
    });
}

/** Single fast TCP probe. */
function probePort(port: number, timeoutMs = 500): Promise<boolean> {
    return new Promise((resolve) => {
        const sock = createConnection({ host: '127.0.0.1', port });
        let done = false;
        const finish = (ok: boolean) => {
            if (done) return;
            done = true;
            sock.destroy();
            resolve(ok);
        };
        sock.on('connect', () => finish(true));
        sock.on('error', () => finish(false));
        setTimeout(() => finish(false), timeoutMs);
    });
}

/** Poll TCP until accept or deadline. */
async function waitForPort(port: number, deadlineMs: number): Promise<boolean> {
    while (Date.now() < deadlineMs) {
        if (await probePort(port)) return true;
        await new Promise((r) => setTimeout(r, 200));
    }
    return false;
}

/** TERM then KILL after grace period. Awaits actual exit. */
async function killProcess(proc: ChildProcess, graceMs = 2000): Promise<void> {
    if (proc.exitCode !== null || proc.signalCode) return;
    proc.kill('SIGTERM');
    await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
            proc.kill('SIGKILL');
            resolve();
        }, graceMs);
        proc.on('exit', () => {
            clearTimeout(t);
            resolve();
        });
    });
}

export const integrationLevel: Level = {
    id: 3,
    name: 'integration',
    description: 'Integration suite against a managed in-memory SurrealDB (random port, self-cleaning).',
    requiresInfra: false,
    async run(ctx: LevelContext): Promise<LevelResult> {
        const surrealBin = findSurrealBin();
        if (!surrealBin) {
            return {
                status: 'SKIP',
                note: 'surreal binary not found — install: `curl -sSf https://install.surrealdb.com | sh`',
            };
        }

        const pkgs = listPackages(ctx.repoRoot);
        const db = pkgs.find((p) => p.name === 'smartchats-database');
        if (!db) {
            return { status: 'FAIL', note: 'smartchats-database package not found in workspace' };
        }

        const port = await pickFreePort();

        ctx.log.info(`integration: spawning ${surrealBin} on :${port} (memory backend)`);
        const proc = spawn(
            surrealBin,
            [
                'start',
                '--user', 'root',
                '--pass', 'root',
                '--bind', `127.0.0.1:${port}`,
                '--log', 'warn',
                'memory',
            ],
            { stdio: ['ignore', 'pipe', 'pipe'] },
        );

        // Capture stderr so a bad surreal version / arg surfaces a useful
        // error rather than just a port-timeout.
        let surrealStderr = '';
        proc.stderr?.on('data', (chunk: Buffer) => {
            surrealStderr += chunk.toString();
            // Cap to keep memory bounded if surreal is chatty.
            if (surrealStderr.length > 4000) {
                surrealStderr = surrealStderr.slice(-4000);
            }
        });
        proc.on('error', (err) => {
            ctx.log.err(`surreal spawn error: ${err.message}`);
        });

        try {
            const ready = await waitForPort(port, Date.now() + 10_000);
            if (!ready) {
                const tail = surrealStderr.slice(-500).trim();
                return {
                    status: 'FAIL',
                    note: `surreal did not accept connections on :${port} within 10s${tail ? ` — stderr: ${tail}` : ''}`,
                };
            }

            ctx.log.info(`integration: surreal ready on :${port}, running test:aggregation`);
            const result = await runCmd('npm', ['run', 'test:aggregation'], {
                cwd: db.path,
                env: {
                    SMARTCHATS_LOCAL_URL: `ws://127.0.0.1:${port}/rpc`,
                },
            });

            if (result.code !== 0) {
                return { status: 'FAIL', note: `smartchats-database test:aggregation exit ${result.code}` };
            }
            return { status: 'PASS', note: 'aggregation correctness suite green (managed surreal)' };
        } finally {
            await killProcess(proc);
        }
    },
};
