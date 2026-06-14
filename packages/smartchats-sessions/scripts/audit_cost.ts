#!/usr/bin/env -S npx tsx
/**
 * audit_cost — DB-side cost rollup CLI.
 *
 * Connects with root creds to a SurrealDB instance (defaults to the local
 * AIO at ws://localhost:8000/rpc with root/root) and reports LLM cost
 * rollups by session, model, or user. Pure aggregation at the DB layer
 * for token totals; per-(session, model) tuple cost computed via cortex's
 * model_registry.calculateCost.
 *
 * Usage:
 *   npm run audit:cost -- [options]
 *
 * Options:
 *   --by <axis>           session (default) | model | user | call-tuple
 *   --since <when>        ISO datetime OR shorthand (7d, 24h, 30m, 2w). Default '7d'.
 *   --until <when>        Upper bound (default 'now').
 *   --app <name>          Filter to one app_name.
 *   --user <id>           Filter to one user_id.
 *   --session <id>        Filter to one session_id.
 *   --limit <n>           Cap on rows (default 20).
 *   --format <fmt>        text (default) | table | json | csv | markdown
 *   --out <path>          Write to file (default stdout).
 *   --url <ws-url>        SurrealDB websocket URL. Default ws://localhost:8000/rpc.
 *   --ns <namespace>      Default 'production'.
 *   --db <database>       Default 'main'.
 *   --user-cred, --password   Root credentials. Defaults root/root (AIO).
 *   -h, --help
 *
 * Closed-cloud variant lives at packages/smartchats-cloud/scripts/cloud_audit_cost.ts
 * (when added). Same logic, cloud root-cred createClient factory.
 */

import { writeFileSync } from 'node:fs';
import { createClient } from 'smartchats-database';
import {
    queryCostByCallTuple,
    queryCostBySession,
    queryCostByModel,
    queryCostByUser,
    formatCost,
    type CostResult,
    type OutputFormat,
} from '../src/index.js';

const USAGE = `Usage: audit_cost [options]
  --by <axis>           session (default) | model | user | call-tuple
  --since <when>        ISO datetime OR shorthand (7d, 24h, 30m, 2w). Default '7d'.
  --until <when>        Upper bound (default 'now').
  --app <name>          Filter to one app_name.
  --user <id>           Filter to one user_id.
  --session <id>        Filter to one session_id.
  --limit <n>           Cap on rows (default 20).
  --format <fmt>        text | table | json | csv | markdown
  --out <path>          Write to file (default stdout).
  --url, --ns, --db     DB connection.
  --user-cred, --password  Root credentials.
  -h, --help`;

interface CliArgs {
    by: 'session' | 'model' | 'user' | 'call-tuple';
    since: string;
    until?: string;
    app?: string;
    user?: string;
    session?: string;
    limit: number;
    format: OutputFormat;
    out?: string;
    url: string;
    namespace: string;
    database: string;
    username: string;
    password: string;
}

function parseArgs(argv: string[]): CliArgs | null {
    const a: CliArgs = {
        by: 'session',
        since: '7d',
        limit: 20,
        format: 'text',
        url: process.env.SMARTCHATS_SESSION_URL ?? 'ws://localhost:8000/rpc',
        namespace: process.env.SMARTCHATS_SESSION_NS ?? 'production',
        database: process.env.SMARTCHATS_SESSION_DB ?? 'main',
        username: process.env.SMARTCHATS_SESSION_USER ?? 'root',
        password: process.env.SMARTCHATS_SESSION_PASSWORD ?? 'root',
    };

    for (let i = 2; i < argv.length; i++) {
        const arg = argv[i]!;
        const next = () => argv[++i]!;
        switch (arg) {
            case '--by':         a.by = next() as CliArgs['by']; break;
            case '--since':      a.since = next(); break;
            case '--until':      a.until = next(); break;
            case '--app':        a.app = next(); break;
            case '--user':       a.user = next(); break;
            case '--session':    a.session = next(); break;
            case '--limit':      a.limit = Math.max(1, parseInt(next(), 10) || 20); break;
            case '--format':     a.format = next() as OutputFormat; break;
            case '--out':        a.out = next(); break;
            case '--url':        a.url = next(); break;
            case '--ns':
            case '--namespace':  a.namespace = next(); break;
            case '--db':
            case '--database':   a.database = next(); break;
            case '--user-cred':  a.username = next(); break;
            case '--password':   a.password = next(); break;
            case '-h':
            case '--help':       return null;
            default:
                console.error(`unknown arg: ${arg}`);
                return null;
        }
    }
    if (!['session', 'model', 'user', 'call-tuple'].includes(a.by)) {
        console.error(`invalid --by ${a.by}`); return null;
    }
    return a;
}

const args = parseArgs(process.argv);
if (!args) { console.error(USAGE); process.exit(1); }

const client = createClient({
    url: args.url,
    namespace: args.namespace,
    database: args.database,
    auth: { username: args.username, password: args.password },
});

try {
    await client.connect();
} catch (err) {
    console.error(`connect failed (${args.url}): ${(err as Error).message}`);
    process.exit(2);
}

const filter = {
    since: args.since,
    until: args.until,
    app: args.app,
    userId: args.user,
    sessionId: args.session,
    limit: args.limit,
};

let result: CostResult;
switch (args.by) {
    case 'session':
        result = { kind: 'by_session', rows: await queryCostBySession(client, filter) };
        break;
    case 'model':
        result = { kind: 'by_model', rows: await queryCostByModel(client, filter) };
        break;
    case 'user':
        result = { kind: 'by_user', rows: await queryCostByUser(client, filter) };
        break;
    case 'call-tuple':
        result = { kind: 'by_call_tuple', rows: await queryCostByCallTuple(client, filter) };
        break;
}

const text = formatCost(result, { format: args.format });

if (args.out) {
    writeFileSync(args.out, text + '\n');
    console.error(`wrote ${result.rows.length} row(s) → ${args.out}`);
} else {
    process.stdout.write(text + '\n');
}

await client.close?.();
