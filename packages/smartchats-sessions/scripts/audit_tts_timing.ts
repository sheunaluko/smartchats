#!/usr/bin/env -S npx tsx
/**
 * audit_tts_timing — TTS playback timing health analyzer.
 *
 * Two modes:
 *   --by session (default) — per-session aggregate, worst-first sort
 *   --by chunk-index       — per-chunk-index lateness histogram
 *
 * Anomaly thresholds: snap_rate > 0.5  |  chunk0_snap_pct > 50%  |
 * max_gap_ms > 500.  --anomalies filters to sessions exceeding any of them.
 *
 * Usage:
 *   npm run audit:tts-timing -- [options]
 */

import { writeFileSync } from 'node:fs';
import { createClient } from 'smartchats-database';
import {
    queryTtsTiming, queryTtsTimingByChunkIndex, queryTtsTimingWorstUtterances,
    queryTtsTimingChunk01Attribution,
    formatTtsTiming, type OutputFormat,
} from '../src/index.js';

const USAGE = `Usage: audit_tts_timing [options]
  --by <dim>               session (default) | chunk-index | worst-utterance | chunk01-attribution
  --anomalies              session mode: filter to anomaly-exceeding sessions only
  --top <n>                worst-utterance mode: how many to surface (default 1)
  --window-seconds <n>     worst-utterance mode: ± seconds of context to fetch (default 15)
  --since, --until         Time window (default --since '7d').
  --app, --user, --session Dimensional filters.
  --limit <n>              Default 50.
  --format <fmt>           text | table | json | csv | markdown
  --out <path>
  --url, --ns, --db, --user-cred, --password
  -h, --help`;

interface CliArgs {
    by: 'session' | 'chunk-index' | 'worst-utterance' | 'chunk01-attribution';
    anomalies: boolean;
    top: number;
    windowSeconds: number;
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
        anomalies: false,
        top: 1,
        // tts_playback_timing fires AFTER playback completes; the stream
        // started `stream_duration_ms` (typically 5-10s) earlier. 15s catches
        // the lead-up activity (TTS server timing, LLM completion, etc.).
        windowSeconds: 15,
        since: '7d',
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
            case '--by': {
                const v = next();
                if (v !== 'session' && v !== 'chunk-index' && v !== 'worst-utterance' && v !== 'chunk01-attribution') {
                    console.error(`--by must be session | chunk-index | worst-utterance | chunk01-attribution, got: ${v}`);
                    return null;
                }
                a.by = v;
                break;
            }
            case '--worst-utterance':
                // Shorthand for --by worst-utterance
                a.by = 'worst-utterance';
                break;
            case '--chunk01-attribution':
                // Shorthand for --by chunk01-attribution
                a.by = 'chunk01-attribution';
                break;
            case '--top':
                a.top = Math.max(1, parseInt(next(), 10) || 1);
                break;
            case '--window-seconds':
                a.windowSeconds = Math.max(1, parseInt(next(), 10) || 5);
                break;
            case '--anomalies':   a.anomalies = true; break;
            case '--since':       a.since = next(); break;
            case '--until':       a.until = next(); break;
            case '--app':         a.app = next(); break;
            case '--user':        a.user = next(); break;
            case '--session':     a.session = next(); break;
            case '--limit':       a.limit = Math.max(1, parseInt(next(), 10) || 50); break;
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

const baseArgs = {
    since: args.since,
    until: args.until,
    app: args.app,
    userId: args.user,
    sessionId: args.session,
    limit: args.limit,
};

const result =
    args.by === 'chunk-index'
        ? await queryTtsTimingByChunkIndex(client, baseArgs)
        : args.by === 'worst-utterance'
            ? await queryTtsTimingWorstUtterances(client, {
                ...baseArgs,
                top: args.top,
                windowSeconds: args.windowSeconds,
            })
            : args.by === 'chunk01-attribution'
                ? await queryTtsTimingChunk01Attribution(client, baseArgs)
                : await queryTtsTiming(client, { ...baseArgs, anomalies: args.anomalies });

const text = formatTtsTiming(result, { format: args.format });

if (args.out) {
    writeFileSync(args.out, text + '\n');
    console.error(`wrote ${result.rows.length} row(s) → ${args.out}`);
} else {
    process.stdout.write(text + '\n');
}

await client.close?.();
