#!/usr/bin/env -S npx tsx
/**
 * One-shot migration — replays historical `handled.json` error entries as
 * `error_status_change` events in `insights_events`.
 *
 * The pre-DB triage system stored fixed / wontfix marks in a local JSON
 * file. Now that audit:errors reads status from the DB, historical marks
 * need to land there or they'll appear unhandled in audit output.
 *
 * Idempotent-ish: since events are append-only, re-running duplicates
 * marks. That's semantically fine (latest wins per signature_hash), but
 * noisy — use --dry-run to preview first.
 *
 * Usage:
 *   npm run migrate:handled-json-to-db -- [options]
 *
 * Options:
 *   --state <path>     Path to handled.json (default: $SMARTCHATS_TRIAGE_STATE_FILE
 *                      or <repo>/data/triage/handled.json).
 *   --url, --ns, --db, --user-cred, --password   DB connection.
 *   --dry-run          Print planned inserts; make no DB writes.
 *   -h, --help
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient, insertInsightEvent } from 'smartchats-database';
import {
    buildErrorStatusChangePayload,
    ERROR_STATUS_CHANGE_EVENT_TYPE,
} from 'smartchats-common';
import type { HandledState } from '../src/analysis/triage_errors.js';
import { parseArgs, die } from './_cli_lib.js';

const USAGE = `Usage: migrate_handled_json_to_db [options]
  --state <path>     handled.json path (default: env SMARTCHATS_TRIAGE_STATE_FILE
                                        || <repo>/data/triage/handled.json)
  --url, --ns, --db, --user-cred, --password
  --dry-run          Preview only
  -h, --help
`;

const VALUED = new Set([
    '--state', '--url', '--ns', '--namespace', '--db', '--database',
    '--user-cred', '--password',
]);

function defaultStatePath(): string {
    const here = dirname(fileURLToPath(import.meta.url));
    return resolve(here, '..', '..', '..', 'data', 'triage', 'handled.json');
}

function makeEventId(): string {
    return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

const args = parseArgs(process.argv, VALUED);
if (args.flags.has('-h') || args.flags.has('--help')) die(USAGE, 0);

const statePath = args.values['--state'] ?? process.env.SMARTCHATS_TRIAGE_STATE_FILE ?? defaultStatePath();
if (!existsSync(statePath)) die(`No handled.json at ${statePath}`);

const state = JSON.parse(readFileSync(statePath, 'utf-8')) as HandledState;
const entries = Object.entries(state.entries ?? {});
if (entries.length === 0) {
    process.stderr.write('No entries to migrate.\n');
    process.exit(0);
}

const dryRun = args.flags.has('--dry-run');

process.stderr.write(`Found ${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} in ${statePath}\n`);

if (dryRun) {
    process.stderr.write('DRY RUN — no writes will be performed.\n\n');
    for (const [hash, e] of entries) {
        process.stderr.write(`  ${hash}  [${e.status}]  ${e.signature_preview.slice(0, 80)}\n`);
        if (e.fixed_in_commit) process.stderr.write(`      commit=${e.fixed_in_commit}\n`);
        if (e.fixed_at) process.stderr.write(`      fixed_at=${e.fixed_at}\n`);
    }
    process.exit(0);
}

const url = args.values['--url'] ?? process.env.SMARTCHATS_SESSION_URL ?? 'ws://localhost:8000/rpc';
const client = createClient({
    url,
    namespace: args.values['--ns'] ?? args.values['--namespace'] ?? process.env.SMARTCHATS_SESSION_NS ?? 'production',
    database: args.values['--db'] ?? args.values['--database'] ?? process.env.SMARTCHATS_SESSION_DB ?? 'main',
    auth: {
        username: args.values['--user-cred'] ?? process.env.SMARTCHATS_SESSION_USER ?? 'root',
        password: args.values['--password'] ?? process.env.SMARTCHATS_SESSION_PASSWORD ?? 'root',
    },
});

try {
    await client.connect();
} catch (err) {
    die(`connect failed (${url}): ${(err as Error).message}`);
}

let inserted = 0;
try {
    for (const [hash, e] of entries) {
        const payload = buildErrorStatusChangePayload({
            signature_hash: hash,
            signature_preview: e.signature_preview,
            status: e.status,
            fixed_at: e.fixed_at,
            fixed_in_commit: e.fixed_in_commit,
            notes: e.notes,
            marked_by: e.marked_by,
        }) as unknown as Record<string, unknown>;
        // Preserve the original marked_at for historical accuracy.
        const timestamp = e.marked_at ?? e.fixed_at ?? new Date().toISOString();
        const spec = insertInsightEvent({
            event_type: ERROR_STATUS_CHANGE_EVENT_TYPE,
            event_id: makeEventId(),
            payload,
            timestamp,
        });
        await client.runQuery(spec);
        inserted += 1;
        process.stderr.write(`  ✓ ${hash}  [${e.status}]  ${e.signature_preview.slice(0, 60)}\n`);
    }
    process.stderr.write(`\nMigrated ${inserted}/${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} → ${url}\n`);
} finally {
    await client.close?.();
}
