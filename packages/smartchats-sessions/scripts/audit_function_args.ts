#!/usr/bin/env -S npx tsx
/**
 * audit_function-args — find every call to <function_name> with matching
 * args.
 *
 * Use case: "show me every `save_log` with category='dreams'" or "every
 * retrieve_metrics for metric_name='weight_lbs'".
 *
 * Usage:
 *   npm run audit:function-args -- --name <fn_name> [--arg key=value ...]
 *
 * Options:
 *   --name <fn_name>      Function name to match. Required.
 *   --arg <k>=<v>         Args predicate (repeatable, AND-matched).
 *                         Supports dot-paths: --arg metadata.kind=dream
 *   --since <when>        Default '30d' (this view often needs a wider window).
 *   --until <when>
 *   --app <name>, --user <id>, --session <id>
 *   --limit <n>           Default 50.
 *   --format <fmt>        text | table | json | csv | markdown
 *   --out <path>
 *   --url, --ns, --db, --user-cred, --password
 *   -h, --help
 */

import { writeFileSync } from 'node:fs';
import { createClient } from 'smartchats-database';
import {
    queryFunctionCallsByArgs,
    formatFunctionArgsCalls,
    type ArgPredicate,
    type OutputFormat,
} from '../src/index.js';

const USAGE = `Usage: audit_function-args --name <fn> [--arg key=value]+ [options]
  --name <fn_name>      Function name. Required.
  --arg <k>=<v>         Args predicate. Repeatable. Dot-paths supported.
  --since, --until      Time window (default --since '30d').
  --app, --user, --session    Dimensional filters.
  --limit <n>           Default 50.
  --format <fmt>        text | table | json | csv | markdown
  --out <path>
  --url, --ns, --db, --user-cred, --password
  -h, --help`;

interface CliArgs {
    name?: string;
    argPredicates: ArgPredicate[];
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
        argPredicates: [],
        since: '30d',
        limit: 50,
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
            case '--name':      a.name = next(); break;
            case '--arg': {
                const kv = next();
                const eq = kv.indexOf('=');
                if (eq < 0) { console.error(`--arg expects key=value, got: ${kv}`); return null; }
                a.argPredicates.push({ key: kv.slice(0, eq), value: kv.slice(eq + 1) });
                break;
            }
            case '--since':     a.since = next(); break;
            case '--until':     a.until = next(); break;
            case '--app':       a.app = next(); break;
            case '--user':      a.user = next(); break;
            case '--session':   a.session = next(); break;
            case '--limit':     a.limit = Math.max(1, parseInt(next(), 10) || 50); break;
            case '--format':    a.format = next() as OutputFormat; break;
            case '--out':       a.out = next(); break;
            case '--url':       a.url = next(); break;
            case '--ns':
            case '--namespace': a.namespace = next(); break;
            case '--db':
            case '--database':  a.database = next(); break;
            case '--user-cred': a.username = next(); break;
            case '--password':  a.password = next(); break;
            case '-h':
            case '--help':      return null;
            default:
                console.error(`unknown arg: ${arg}`);
                return null;
        }
    }
    if (!a.name) { console.error('--name is required'); return null; }
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

const result = await queryFunctionCallsByArgs(client, {
    name: args.name!,
    args: args.argPredicates,
    since: args.since,
    until: args.until,
    app: args.app,
    userId: args.user,
    sessionId: args.session,
    limit: args.limit,
});

const text = formatFunctionArgsCalls(result, { format: args.format });

if (args.out) {
    writeFileSync(args.out, text + '\n');
    console.error(`wrote ${result.rows.length} row(s) → ${args.out}`);
} else {
    process.stdout.write(text + '\n');
}

await client.close?.();
