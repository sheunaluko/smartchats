/**
 * Production-data differential harness — pre-1.5.0 vs post-1.5.1 query comparison.
 *
 * Spins up its own surreal subprocess, imports a user-exported bundle, then
 * runs canonical aggregation queries in BOTH the legacy style (using `lts`
 * + `time::group(lts, 'day')`) and the new style (using `local_date` /
 * `ts`). Prints a structured report showing where the two diverge.
 *
 * The output is informational, not a pass/fail gate. Zero diffs across
 * the whole bundle ⇒ the migration is transparent for the data you
 * actually have. Diffs are EXPECTED on edge-case data (events near
 * midnight, cross-tz, DST fall-back) — those are exactly where the
 * refactor improves correctness over the previous behavior.
 *
 * NOT part of `npx smartchats-test`. Invoke directly:
 *
 *     BUNDLE_PATH=/abs/path/to/smartchats-export.json npm run test:diff
 *
 * Bundle export: use the MCP `export_user_data` tool from your normal
 * MCP client, write to a path OUTSIDE the repo (e.g. ~/smartchats-export.json,
 * or anywhere under /tmp/). If you must keep a bundle inside the tree,
 * put it under `_local_bundles/` — that path is .gitignored.
 *
 * ── Bundle-leak protection ──────────────────────────────────────────
 * Bundles contain personal data. This harness:
 *   1. Refuses to read BUNDLE_PATH that resolves to inside the repo
 *      UNLESS the path component matches a gitignored zone (_local_bundles,
 *      bundles, exports).
 *   2. Prints the resolved absolute path loudly on startup so accidental
 *      misuse is visible.
 *   3. Never writes any bundle-shaped output back to disk. All diff
 *      output is to stdout — redirect to a file outside the repo if you
 *      want to capture it.
 * The first layer of defense is the project's `.gitignore` (see the
 * "User-data bundles" section). This script is the second layer.
 */

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer, createConnection } from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, type Client } from '../src/index.js';
import { buildImportQuery } from '../src/queries/import_export.js';
import { applyLocalSchema, type LocalSchemaDb } from '../src/schema/local.js';

// ── Layer 2: refuse in-repo paths outside gitignored zones ───────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..'); // tests/ → package → packages/ → repo
const GITIGNORED_BUNDLE_DIRS = ['_local_bundles', 'bundles', 'exports'];

function validateBundlePath(bundlePath: string): string {
    const abs = path.resolve(bundlePath);
    if (!fs.existsSync(abs)) {
        throw new Error(`Bundle not found: ${abs}`);
    }
    if (!fs.statSync(abs).isFile()) {
        throw new Error(`Bundle path is not a file: ${abs}`);
    }
    const rel = path.relative(REPO_ROOT, abs);
    const isInside = !rel.startsWith('..') && !path.isAbsolute(rel);
    if (isInside) {
        const insideGitignored = GITIGNORED_BUNDLE_DIRS.some((dir) =>
            rel.split(path.sep).includes(dir),
        );
        if (!insideGitignored) {
            throw new Error(
                `BUNDLE_PATH resolves inside the repo (${rel}) but not under a gitignored bundle zone. ` +
                `Move the bundle outside the repo (e.g. ~/smartchats-export.json, /tmp/...) or under ` +
                `_local_bundles/ / bundles/ / exports/ (all gitignored). ` +
                `This protection exists because bundles contain personal data.`,
            );
        }
    }
    return abs;
}

// ── surreal subprocess lifecycle (lifted from levels/integration.ts) ─

function findSurrealBin(): string | null {
    const fromPath = spawnSync('which', ['surreal'], { encoding: 'utf8' });
    if (fromPath.status === 0 && fromPath.stdout.trim()) return fromPath.stdout.trim();
    const home = path.join(process.env.HOME ?? '', '.surrealdb', 'surreal');
    if (fs.existsSync(home)) return home;
    if (fs.existsSync('/usr/local/bin/surreal')) return '/usr/local/bin/surreal';
    return null;
}

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

async function waitForPort(port: number, deadlineMs: number): Promise<boolean> {
    while (Date.now() < deadlineMs) {
        if (await probePort(port)) return true;
        await new Promise((r) => setTimeout(r, 200));
    }
    return false;
}

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

// ── Bundle import ──────────────────────────────────────────────────────

interface Bundle {
    version: number;
    exportedAt?: string;
    source?: string;
    userId?: string;
    tables: Record<string, Array<Record<string, unknown>>>;
}

async function importBundleRaw(client: Client, bundle: Bundle): Promise<{ written: number; skipped: number; perTable: Record<string, number> }> {
    let written = 0;
    let skipped = 0;
    const perTable: Record<string, number> = {};
    for (const [tableName, rows] of Object.entries(bundle.tables)) {
        if (!Array.isArray(rows)) continue;
        perTable[tableName] = 0;
        for (const row of rows) {
            const id = row.id;
            if (typeof id !== 'string') {
                skipped++;
                continue;
            }
            const colon = id.indexOf(':');
            if (colon < 0) {
                skipped++;
                continue;
            }
            const key = id.slice(colon + 1);
            const spec = buildImportQuery(tableName, key, row);
            if (!spec) {
                skipped++;
                continue;
            }
            try {
                const stmts = (await client.runRaw(spec.query, spec.variables)) as Array<{ status: string; result: unknown }>;
                if (stmts.every((s) => s.status === 'OK')) {
                    written++;
                    perTable[tableName]++;
                } else {
                    skipped++;
                }
            } catch {
                skipped++;
            }
        }
    }
    return { written, skipped, perTable };
}

// ── Paired queries ─────────────────────────────────────────────────────

interface QueryPair {
    name: string;
    description: string;
    /** Returns null when the table is empty and the pair is meaningless. */
    skipIfEmpty?: 'metrics' | 'logs' | 'sessions';
    oldQuery: string;
    newQuery: string;
}

const PAIRS: QueryPair[] = [
    {
        name: 'M1: daily totals per metric_name',
        description: 'time::group(lts, "day") vs GROUP BY local_date',
        skipIfEmpty: 'metrics',
        oldQuery: `SELECT metric_name, time::format(lts, '%Y-%m-%d') AS bucket, math::sum(value) AS total
                   FROM metrics WHERE lts IS NOT NONE
                   GROUP BY metric_name, bucket
                   ORDER BY metric_name ASC, bucket ASC`,
        newQuery: `SELECT metric_name, local_date AS bucket, math::sum(value) AS total
                   FROM metrics WHERE local_date IS NOT NONE
                   GROUP BY metric_name, bucket
                   ORDER BY metric_name ASC, bucket ASC`,
    },
    {
        name: 'M2: weekly totals per metric_name',
        description: 'time::year/week(lts) vs time::year/week(<datetime> local_date)',
        skipIfEmpty: 'metrics',
        oldQuery: `SELECT metric_name, time::year(lts) AS yr, time::week(lts) AS wk, math::sum(value) AS total
                   FROM metrics WHERE lts IS NOT NONE
                   GROUP BY metric_name, yr, wk
                   ORDER BY metric_name ASC, yr ASC, wk ASC`,
        newQuery: `SELECT metric_name, time::year(<datetime> local_date) AS yr, time::week(<datetime> local_date) AS wk, math::sum(value) AS total
                   FROM metrics WHERE local_date IS NOT NONE
                   GROUP BY metric_name, yr, wk
                   ORDER BY metric_name ASC, yr ASC, wk ASC`,
    },
    {
        name: 'M3: row count per metric_name',
        description: 'Sanity check — both should agree if the migration is complete.',
        skipIfEmpty: 'metrics',
        oldQuery: `SELECT metric_name, count() AS n FROM metrics WHERE lts IS NOT NONE GROUP BY metric_name ORDER BY metric_name ASC`,
        newQuery: `SELECT metric_name, count() AS n FROM metrics WHERE ts IS NOT NONE GROUP BY metric_name ORDER BY metric_name ASC`,
    },
    {
        name: 'L1: daily log counts',
        description: 'time::format(lts) vs local_date',
        skipIfEmpty: 'logs',
        oldQuery: `SELECT time::format(lts, '%Y-%m-%d') AS bucket, count() AS n
                   FROM logs WHERE lts IS NOT NONE
                   GROUP BY bucket ORDER BY bucket ASC`,
        newQuery: `SELECT local_date AS bucket, count() AS n
                   FROM logs WHERE local_date IS NOT NONE
                   GROUP BY bucket ORDER BY bucket ASC`,
    },
    {
        name: 'L2: top 20 most recent logs by id (DESC order)',
        description: 'ORDER BY lts DESC vs ORDER BY ts DESC. Differences may indicate DST fall-back or ms-precision ties — investigate per-row.',
        skipIfEmpty: 'logs',
        oldQuery: `SELECT id FROM logs ORDER BY lts DESC LIMIT 20`,
        newQuery: `SELECT id FROM logs ORDER BY ts DESC LIMIT 20`,
    },
    {
        name: 'S1: total session count',
        description: 'Sanity check.',
        skipIfEmpty: 'sessions',
        oldQuery: `SELECT count() AS n FROM sessions GROUP ALL`,
        newQuery: `SELECT count() AS n FROM sessions GROUP ALL`,
    },
];

// ── Diff + report ──────────────────────────────────────────────────────

function canonical(rows: unknown[]): string {
    // Sort each row's keys, then sort the rows. Stringify with stable order.
    const normalized = rows.map((row) => {
        if (row === null || typeof row !== 'object') return row;
        const obj = row as Record<string, unknown>;
        const sortedKeys = Object.keys(obj).sort();
        const sortedObj: Record<string, unknown> = {};
        for (const k of sortedKeys) sortedObj[k] = obj[k];
        return sortedObj;
    });
    const stringified = normalized.map((r) => JSON.stringify(r));
    stringified.sort();
    return JSON.stringify(stringified);
}

async function runQuery(client: Client, sql: string): Promise<unknown[]> {
    const stmts = (await client.runRaw(sql)) as Array<{ status: string; result: unknown }>;
    if (stmts[0].status !== 'OK') {
        throw new Error(`Query failed: ${JSON.stringify(stmts[0].result).slice(0, 200)}\nQuery: ${sql.slice(0, 200)}`);
    }
    return stmts[0].result as unknown[];
}

interface PairReport {
    name: string;
    description: string;
    status: 'MATCH' | 'DIVERGED' | 'SKIPPED' | 'ERROR';
    note?: string;
    oldRowCount?: number;
    newRowCount?: number;
    oldSample?: unknown[];
    newSample?: unknown[];
}

async function runPair(client: Client, pair: QueryPair, tableCounts: Record<string, number>): Promise<PairReport> {
    if (pair.skipIfEmpty && (tableCounts[pair.skipIfEmpty] ?? 0) === 0) {
        return { name: pair.name, description: pair.description, status: 'SKIPPED', note: `${pair.skipIfEmpty} table is empty` };
    }
    try {
        const [oldRows, newRows] = await Promise.all([
            runQuery(client, pair.oldQuery),
            runQuery(client, pair.newQuery),
        ]);
        const match = canonical(oldRows) === canonical(newRows);
        const sampleSize = 5;
        return {
            name: pair.name,
            description: pair.description,
            status: match ? 'MATCH' : 'DIVERGED',
            oldRowCount: oldRows.length,
            newRowCount: newRows.length,
            oldSample: match ? undefined : oldRows.slice(0, sampleSize),
            newSample: match ? undefined : newRows.slice(0, sampleSize),
        };
    } catch (err) {
        return { name: pair.name, description: pair.description, status: 'ERROR', note: (err as Error).message };
    }
}

function printReport(reports: PairReport[]): void {
    console.log('');
    console.log('=== Differential Report ===');
    console.log('');
    let matched = 0;
    let diverged = 0;
    let skipped = 0;
    let errored = 0;
    for (const r of reports) {
        const icon = r.status === 'MATCH' ? '✓' : r.status === 'DIVERGED' ? '✗' : r.status === 'SKIPPED' ? '○' : '!';
        console.log(`${icon} ${r.name} — ${r.status}`);
        console.log(`  ${r.description}`);
        if (r.note) console.log(`  note: ${r.note}`);
        if (r.oldRowCount !== undefined) {
            console.log(`  old rows: ${r.oldRowCount}, new rows: ${r.newRowCount}`);
        }
        if (r.status === 'DIVERGED') {
            console.log('  old sample (first 5):');
            console.log(JSON.stringify(r.oldSample, null, 2).split('\n').map((l) => '    ' + l).join('\n'));
            console.log('  new sample (first 5):');
            console.log(JSON.stringify(r.newSample, null, 2).split('\n').map((l) => '    ' + l).join('\n'));
        }
        console.log('');
        if (r.status === 'MATCH') matched++;
        else if (r.status === 'DIVERGED') diverged++;
        else if (r.status === 'SKIPPED') skipped++;
        else errored++;
    }
    console.log('=== Summary ===');
    console.log(`  MATCH:    ${matched}`);
    console.log(`  DIVERGED: ${diverged}`);
    console.log(`  SKIPPED:  ${skipped}`);
    console.log(`  ERROR:    ${errored}`);
    console.log('');
    if (diverged > 0) {
        console.log('NOTE: divergences may be expected (DST fall-back, midnight boundary,');
        console.log('cross-tz rows). Inspect the samples above to judge whether each');
        console.log('divergence reflects a real bug being fixed by the migration.');
    } else if (matched > 0) {
        console.log('All non-skipped paired queries returned identical result sets — the');
        console.log('migration is transparent for the data in this bundle.');
    } else {
        console.log('No comparisons performed (every paired query was skipped because the');
        console.log('relevant table was empty). Re-run against a non-empty bundle.');
    }
}

// ── main ───────────────────────────────────────────────────────────────

async function main(): Promise<number> {
    const bundleEnv = process.env.BUNDLE_PATH;
    if (!bundleEnv) {
        console.error('Required: BUNDLE_PATH=<absolute-path-to-bundle.json>');
        console.error('Export a bundle via the MCP `export_user_data` tool and pass its path.');
        return 2;
    }
    let bundlePath: string;
    try {
        bundlePath = validateBundlePath(bundleEnv);
    } catch (err) {
        console.error((err as Error).message);
        return 2;
    }
    console.log(`reading bundle: ${bundlePath}`);
    let bundle: Bundle;
    try {
        bundle = JSON.parse(fs.readFileSync(bundlePath, 'utf8')) as Bundle;
    } catch (err) {
        console.error(`Bundle parse failed: ${(err as Error).message}`);
        return 2;
    }
    if (bundle.version !== 1) {
        console.error(`Unsupported bundle version: ${bundle.version}. Only v1 is supported.`);
        return 2;
    }
    const tableCounts: Record<string, number> = {};
    for (const [t, rows] of Object.entries(bundle.tables)) {
        tableCounts[t] = Array.isArray(rows) ? rows.length : 0;
    }
    console.log(`bundle tables: ${Object.entries(tableCounts).map(([t, n]) => `${t}=${n}`).join(', ')}`);

    const surrealBin = findSurrealBin();
    if (!surrealBin) {
        console.error('surreal binary not found — install: curl -sSf https://install.surrealdb.com | sh');
        return 2;
    }

    const port = await pickFreePort();
    console.log(`spawning surreal on 127.0.0.1:${port} (memory backend)`);
    const proc = spawn(
        surrealBin,
        ['start', '--user', 'root', '--pass', 'root', '--bind', `127.0.0.1:${port}`, '--log', 'warn', 'memory'],
        { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    let surrealStderr = '';
    proc.stderr?.on('data', (chunk: Buffer) => {
        surrealStderr += chunk.toString();
        if (surrealStderr.length > 4000) surrealStderr = surrealStderr.slice(-4000);
    });

    try {
        const ready = await waitForPort(port, Date.now() + 10_000);
        if (!ready) {
            console.error(`surreal did not accept connections within 10s. stderr tail: ${surrealStderr.slice(-500)}`);
            return 1;
        }
        const client = createClient({
            url: `ws://127.0.0.1:${port}/rpc`,
            namespace: 'smartchats',
            database: 'diff_harness',
            auth: { username: 'root', password: 'root' },
        });
        await client.connect();

        console.log('applying schema (LOCAL_DDL + cumulative migrations)');
        const schemaDb: LocalSchemaDb = {
            query: (q: string, vars?: Record<string, unknown>) => client.runRaw(q, vars),
        };
        await applyLocalSchema(schemaDb, {});

        console.log('importing bundle rows');
        const importResult = await importBundleRaw(client, bundle);
        console.log(`  wrote ${importResult.written} rows, skipped ${importResult.skipped}`);
        for (const [t, n] of Object.entries(importResult.perTable)) {
            console.log(`    ${t}: ${n}`);
        }

        console.log('');
        console.log('running paired queries');
        const reports: PairReport[] = [];
        for (const pair of PAIRS) {
            const r = await runPair(client, pair, tableCounts);
            reports.push(r);
        }
        printReport(reports);

        await client.close();
        return 0;
    } finally {
        await killProcess(proc);
    }
}

main().then((code) => process.exit(code)).catch((err) => {
    console.error('harness failed:', err);
    process.exit(1);
});
