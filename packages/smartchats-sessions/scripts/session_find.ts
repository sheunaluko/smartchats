#!/usr/bin/env -S npx tsx
/**
 * session_find — cross-session triage against a SmartChats SurrealDB.
 * Defaults to the local AIO at ws://localhost:8000/rpc with root/root
 * credentials. Single-user host, root-on-localhost — fine for self-hosted
 * users.
 *
 * Run via the package script: `npm run find-sessions -- [options]`.
 *
 * See full flag docs by running with `--help`. CLI orchestration
 * (arg parsing, dispatching, output formatting) lives in
 * `src/cli/find_cli.ts`.
 */

import { createClient } from 'smartchats-database';
import { runFindCli } from '../src/cli/find_cli.js';

const url = process.env.SMARTCHATS_SESSION_URL ?? 'ws://localhost:8000/rpc';
const namespace = process.env.SMARTCHATS_SESSION_NS ?? 'production';
const database = process.env.SMARTCHATS_SESSION_DB ?? 'main';
const username = process.env.SMARTCHATS_SESSION_USER ?? 'root';
const password = process.env.SMARTCHATS_SESSION_PASSWORD ?? 'root';

const exitCode = await runFindCli({
    argv: process.argv.slice(2),
    log: (m) => process.stderr.write(m + '\n'),
    createClient: async () => {
        process.stderr.write(`[session_find] connecting to ${url} (${namespace}/${database})\n`);
        const client = createClient({
            url,
            namespace,
            database,
            auth: { username, password },
        });
        try {
            await client.connect();
        } catch (err) {
            process.stderr.write(`[session_find] connect failed: ${(err as Error).message}\n`);
            process.stderr.write(`Is SurrealDB running at ${url}? (Run \`bin/aio -d\` to start the local AIO.)\n`);
            process.exit(1);
        }
        return client;
    },
});

process.exit(exitCode);
