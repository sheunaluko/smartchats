import type { Level, LevelContext, LevelResult } from '../types.js';
import { runCmd } from '../exec.js';
import { listPackages } from '../workspace.js';
import { createConnection } from 'node:net';

/**
 * L3 — integration tests requiring running infrastructure (AIO).
 *
 * Currently wires:
 *   - smartchats-database: `test:aggregation` (end-to-end SurrealQL
 *     correctness for the 1.5.0 event-time convention — daily buckets,
 *     DST fall-back ordering, cross-tz, calendar/duration filters).
 *
 * Probes AIO before invoking each suite. If AIO is not reachable on
 * port 8000, returns SKIP with a clear message rather than failing —
 * the caller hasn't brought infra up.
 *
 * Future suites to wire here (in order of how flaky they probably are):
 *   - smartchats-database local_crud.test.ts (full round-trip CRUD)
 *   - smartchats-mcp stdio smoke
 *   - bundle import/export round-trip
 */

const AIO_HOST = '127.0.0.1';
const AIO_SURREAL_PORT = 8000;

/** TCP probe — fast, non-blocking check that something is listening. */
function probePort(host: string, port: number, timeoutMs = 1000): Promise<boolean> {
    return new Promise((resolve) => {
        const socket = createConnection({ host, port });
        let done = false;
        const finish = (ok: boolean) => {
            if (done) return;
            done = true;
            socket.destroy();
            resolve(ok);
        };
        socket.on('connect', () => finish(true));
        socket.on('error', () => finish(false));
        setTimeout(() => finish(false), timeoutMs);
    });
}

export const integrationLevel: Level = {
    id: 3,
    name: 'integration',
    description: 'Tests against running infra (AIO). Caller brings infra up first.',
    requiresInfra: true,
    async run(ctx: LevelContext): Promise<LevelResult> {
        const aioUp = await probePort(AIO_HOST, AIO_SURREAL_PORT);
        if (!aioUp) {
            return {
                status: 'SKIP',
                note: `AIO unreachable at ${AIO_HOST}:${AIO_SURREAL_PORT} — run \`smartchats launch\` first`,
            };
        }

        const pkgs = listPackages(ctx.repoRoot);
        const db = pkgs.find((p) => p.name === 'smartchats-database');
        if (!db) {
            return { status: 'FAIL', note: 'smartchats-database package not found in workspace' };
        }

        ctx.log.info('integration: smartchats-database test:aggregation');
        const result = await runCmd('npm', ['run', 'test:aggregation'], { cwd: db.path });
        if (result.code !== 0) {
            return { status: 'FAIL', note: `smartchats-database test:aggregation exit ${result.code}` };
        }

        return { status: 'PASS', note: 'aggregation correctness suite green' };
    },
};
