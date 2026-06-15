#!/usr/bin/env -S npx tsx
/**
 * monitor — live polling wrapper around any DB analyzer.
 *
 * Usage:
 *   npm run monitor -- <analyzer> [options]
 *
 * Analyzers:
 *   cost-by-session | cost-by-model | cost-by-user
 *   slow-calls | function-calls | function-args
 *   errors | users | context-growth | issues
 *
 * Options (common):
 *   --since <when>        Default '24h'.
 *   --until <when>
 *   --app, --user, --session    Dimensional filters.
 *   --limit <n>           Default 25.
 *   --interval <ms|2s|5s|1m>    Polling interval. Default 5s.
 *   --render live-table | append | silent     Default live-table.
 *   --url, --ns, --db, --user-cred, --password
 *   -h, --help
 *
 * Analyzer-specific:
 *   slow-calls:      --threshold-ms <n>  --name <comma-list>
 *   function-args:   --name <fn> (required)  --arg key=value (repeatable)
 *   errors:          --source <function_error|top_level_error>
 *   context-growth:  --by <absolute|jump>  --min-tokens <n>
 *   issues:          --kind <k>  --severity <info|warning|error>
 *
 * Library use:
 *   import { liveMonitor, queryFunctionCallHistogram } from 'smartchats-sessions';
 *   liveMonitor({ client, analyzer: queryFunctionCallHistogram, args: {...},
 *                 key: r => r.function_name, onNewRow: r => slack(...) }).start();
 */

import { createClient } from 'smartchats-database';
import {
    liveMonitor,
    type MonitorAnalyzerResult,
    // analyzers + formatters
    queryFunctionCallHistogram, formatFunctionCallHistogram,
    queryFunctionCallsByArgs, formatFunctionArgsCalls,
    querySlowFunctionCalls, formatSlowCalls,
    queryErrors, formatErrorsDb,
    queryUsersActivity, formatUsersActivity,
    queryContextGrowth, formatContextGrowth,
    queryIssues, formatIssues,
    queryCostBySession, queryCostByModel, queryCostByUser, formatCost,
    type ArgPredicate,
    type OutputFormat,
} from '../src/index.js';

// ──────────────────────────────────────────────────────────────────────────
// Analyzer registry
// ──────────────────────────────────────────────────────────────────────────

interface AnalyzerEntry {
    description: string;
    /** Wraps `liveMonitor()` for this analyzer. Receives merged args. */
    spawn: (client: any, args: any, interval: number, render: any) => ReturnType<typeof liveMonitor>;
    /** Parses analyzer-specific extras off the argv and returns them as a partial args object. */
    parseExtras?: (popArg: PopArgFn) => Record<string, unknown> | null;
}

type PopArgFn = () => string;

const REGISTRY: Record<string, AnalyzerEntry> = {
    'function-calls': {
        description: 'Per-function-name call histogram.',
        spawn: (client, args, intervalMs, render) =>
            liveMonitor({
                client, analyzer: queryFunctionCallHistogram, format: (r) => formatFunctionCallHistogram(r as any),
                args, intervalMs, render,
                key: (row: any) => String(row.function_name),
            }),
    },

    'slow-calls': {
        description: 'Function calls exceeding duration threshold.',
        spawn: (client, args, intervalMs, render) =>
            liveMonitor({
                client, analyzer: querySlowFunctionCalls, format: (r) => formatSlowCalls(r as any),
                args, intervalMs, render,
                key: (row: any) => String(row.event_id) + ':' + String(row.call_id ?? ''),
            }),
        parseExtras: (next) => {
            const out: Record<string, unknown> = {};
            // Inline parser handled in main parseArgs.
            return out;
        },
    },

    'function-args': {
        description: 'Filter calls by name + args predicate (--name required).',
        spawn: (client, args, intervalMs, render) =>
            liveMonitor({
                client, analyzer: queryFunctionCallsByArgs, format: (r) => formatFunctionArgsCalls(r as any),
                args, intervalMs, render,
                key: (row: any) => String(row.call_id ?? row.event_id),
            }),
    },

    'errors': {
        description: 'Error histogram (function_error + top-level error).',
        spawn: (client, args, intervalMs, render) =>
            liveMonitor({
                client, analyzer: queryErrors, format: (r) => formatErrorsDb(r as any),
                args, intervalMs, render,
                key: (row: any) => String(row.signature),
            }),
    },

    'users': {
        description: 'Per-user activity rollup.',
        spawn: (client, args, intervalMs, render) =>
            liveMonitor({
                client, analyzer: queryUsersActivity, format: (r) => formatUsersActivity(r as any),
                args, intervalMs, render,
                key: (row: any) => String(row.user_id),
            }),
    },

    'context-growth': {
        description: 'Prompt-size outliers (absolute or jump view).',
        spawn: (client, args, intervalMs, render) =>
            liveMonitor({
                client, analyzer: queryContextGrowth, format: (r) => formatContextGrowth(r as any),
                args, intervalMs, render,
                key: (row: any) => String(row.event_id),
            }),
    },

    'issues': {
        description: 'Per-kind issue histogram with severity buckets.',
        spawn: (client, args, intervalMs, render) =>
            liveMonitor({
                client, analyzer: queryIssues, format: (r) => formatIssues(r as any),
                args, intervalMs, render,
                key: (row: any) => String(row.kind),
            }),
    },

    // Cost analyzers return bare arrays; wrap to match the { rows } shape
    // the monitor framework + formatCost both want.
    'cost-by-session': {
        description: 'Per-session token + USD rollup.',
        spawn: (client, args, intervalMs, render) =>
            liveMonitor({
                client,
                analyzer: async (c, a) => ({ kind: 'by_session' as const, rows: await queryCostBySession(c, a) }),
                format: (r) => formatCost(r as any),
                args, intervalMs, render,
                key: (row: any) => String(row.session_id),
            }),
    },

    'cost-by-model': {
        description: 'Per-model token + USD rollup.',
        spawn: (client, args, intervalMs, render) =>
            liveMonitor({
                client,
                analyzer: async (c, a) => ({ kind: 'by_model' as const, rows: await queryCostByModel(c, a) }),
                format: (r) => formatCost(r as any),
                args, intervalMs, render,
                key: (row: any) => String(row.model),
            }),
    },

    'cost-by-user': {
        description: 'Per-user token + USD rollup.',
        spawn: (client, args, intervalMs, render) =>
            liveMonitor({
                client,
                analyzer: async (c, a) => ({ kind: 'by_user' as const, rows: await queryCostByUser(c, a) }),
                format: (r) => formatCost(r as any),
                args, intervalMs, render,
                key: (row: any) => String(row.user_id),
            }),
    },
};

// ──────────────────────────────────────────────────────────────────────────
// Arg parsing
// ──────────────────────────────────────────────────────────────────────────

interface CliArgs {
    analyzer: string;
    // Standard BaseFilter
    since: string;
    until?: string;
    app?: string;
    user?: string;
    session?: string;
    limit: number;
    // Monitor knobs
    intervalMs: number;
    render: 'live-table' | 'append' | 'silent';
    // Analyzer extras (flat — only the relevant ones are consumed)
    name?: string;
    argPredicates?: ArgPredicate[];
    thresholdMs?: number;
    nameFilter?: string[];
    source?: 'function_error' | 'top_level_error';
    by?: 'absolute' | 'jump';
    minTokens?: number;
    kind?: string;
    severity?: 'info' | 'warning' | 'error';
    // Connection
    url: string;
    namespace: string;
    database: string;
    username: string;
    password: string;
}

function parseInterval(s: string): number {
    const trimmed = s.trim();
    const m = trimmed.match(/^(\d+)(ms|s|m)?$/);
    if (!m) return NaN;
    const n = parseInt(m[1]!, 10);
    const unit = m[2] ?? 'ms';
    if (unit === 'ms') return n;
    if (unit === 's') return n * 1000;
    if (unit === 'm') return n * 60_000;
    return NaN;
}

const USAGE = (): string => {
    const names = Object.entries(REGISTRY)
        .map(([n, e]) => `  ${n.padEnd(18)}${e.description}`)
        .join('\n');
    return `Usage: monitor <analyzer> [options]

Analyzers:
${names}

Common options:
  --since <when>        Default '24h'.
  --until <when>
  --app, --user, --session    Dimensional filters.
  --limit <n>           Default 25.
  --interval <ms|2s|5s|1m>    Polling interval. Default 5s.
  --render live-table | append | silent     Default live-table.
  --url, --ns, --db, --user-cred, --password
  -h, --help

Analyzer-specific:
  slow-calls:      --threshold-ms <n>  --name <comma-list>
  function-args:   --name <fn> (required)  --arg key=value (repeatable)
  errors:          --source <function_error|top_level_error>
  context-growth:  --by <absolute|jump>  --min-tokens <n>
  issues:          --kind <k>  --severity <info|warning|error>`;
};

function parseArgs(argv: string[]): CliArgs | null {
    if (argv.length < 3 || argv[2] === '-h' || argv[2] === '--help') return null;

    const analyzer = argv[2]!;
    if (!(analyzer in REGISTRY)) {
        console.error(`unknown analyzer: ${analyzer}`);
        return null;
    }

    const a: CliArgs = {
        analyzer,
        since: '24h',
        limit: 25,
        intervalMs: 5000,
        render: 'live-table',
        url: process.env.SMARTCHATS_SESSION_URL ?? 'ws://localhost:8000/rpc',
        namespace: process.env.SMARTCHATS_SESSION_NS ?? 'production',
        database: process.env.SMARTCHATS_SESSION_DB ?? 'main',
        username: process.env.SMARTCHATS_SESSION_USER ?? 'root',
        password: process.env.SMARTCHATS_SESSION_PASSWORD ?? 'root',
    };

    for (let i = 3; i < argv.length; i++) {
        const arg = argv[i]!;
        const next = () => argv[++i]!;
        switch (arg) {
            case '--since':       a.since = next(); break;
            case '--until':       a.until = next(); break;
            case '--app':         a.app = next(); break;
            case '--user':        a.user = next(); break;
            case '--session':     a.session = next(); break;
            case '--limit':       a.limit = Math.max(1, parseInt(next(), 10) || 25); break;
            case '--interval': {
                const n = parseInterval(next());
                if (!Number.isFinite(n) || n < 250) {
                    console.error(`--interval invalid (must be ≥ 250ms): ${argv[i]}`);
                    return null;
                }
                a.intervalMs = n;
                break;
            }
            case '--render': {
                const v = next();
                if (v !== 'live-table' && v !== 'append' && v !== 'silent') {
                    console.error(`--render must be live-table | append | silent`); return null;
                }
                a.render = v;
                break;
            }
            // Per-analyzer extras (only consumed when the analyzer cares)
            case '--name':        a.name = next(); a.nameFilter = a.name.split(',').map((s) => s.trim()).filter(Boolean); break;
            case '--arg': {
                const kv = next();
                const eq = kv.indexOf('=');
                if (eq < 0) { console.error(`--arg expects key=value`); return null; }
                (a.argPredicates ??= []).push({ key: kv.slice(0, eq), value: kv.slice(eq + 1) });
                break;
            }
            case '--threshold-ms': a.thresholdMs = Math.max(0, parseInt(next(), 10) || 0); break;
            case '--source': {
                const v = next();
                if (v !== 'function_error' && v !== 'top_level_error') {
                    console.error(`--source must be function_error | top_level_error`); return null;
                }
                a.source = v;
                break;
            }
            case '--by': {
                const v = next();
                if (v !== 'absolute' && v !== 'jump') {
                    console.error(`--by must be absolute | jump`); return null;
                }
                a.by = v;
                break;
            }
            case '--min-tokens':  a.minTokens = Math.max(0, parseInt(next(), 10) || 0); break;
            case '--kind':        a.kind = next(); break;
            case '--severity': {
                const v = next();
                if (v !== 'info' && v !== 'warning' && v !== 'error') {
                    console.error(`--severity must be info | warning | error`); return null;
                }
                a.severity = v;
                break;
            }
            // Connection
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

    // function-args requires --name
    if (analyzer === 'function-args' && !a.name) {
        console.error(`function-args requires --name <fn>`);
        return null;
    }

    return a;
}

// Compose the per-analyzer args bag from CliArgs.
function buildAnalyzerArgs(a: CliArgs): Record<string, unknown> {
    const base: Record<string, unknown> = {
        since: a.since,
        until: a.until,
        app: a.app,
        userId: a.user,
        sessionId: a.session,
        limit: a.limit,
    };

    switch (a.analyzer) {
        case 'slow-calls':
            if (a.thresholdMs !== undefined) base.minDurationMs = a.thresholdMs;
            if (a.nameFilter && a.nameFilter.length) base.nameFilter = a.nameFilter;
            break;
        case 'function-args':
            base.name = a.name!;
            base.args = a.argPredicates ?? [];
            break;
        case 'errors':
            if (a.source) base.source = a.source;
            break;
        case 'context-growth':
            if (a.by) base.by = a.by;
            if (a.minTokens !== undefined) base.minTokens = a.minTokens;
            break;
        case 'issues':
            if (a.kind) base.kind = a.kind;
            if (a.severity) base.severity = a.severity;
            break;
    }
    return base;
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────

const args = parseArgs(process.argv);
if (!args) { console.error(USAGE()); process.exit(1); }

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

const analyzerArgs = buildAnalyzerArgs(args);
const entry = REGISTRY[args.analyzer]!;
const controller = entry.spawn(client, analyzerArgs, args.intervalMs, args.render);

// Clean exit on SIGINT — restore cursor + drop connection.
let shutting = false;
const handleStop = async () => {
    if (shutting) return;
    shutting = true;
    process.stderr.write(`\n[monitor] shutting down…\n`);
    await controller.stop();
    await client.close?.();
    process.exit(0);
};
process.on('SIGINT', handleStop);
process.on('SIGTERM', handleStop);

await controller.start();
