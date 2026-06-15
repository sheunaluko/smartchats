#!/usr/bin/env -S npx tsx
/**
 * audit_errors — cross-source error histogram (function_error sub-events
 * + top-level error event types).
 *
 * Per-signature rollup with count, distinct sessions/users, first/last
 * seen, and a sample session for drill-in.
 *
 * Usage:
 *   npm run audit:errors -- [options]
 *
 * Options:
 *   --source <s>          'function_error' | 'top_level_error' (default both).
 *   --since <when>        Default '7d'.
 *   --until <when>
 *   --app, --user, --session    Dimensional filters.
 *   --limit <n>           Default 50.
 *   --message-chars <n>   Char cap for signature message normalization. Default 80.
 *   --format <fmt>        text | table | json | csv | markdown
 *   --out <path>
 *   --url, --ns, --db, --user-cred, --password
 *   -h, --help
 */

import { writeFileSync } from 'node:fs';
import { createClient } from 'smartchats-database';
import { queryErrors, formatErrorsDb, type OutputFormat } from '../src/index.js';

const USAGE = `Usage: audit_errors [options]
  --source <s>             function_error | top_level_error (default both)
  --since, --until         Time window (default --since '7d')
  --app, --user, --session Dimensional filters
  --limit <n>              Default 50
  --message-chars <n>      Default 80
  --format <fmt>           text | table | json | csv | markdown
  --out <path>
  --url, --ns, --db, --user-cred, --password
  -h, --help`;

interface CliArgs {
    source?: 'function_error' | 'top_level_error';
    since: string;
    until?: string;
    app?: string;
    user?: string;
    session?: string;
    limit: number;
    messageChars: number;
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
        since: '7d',
        limit: 50,
        messageChars: 80,
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
            case '--source': {
                const v = next();
                if (v !== 'function_error' && v !== 'top_level_error') {
                    console.error(`--source must be 'function_error' or 'top_level_error', got: ${v}`);
                    return null;
                }
                a.source = v;
                break;
            }
            case '--since':         a.since = next(); break;
            case '--until':         a.until = next(); break;
            case '--app':           a.app = next(); break;
            case '--user':          a.user = next(); break;
            case '--session':       a.session = next(); break;
            case '--limit':         a.limit = Math.max(1, parseInt(next(), 10) || 50); break;
            case '--message-chars': a.messageChars = Math.max(20, parseInt(next(), 10) || 80); break;
            case '--format':        a.format = next() as OutputFormat; break;
            case '--out':           a.out = next(); break;
            case '--url':           a.url = next(); break;
            case '--ns':
            case '--namespace':     a.namespace = next(); break;
            case '--db':
            case '--database':      a.database = next(); break;
            case '--user-cred':     a.username = next(); break;
            case '--password':      a.password = next(); break;
            case '-h':
            case '--help':          return null;
            default:
                console.error(`unknown arg: ${arg}`);
                return null;
        }
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

const result = await queryErrors(client, {
    source: args.source,
    since: args.since,
    until: args.until,
    app: args.app,
    userId: args.user,
    sessionId: args.session,
    limit: args.limit,
    messageChars: args.messageChars,
});

const text = formatErrorsDb(result, { format: args.format });

if (args.out) {
    writeFileSync(args.out, text + '\n');
    console.error(`wrote ${result.rows.length} row(s) → ${args.out}`);
} else {
    process.stdout.write(text + '\n');
}

await client.close?.();
