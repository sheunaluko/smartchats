#!/usr/bin/env -S npx tsx
/**
 * audit_context-growth — LLM prompt-size outliers.
 *
 * Two view modes:
 *   --by absolute    Top N llm_invocations by input_tokens.
 *   --by jump        Top N within-session deltas vs the previous turn.
 *
 * Usage:
 *   npm run audit:context-growth -- [options]
 *
 * Options:
 *   --by <absolute|jump>  Default 'absolute'.
 *   --min-tokens <n>      Exclude rows where the sort key is below this.
 *   --since <when>        Default '7d'.
 *   --until <when>
 *   --app, --user, --session    Dimensional filters.
 *   --limit <n>           Default 25.
 *   --format <fmt>        text | table | json | csv | markdown
 *   --out <path>
 *   --url, --ns, --db, --user-cred, --password
 *   -h, --help
 */

import { writeFileSync } from 'node:fs';
import { createClient } from 'smartchats-database';
import { queryContextGrowth, formatContextGrowth, type OutputFormat } from '../src/index.js';

const USAGE = `Usage: audit_context-growth [options]
  --by <absolute|jump>     Default 'absolute'.
  --min-tokens <n>         Floor on the sort key.
  --since, --until         Time window (default --since '7d').
  --app, --user, --session Dimensional filters.
  --limit <n>              Default 25.
  --format <fmt>           text | table | json | csv | markdown
  --out <path>
  --url, --ns, --db, --user-cred, --password
  -h, --help`;

interface CliArgs {
    by: 'absolute' | 'jump';
    minTokens: number;
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
        by: 'absolute',
        minTokens: 0,
        since: '7d',
        limit: 25,
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
            case '--by': {
                const v = next();
                if (v !== 'absolute' && v !== 'jump') {
                    console.error(`--by must be 'absolute' or 'jump', got: ${v}`);
                    return null;
                }
                a.by = v;
                break;
            }
            case '--min-tokens':  a.minTokens = Math.max(0, parseInt(next(), 10) || 0); break;
            case '--since':       a.since = next(); break;
            case '--until':       a.until = next(); break;
            case '--app':         a.app = next(); break;
            case '--user':        a.user = next(); break;
            case '--session':     a.session = next(); break;
            case '--limit':       a.limit = Math.max(1, parseInt(next(), 10) || 25); break;
            case '--format':      a.format = next() as OutputFormat; break;
            case '--out':         a.out = next(); break;
            case '--url':         a.url = next(); break;
            case '--ns':
            case '--namespace':   a.namespace = next(); break;
            case '--db':
            case '--database':    a.database = next(); break;
            case '--user-cred':   a.username = next(); break;
            case '--password':    a.password = next(); break;
            case '-h':
            case '--help':        return null;
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

const result = await queryContextGrowth(client, {
    by: args.by,
    minTokens: args.minTokens,
    since: args.since,
    until: args.until,
    app: args.app,
    userId: args.user,
    sessionId: args.session,
    limit: args.limit,
});

const text = formatContextGrowth(result, { format: args.format });

if (args.out) {
    writeFileSync(args.out, text + '\n');
    console.error(`wrote ${result.rows.length} row(s) → ${args.out}`);
} else {
    process.stdout.write(text + '\n');
}

await client.close?.();
