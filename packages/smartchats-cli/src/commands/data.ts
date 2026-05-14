/**
 * `smartchats data import|export` — move user data between cloud + local.
 *
 * Both subcommands are target-aware via `--target=cloud|local`. Cloud
 * uses Firebase Auth + httpsCallable surrealQuery; local uses SDK-direct
 * to the AIO's exposed SurrealDB (root creds, no auth). Same operation
 * code from `smartchats-database/operations` runs against both.
 *
 * Bundle format: see `Bundle` type in smartchats-database/operations.
 * Stable wire contract — bumps require version field bump too.
 */

import consola from 'consola';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { homedir } from 'node:os';
import { operations, type Bundle } from 'smartchats-database';
import {
    makeDataAPI,
    type Target,
    type DataAPIHandle,
} from 'smartchats-database/data-api';

interface DataArgs {
    sub: 'import' | 'export';
    target: Target;
    file: string;
    tables?: string[];
    includeSensitive: boolean;
    dryRun: boolean;
    pageSize?: number;
}

function expandPath(p: string): string {
    if (p.startsWith('~/')) return path.join(homedir(), p.slice(2));
    return path.resolve(p);
}

export function parseDataArgs(rest: string[]): DataArgs {
    if (rest.length === 0) {
        console.log(dataHelp());
        process.exit(0);
    }
    const sub = rest[0];
    if (sub === '--help' || sub === '-h' || sub === 'help') {
        console.log(dataHelp());
        process.exit(0);
    }
    if (sub !== 'import' && sub !== 'export') {
        throw new Error(`Unknown 'data' subcommand: '${sub}' (expected 'import' or 'export')`);
    }

    const args: DataArgs = {
        sub,
        target: 'local',  // safest default
        file: '',
        includeSensitive: false,
        dryRun: false,
    };

    for (let i = 1; i < rest.length; i++) {
        const a = rest[i];
        if (a === '--target') args.target = rest[++i] as Target;
        else if (a.startsWith('--target=')) args.target = a.slice('--target='.length) as Target;
        else if (a === '--file') args.file = rest[++i];
        else if (a.startsWith('--file=')) args.file = a.slice('--file='.length);
        else if (a === '--tables') args.tables = rest[++i].split(',').map((t) => t.trim()).filter(Boolean);
        else if (a.startsWith('--tables=')) args.tables = a.slice('--tables='.length).split(',').map((t) => t.trim()).filter(Boolean);
        else if (a === '--include-sensitive') args.includeSensitive = true;
        else if (a === '--dry-run') args.dryRun = true;
        else if (a === '--page-size') args.pageSize = parseInt(rest[++i], 10);
        else if (a.startsWith('--page-size=')) args.pageSize = parseInt(a.slice('--page-size='.length), 10);
        else if (a === '--help' || a === '-h') {
            console.log(dataHelp());
            process.exit(0);
        } else if (!args.file && !a.startsWith('-')) {
            // First positional after the subcommand = file path (convenience).
            args.file = a;
        } else {
            throw new Error(`Unknown 'data ${sub}' argument: ${a}`);
        }
    }

    if (!args.file) {
        throw new Error(`Missing --file (or positional path). Try 'smartchats data ${sub} --help'.`);
    }
    if (args.target !== 'cloud' && args.target !== 'local') {
        throw new Error(`Invalid --target: ${args.target} (expected 'cloud' or 'local')`);
    }

    return args;
}

export function dataHelp(): string {
    return `smartchats data — move user data between SmartChats deployments

Usage:
  smartchats data import <file> [options]
  smartchats data export <file> [options]

Common options:
  --target=cloud|local    Where to read/write. Default: local (safe).
  --file=<path>           Bundle file (also accepted as positional).
  --help                  Show this help.

import options:
  --tables=t1,t2          Subset of bundle tables to import.
  --dry-run               Parse + count rows but don't write.

export options:
  --tables=t1,t2          Subset of tables to export. Default: built-in user-data list.
  --include-sensitive     Also export byo_api_keys + usage_records.
  --page-size=<n>         Row pagination page size (default 100).

Examples:
  smartchats data export ~/backup.json --target=cloud
  smartchats data import ~/backup.json --target=local --dry-run
  smartchats data import ~/backup.json --target=cloud --tables=logs,metrics
`;
}

async function doImport(args: DataArgs, handle: DataAPIHandle): Promise<void> {
    const fullPath = expandPath(args.file);
    consola.info(`Reading bundle: ${fullPath}`);
    const text = await fs.readFile(fullPath, 'utf8');
    const bundle = JSON.parse(text) as Bundle;

    if (bundle.version !== 1) {
        throw new Error(`Unsupported bundle version: ${bundle.version}. Only v1 is supported.`);
    }

    const totalRows = Object.values(bundle.tables).reduce((n, r) => n + (Array.isArray(r) ? r.length : 0), 0);
    consola.info(`Bundle: ${totalRows} row(s) across ${Object.keys(bundle.tables).length} table(s)`);
    consola.info(`Source: ${bundle.source}, exported: ${bundle.exportedAt}, original userId: ${bundle.userId}`);
    consola.info(`Target: ${handle.description}, will write as uid=${await handle.getUid()}`);
    if (args.dryRun) consola.warn('DRY RUN — no writes will happen.');

    // Per-row progress: print one dot per row, newline per table.
    let lastTable = '';
    let dotsThisTable = 0;
    consola.start(`Writing rows...`);
    const result = await operations.importBundle(handle.data, bundle, {
        tables: args.tables,
        dryRun: args.dryRun,
        onProgress: (p) => {
            if (p.table !== lastTable) {
                if (lastTable) process.stdout.write('\n');
                process.stdout.write(`  ${p.table}: `);
                lastTable = p.table;
                dotsThisTable = 0;
            }
            process.stdout.write(p.success ? '.' : '!');
            dotsThisTable++;
            // Avoid 1000+ dots on one line; wrap every 80.
            if (dotsThisTable % 80 === 0) {
                process.stdout.write(`\n  ${' '.repeat(p.table.length + 2)}`);
            }
        },
    });
    if (lastTable) process.stdout.write('\n');

    consola.box(
        `${args.dryRun ? '[DRY RUN] Would write' : 'Wrote'} ${result.rowsWritten}/${result.rowsInBundle} row(s)`,
    );
    for (const t of result.perTable) {
        const errLine = t.firstError ? `  (first error: ${t.firstError.slice(0, 120)})` : '';
        const status = t.failed > 0 ? consola.warn : consola.success;
        status(`${t.table}: ${t.written}/${t.rows} written${t.failed ? ` (${t.failed} failed)${errLine}` : ''}`);
    }
}

async function doExport(args: DataArgs, handle: DataAPIHandle): Promise<void> {
    const fullPath = expandPath(args.file);
    consola.info(`Target: ${handle.description}`);
    const uid = await handle.getUid();
    consola.info(`Exporting as uid=${uid}`);
    if (args.tables) consola.info(`Tables: ${args.tables.join(', ')}`);
    else consola.info(`Tables: defaults${args.includeSensitive ? ' + sensitive' : ''}`);

    consola.start('Fetching tables...');
    const result = await operations.exportBundle(handle.data, {
        source: handle.description.startsWith('cloud') ? 'cloud' : 'local',
        userId: uid,
        tables: args.tables,
        includeSensitive: args.includeSensitive,
        pageSize: args.pageSize,
        onProgress: (p) => {
            if (p.error) consola.warn(`${p.table}: ERROR — ${p.error}`);
            else consola.info(`${p.table}: ${p.rows} row(s)`);
        },
    });

    const json = JSON.stringify(result.bundle, null, 2);
    await fs.writeFile(fullPath, json, { mode: 0o600 });

    const totalRows = Object.values(result.bundle.tables).reduce((n, r) => n + r.length, 0);
    consola.box(
        `Wrote ${totalRows} row(s) across ${Object.keys(result.bundle.tables).length} table(s) → ${fullPath}\n` +
        `Bundle size: ${(json.length / 1024).toFixed(1)} KB`,
    );
    if (result.blockedTables.length > 0) {
        consola.info(`Skipped (telemetry, not portable): ${result.blockedTables.join(', ')}`);
    }
}

/** No-op DataAPI handle for dry-run import — avoids a needless connection. */
function noopHandle(target: Target): DataAPIHandle {
    return {
        data: {
            async query() { return { rows: [], statements: [] }; },
            async healthCheck() { return { ok: true, latency_ms: 0, tables: {} }; },
        },
        getUid: async () => '(dry-run)',
        close: async () => undefined,
        description: `(dry-run, would target ${target})`,
    };
}

export async function runData(args: DataArgs): Promise<void> {
    // Dry-run import doesn't read or write — no connection needed.
    const handle =
        args.sub === 'import' && args.dryRun
            ? noopHandle(args.target)
            : await makeDataAPI(args.target);
    try {
        if (args.sub === 'import') await doImport(args, handle);
        else await doExport(args, handle);
    } finally {
        await handle.close();
    }
}
