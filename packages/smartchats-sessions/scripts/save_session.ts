#!/usr/bin/env -S npx tsx
/**
 * Local-AIO session export CLI.
 *
 * Connects with root creds to a SurrealDB instance (defaults to the local
 * AIO at ws://localhost:8000/rpc with root/root) and exports one or more
 * sessions matching the supplied filters.
 *
 * For cloud exports, see `packages/smartchats-cloud/scripts/cloud_save_session.ts`
 * — same logic, different connection wiring.
 *
 * Usage:
 *
 *   npm run save-session -- [options]
 *
 * Options:
 *   --app <name>          App name to filter by (e.g. smartchats, rai). Optional
 *                         when --session-id is given.
 *   --tag <t1,t2,...>     Comma-separated tags. Sessions must have ALL of them.
 *   --session-id <id>     Specific session to export. Skips the find step.
 *   --last <n>            Export the N most recent matching sessions (default 1).
 *   --out <dir>           Output directory. Default ~/.smartchats/sessions/
 *   --url <ws-url>        SurrealDB websocket URL. Default ws://localhost:8000/rpc
 *   --ns <namespace>      Default 'production'.
 *   --db <database>       Default 'main'.
 *   --user, --password    Root credentials. Defaults root/root (matches AIO).
 *   -h, --help            Show this help.
 *
 * Env-var overrides (lower precedence than flags):
 *   SMARTCHATS_SESSION_URL, SMARTCHATS_SESSION_NS, SMARTCHATS_SESSION_DB,
 *   SMARTCHATS_SESSION_USER, SMARTCHATS_SESSION_PASSWORD
 */

import { homedir } from 'node:os';
import { join } from 'node:path';
import { createClient } from 'smartchats-database';
import {
    exportSessionToFile,
    exportRecentSessionsToFiles,
    findSessions,
} from '../src/index.js';

interface CliArgs {
    app?: string;
    tags?: string[];
    sessionId?: string;
    last: number;
    outputDir: string;
    url: string;
    namespace: string;
    database: string;
    username: string;
    password: string;
}

function parseArgs(argv: string[]): CliArgs | null {
    const args: Partial<CliArgs> = {
        last: 1,
        outputDir: join(homedir(), '.smartchats', 'sessions'),
        url: process.env.SMARTCHATS_SESSION_URL ?? 'ws://localhost:8000/rpc',
        namespace: process.env.SMARTCHATS_SESSION_NS ?? 'production',
        database: process.env.SMARTCHATS_SESSION_DB ?? 'main',
        username: process.env.SMARTCHATS_SESSION_USER ?? 'root',
        password: process.env.SMARTCHATS_SESSION_PASSWORD ?? 'root',
    };

    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        const next = () => argv[++i];
        switch (a) {
            case '--app':         args.app = next(); break;
            case '--tag':
            case '--tags':        args.tags = next().split(',').map((t) => t.trim()).filter(Boolean); break;
            case '--session-id':
            case '--session':     args.sessionId = next(); break;
            case '--last':        args.last = Math.max(1, parseInt(next(), 10) || 1); break;
            case '--out':
            case '--output-dir':  args.outputDir = next(); break;
            case '--url':         args.url = next(); break;
            case '--ns':
            case '--namespace':   args.namespace = next(); break;
            case '--db':
            case '--database':    args.database = next(); break;
            case '--user':
            case '--username':    args.username = next(); break;
            case '--password':    args.password = next(); break;
            case '-h':
            case '--help':        return null;
            default:
                console.error(`Unknown option: ${a}`);
                return null;
        }
    }
    return args as CliArgs;
}

function printHelp(): void {
    console.log(`Usage: npm run save-session -- [options]

Exports SmartChats session bundles (insights_events) from a SurrealDB
instance to JSON files on disk. Defaults assume the local AIO container.

Options:
  --app <name>          App name filter (smartchats, rai, etc.)
  --tag <t1,t2,...>     Comma-separated tags (AND match)
  --session-id <id>     Specific session_id (skips the find step)
  --last <n>            Export N most recent matching sessions (default 1)
  --out <dir>           Output dir (default ~/.smartchats/sessions/)
  --url <ws-url>        Default ws://localhost:8000/rpc
  --ns <namespace>      Default 'production'
  --db <database>       Default 'main'
  --user, --password    Default root/root (AIO)
  -h, --help            Show this help

For cloud exports, see packages/smartchats-cloud/scripts/cloud_save_session.ts
`);
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    if (!args) {
        printHelp();
        process.exit(args === null ? 0 : 1);
    }

    if (!args.app && !args.sessionId) {
        console.error('Error: either --app or --session-id is required.\n');
        printHelp();
        process.exit(1);
    }

    console.log(`[save_session] connecting to ${args.url} (${args.namespace}/${args.database})`);
    const client = createClient({
        url: args.url,
        namespace: args.namespace,
        database: args.database,
        auth: { username: args.username, password: args.password },
    });

    try {
        await client.connect();
    } catch (err) {
        console.error(`[save_session] connect failed: ${(err as Error).message}`);
        console.error(`Is the SurrealDB instance running at ${args.url}?`);
        process.exit(1);
    }

    try {
        if (args.sessionId) {
            // Specific session — single export.
            const result = await exportSessionToFile(
                client,
                { sessionId: args.sessionId },
                { outputDir: args.outputDir },
            );
            if (!result) {
                console.error(`[save_session] no events found for session_id ${args.sessionId}`);
                process.exit(2);
            }
            console.log(`[save_session] wrote ${result.path} (${result.event_count} events)`);
            return;
        }

        // App-level export — find recent sessions, then export each.
        const findArgs = {
            appName: args.app,
            tags: args.tags,
            limit: args.last,
        };

        // Tell the user what we're targeting.
        const sessions = await findSessions(client, findArgs);
        if (sessions.length === 0) {
            const filterDesc = [
                args.app && `app=${args.app}`,
                args.tags && `tags=[${args.tags.join(',')}]`,
            ].filter(Boolean).join(' ');
            console.error(`[save_session] no sessions found matching ${filterDesc}`);
            process.exit(2);
        }
        console.log(
            `[save_session] found ${sessions.length} session(s); exporting all to ${args.outputDir}`,
        );

        const results = await exportRecentSessionsToFiles(client, findArgs, {
            outputDir: args.outputDir,
        });
        for (const r of results) {
            console.log(`[save_session]   wrote ${r.path} (${r.event_count} events)`);
        }
        console.log(`[save_session] done — ${results.length} session(s) exported`);
    } finally {
        await client.close().catch(() => undefined);
    }
}

main().catch((err) => {
    console.error('[save_session] fatal:', err);
    process.exit(1);
});
