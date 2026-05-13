/**
 * Shared CLI orchestration for `session_find`.
 *
 * Both the open-package CLI (defaults to local AIO) and the closed
 * cloud-admin CLI (root creds via env) consume this. The only thing
 * they differ on is **how the `Client` is constructed** — they pass a
 * factory in; everything else (arg parsing, dispatching, formatting)
 * lives here so the two entry points stay thin.
 *
 * Flag surface:
 *   --app <name>              filter to one app
 *   --tag t1,t2               session-level tag filter (AND across)
 *   --has-error               only sessions with ≥ 1 error event
 *   --has-event-tag <tag>     only sessions with ≥ 1 event tagged X (e.g. 'slow')
 *   --has-event-type <type>   only sessions emitting event_type at least once
 *   --missing-event-type <t>  only sessions NEVER emitting that event_type
 *   --min-events N, --max-events N
 *   --min-duration <ms>, --max-duration <ms>   inclusive duration bounds (ms or shorthand)
 *   --since <when>, --until <when>             ISO datetime OR shorthand ('7d', '24h', '30m', '2w')
 *   --limit N                 default 50
 *   --format=table|json|ids   default table; 'ids' = one session_id per line (pipe-friendly)
 *   -h, --help
 *
 * Output rendering (table mode): one row per session with
 *   session_id | app | start | duration | events | errors | llm | exec | tags
 */

import type { Client } from 'smartchats-database';
import { findCandidateSessions } from '../export.js';
import type { CandidateSessionsFilter, SessionCandidate } from '../types.js';

export type OutputFormat = 'table' | 'json' | 'ids';

export interface ParsedFindArgs {
    filter: CandidateSessionsFilter;
    format: OutputFormat;
    help: boolean;
}

/**
 * Parse a shorthand time spec OR an ISO string into epoch ms.
 *
 * Shorthand: `Nm`, `Nh`, `Nd`, `Nw` (minutes/hours/days/weeks) — interpreted
 * as "this many ago, relative to now".
 *
 * ISO: anything `Date.parse` accepts (e.g. `2026-05-01`,
 * `2026-05-01T12:34:56Z`).
 *
 * Returns ms since epoch. Throws on unrecognized input.
 */
export function parseTimeSpec(spec: string): number {
    const m = spec.match(/^(\d+)\s*([mhdw])$/i);
    if (m) {
        const n = parseInt(m[1], 10);
        const unitMs: Record<string, number> = {
            m: 60_000,
            h: 60 * 60_000,
            d: 24 * 60 * 60_000,
            w: 7 * 24 * 60 * 60_000,
        };
        return Date.now() - n * unitMs[m[2].toLowerCase()];
    }
    const parsed = Date.parse(spec);
    if (isNaN(parsed)) {
        throw new Error(`Cannot parse time spec: ${spec}. Use ISO (2026-05-01) or shorthand (7d, 24h, 30m, 2w).`);
    }
    return parsed;
}

/** Parse `Nms`, `Ns`, `Nm`, `Nh` durations OR a bare integer (ms). */
export function parseDurationSpec(spec: string): number {
    if (/^\d+$/.test(spec)) return parseInt(spec, 10);
    const m = spec.match(/^(\d+(?:\.\d+)?)\s*(ms|s|m|h)$/i);
    if (!m) throw new Error(`Cannot parse duration: ${spec}. Use Nms / Ns / Nm / Nh or a bare ms integer.`);
    const n = parseFloat(m[1]);
    const unitMs: Record<string, number> = { ms: 1, s: 1000, m: 60_000, h: 60 * 60_000 };
    return Math.round(n * unitMs[m[2].toLowerCase()]);
}

const HELP = `Usage: session_find [options]

Filters:
  --app <name>              filter to one app (e.g. smartchats)
  --tag <t1,t2,...>         session-level tag filter (AND across tags)
  --has-error               only sessions with ≥ 1 error event
  --has-event-tag <tag>     only sessions with ≥ 1 event tagged X (e.g. slow, cancel)
  --has-event-type <type>   only sessions emitting event_type at least once
  --missing-event-type <t>  only sessions that NEVER emitted that event_type
  --min-events N            inclusive
  --max-events N            inclusive
  --min-duration <spec>     ms or Nms/Ns/Nm/Nh   (e.g. 60000, 1m, 10s)
  --max-duration <spec>     same format
  --since <when>            ISO datetime or shorthand (7d, 24h, 30m, 2w)
  --until <when>            same format
  --limit N                 max sessions in output (default 50)

Output:
  --format=table|json|ids   default 'table'; 'ids' = one session_id per line (pipe-friendly)
  -h, --help

Examples:
  session_find --app smartchats --has-error --since 7d
  session_find --has-event-type llm_cancel --limit 20
  session_find --has-error --format=ids | xargs -I{} save_session --session-id {}
`;

const VALUED_FLAGS = new Set([
    '--app', '--tag', '--has-event-tag', '--has-event-type', '--missing-event-type',
    '--min-events', '--max-events', '--min-duration', '--max-duration',
    '--since', '--until', '--limit', '--format',
]);

export function parseFindArgs(argv: string[]): ParsedFindArgs {
    const filter: CandidateSessionsFilter = {};
    let format: OutputFormat = 'table';
    let help = false;

    const argList: string[] = [];
    for (const a of argv) {
        if (a.startsWith('--') && a.includes('=')) {
            const [k, v] = a.split('=', 2);
            argList.push(k, v);
        } else {
            argList.push(a);
        }
    }

    for (let i = 0; i < argList.length; i++) {
        const a = argList[i];
        const next = () => argList[++i];
        switch (a) {
            case '-h': case '--help': help = true; break;
            case '--app': filter.appName = next(); break;
            case '--tag': case '--tags':
                filter.tags = next().split(',').map((t) => t.trim()).filter(Boolean);
                break;
            case '--has-error': filter.hasError = true; break;
            case '--has-event-tag': filter.hasEventTag = next(); break;
            case '--has-event-type': filter.hasEventType = next(); break;
            case '--missing-event-type': filter.missingEventType = next(); break;
            case '--min-events': filter.minEvents = parseInt(next(), 10); break;
            case '--max-events': filter.maxEvents = parseInt(next(), 10); break;
            case '--min-duration': filter.minDurationMs = parseDurationSpec(next()); break;
            case '--max-duration': filter.maxDurationMs = parseDurationSpec(next()); break;
            case '--since': filter.sinceTimestamp = parseTimeSpec(next()); break;
            case '--until': filter.untilTimestamp = parseTimeSpec(next()); break;
            case '--limit': filter.limit = parseInt(next(), 10); break;
            case '--format': {
                const v = next();
                if (v !== 'table' && v !== 'json' && v !== 'ids') {
                    throw new Error(`Invalid --format: ${v}. Use table|json|ids.`);
                }
                format = v;
                break;
            }
            default:
                if (a.startsWith('-')) throw new Error(`Unknown option: ${a}`);
        }
        if (VALUED_FLAGS.has(a)) {
            // already advanced via next()
        }
    }

    return { filter, format, help };
}

// ── Output formatters ─────────────────────────────────────────────────────

function fmtDur(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    const m = Math.floor(ms / 60_000);
    const s = (ms % 60_000) / 1000;
    return `${m}m${s.toFixed(0)}s`;
}

function fmtShortIso(iso: string): string {
    // Strip the 'Z' and the trailing milliseconds for compactness.
    // 2026-05-12T09:32:45.084Z → 2026-05-12 09:32:45
    if (!iso) return '';
    return iso.replace('T', ' ').replace(/\.\d+Z?$/, '').replace(/Z$/, '');
}

function fmtTable(rows: SessionCandidate[]): string {
    if (rows.length === 0) return '(no sessions match)\n';
    const cols = [
        { name: 'session_id', get: (r: SessionCandidate) => r.session_id },
        { name: 'app',        get: (r: SessionCandidate) => r.app_name },
        { name: 'start',      get: (r: SessionCandidate) => fmtShortIso(r.start_time) },
        { name: 'duration',   get: (r: SessionCandidate) => fmtDur(r.duration_ms) },
        { name: 'events',     get: (r: SessionCandidate) => String(r.event_count) },
        { name: 'errors',     get: (r: SessionCandidate) => String(r.error_count) },
        { name: 'llm',        get: (r: SessionCandidate) => String(r.llm_count) },
        { name: 'exec',       get: (r: SessionCandidate) => String(r.execution_count) },
        { name: 'tags',       get: (r: SessionCandidate) => r.session_tags.join(',') },
    ];
    const widths = cols.map((c) => Math.max(c.name.length, ...rows.map((r) => c.get(r).length)));
    const fmt = (vals: string[]) => vals.map((v, i) => v.padEnd(widths[i])).join('  ');
    const lines: string[] = [];
    lines.push(fmt(cols.map((c) => c.name)));
    lines.push(fmt(widths.map((w) => '─'.repeat(w))));
    for (const r of rows) lines.push(fmt(cols.map((c) => c.get(r))));
    lines.push('');
    lines.push(`(${rows.length} session${rows.length === 1 ? '' : 's'})`);
    return lines.join('\n') + '\n';
}

export function formatCandidates(rows: SessionCandidate[], format: OutputFormat): string {
    switch (format) {
        case 'json': return JSON.stringify(rows, null, 2) + '\n';
        case 'ids':  return rows.map((r) => r.session_id).join('\n') + (rows.length ? '\n' : '');
        case 'table': return fmtTable(rows);
    }
}

// ── Orchestration ─────────────────────────────────────────────────────────

export interface RunFindCliOptions {
    /** Factory invoked once to produce a ready-to-query Client. */
    createClient: () => Promise<Client>;
    /** Process argv (slice already removing node + script). */
    argv: string[];
    /** Logger for non-output messages (default: console.error). */
    log?: (msg: string) => void;
}

/**
 * End-to-end CLI runner. Closed and open CLIs are thin wrappers around this.
 * Returns the process exit code.
 */
export async function runFindCli(opts: RunFindCliOptions): Promise<number> {
    const log = opts.log ?? ((m: string) => process.stderr.write(m + '\n'));
    let parsed: ParsedFindArgs;
    try {
        parsed = parseFindArgs(opts.argv);
    } catch (e) {
        log(String(e instanceof Error ? e.message : e));
        process.stderr.write(HELP);
        return 2;
    }
    if (parsed.help) {
        process.stdout.write(HELP);
        return 0;
    }

    const client = await opts.createClient();
    try {
        const candidates = await findCandidateSessions(client, parsed.filter);
        process.stdout.write(formatCandidates(candidates, parsed.format));
        return 0;
    } finally {
        // Best-effort cleanup — Client may or may not expose a close().
        const maybeClose = (client as unknown as { close?: () => Promise<void> }).close;
        if (typeof maybeClose === 'function') {
            try { await maybeClose.call(client); } catch { /* swallow */ }
        }
    }
}
