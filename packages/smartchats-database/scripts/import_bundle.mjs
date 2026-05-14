#!/usr/bin/env node
/**
 * Import a previously-exported JSON bundle into a SurrealDB instance.
 *
 * Phase 9.1 symmetry: speaks SDK direct via WebSocket, NOT the Express
 * `/data/query` proxy. AIO exposes its SurrealDB on `ws://localhost:8000`
 * (see `bin/aio --surreal-port`); cloud exposes it at `wss://...`. Same
 * Client surface, just a different URL/creds. Mirrors the MCP
 * `import_user_data` tool's logic — sequential to avoid the
 * 1536-dim-vector worker panic (see import_export.ts notes).
 *
 * Requires: `npm run build` in this package first (imports from dist/).
 *
 * Usage:
 *   node scripts/import_bundle.mjs <bundle.json> [options]
 *
 * Options:
 *   --url <ws-url>        SurrealDB WebSocket URL.
 *                         Default ws://localhost:8000/rpc (AIO).
 *   --ns <namespace>      Default 'smartchats' (matches local-server config).
 *   --db <database>       Default 'main'.
 *   --user, --password    Default root/root (matches AIO).
 *
 * Examples:
 *   node scripts/import_bundle.mjs ~/smartchats-export.json
 *   node scripts/import_bundle.mjs ~/foo.json --url ws://localhost:8001/rpc
 *
 * Exit codes:
 *   0 = at least one row imported, no errors
 *   1 = any error (connect, statement ERR, missing tables, etc.)
 */

import { readFileSync } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { homedir } from 'node:os';
import { createClient, queries } from '../dist/index.js';

function expandPath(p) {
    if (p.startsWith('~/')) return resolvePath(homedir(), p.slice(2));
    return resolvePath(p);
}

// ─── Args ────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
if (argv.length === 0 || argv[0].startsWith('--')) {
    console.error('Usage: node scripts/import_bundle.mjs <bundle.json> [options]');
    console.error('Options: --url, --ns, --db, --user, --password');
    process.exit(1);
}

const bundlePath = expandPath(argv[0]);
const opts = {
    url: 'ws://localhost:8000/rpc',
    namespace: 'smartchats',
    database: 'main',
    username: 'root',
    password: 'root',
};
for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
        case '--url':                opts.url = next(); break;
        case '--ns': case '--namespace': opts.namespace = next(); break;
        case '--db': case '--database':  opts.database = next(); break;
        case '--user': case '--username': opts.username = next(); break;
        case '--password':           opts.password = next(); break;
        default:
            console.error(`Unknown option: ${a}`);
            process.exit(1);
    }
}

// ─── Load bundle ─────────────────────────────────────────────────────────

console.log(`[import] reading ${bundlePath}`);
const text = readFileSync(bundlePath, 'utf8');
const bundle = JSON.parse(text);

if (bundle.version !== 1) {
    console.error(`[import] unsupported bundle version: ${bundle.version} (expected 1)`);
    process.exit(1);
}

console.log(`[import] source=${bundle.source} exportedAt=${bundle.exportedAt} userId=${bundle.userId}`);
console.log(`[import] target ${opts.url} (${opts.namespace}/${opts.database})`);

const tables = Object.keys(bundle.tables);
console.log(`[import] tables: ${tables.join(', ')}`);

// ─── Connect ─────────────────────────────────────────────────────────────

const client = createClient({
    url: opts.url,
    namespace: opts.namespace,
    database: opts.database,
    auth: { username: opts.username, password: opts.password },
});
try {
    await client.connect();
} catch (err) {
    console.error(`[import] connect failed: ${err.message}`);
    console.error(`Is SurrealDB reachable at ${opts.url}? (AIO needs --surreal-port exposed; default 8000)`);
    process.exit(1);
}

// ─── Import ──────────────────────────────────────────────────────────────

let totalImported = 0;
let totalFailed = 0;
const errors = [];

try {
    for (const table of tables) {
        const rows = bundle.tables[table];
        if (!Array.isArray(rows) || rows.length === 0) {
            console.log(`  ${table}: 0 rows (skip)`);
            continue;
        }

        let written = 0;
        let failed = 0;
        let firstErr = null;

        for (const row of rows) {
            if (typeof row.id !== 'string') {
                failed++;
                continue;
            }
            const colon = row.id.indexOf(':');
            if (colon < 0) {
                failed++;
                continue;
            }
            const tableName = row.id.slice(0, colon);
            const key = row.id.slice(colon + 1);

            const built = queries.buildImportQuery(tableName, key, row);
            if (!built) {
                failed++;
                if (!firstErr) firstErr = 'row could not be built (missing in/out for relation, or malformed)';
                continue;
            }

            try {
                // SDK direct via Client: returns per-statement {status, result, time}
                // (translated from v2 SDK's responses() shape inside client.runRaw).
                const stmts = await client.runRaw(built.query, built.variables);
                const stmtErr = stmts.find((s) => s.status !== 'OK');
                if (stmtErr) {
                    failed++;
                    if (!firstErr) firstErr = `statement ERR — ${String(stmtErr.result).slice(0, 200)}`;
                    continue;
                }
                // For multi-statement (DELETE; RELATE) the meaningful result is the
                // LAST statement; for single-statement UPSERT it's stmts[0]. Either
                // way: empty-result means write didn't land.
                const writeStmt = stmts[stmts.length - 1];
                const wroteRow =
                    writeStmt && Array.isArray(writeStmt.result) && writeStmt.result.length > 0;
                if (!wroteRow) {
                    failed++;
                    if (!firstErr) firstErr = 'write returned empty';
                    continue;
                }
                written++;
                totalImported++;
            } catch (err) {
                failed++;
                if (!firstErr) firstErr = err.message;
            }
        }

        totalFailed += failed;
        const status = failed > 0 ? `${written}/${rows.length} (${failed} failed)` : `${written}/${rows.length}`;
        console.log(`  ${table}: ${status}`);
        if (firstErr) errors.push(`  ${table}: ${firstErr}`);
    }
} finally {
    await client.close().catch(() => undefined);
}

console.log(`\n[import] total imported: ${totalImported}, total failed: ${totalFailed}`);
if (errors.length > 0) {
    console.log(`[import] errors (first per table):`);
    for (const e of errors) console.log(e);
}

if (totalImported === 0 || totalFailed > 0) {
    process.exit(1);
}
process.exit(0);
