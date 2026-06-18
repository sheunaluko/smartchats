/**
 * Issues histogram — surfaces structured `event_type: 'issue'` reports.
 *
 * Issues can come from anywhere that calls into the insights pipeline:
 *   - the `report_issue` agent tool (apps/smartchats/app/modules/issues.ts)
 *   - future runtime detectors (SCM, tool dispatcher, etc.)
 *   - manual flags from operator scripts
 *
 * Per-kind rollup with severity bucket counts, distinct sessions/users,
 * first/last seen, and a representative summary per kind for drill-in.
 * Source surfaces as a column rather than a grouping dimension since
 * sources will proliferate; the kind histogram is the right primary axis.
 */
import type { Client } from 'smartchats-database';

import { type BaseFilter, buildFilterClause, combineWhere } from './_query_helpers.js';
import { type FormatOpts, renderRows } from './_format.js';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export type IssueSeverity = 'info' | 'warning' | 'error';

export interface IssuesArgs extends BaseFilter {
    /** Restrict to one kind. Exact match. */
    kind?: string;
    /** Restrict to one severity. */
    severity?: IssueSeverity;
}

export interface IssueKindRow {
    kind: string;
    count: number;
    info_count: number;
    warning_count: number;
    error_count: number;
    distinct_sessions: number;
    distinct_users: number;
    /** Most-recently-seen source for this kind (callers can drill in for the full set). */
    sample_source: string;
    /** Most-recently-seen summary string. */
    sample_summary: string;
    sample_session_id: string;
    sample_event_id: string;
    first_seen: string;
    last_seen: string;
}

export interface IssuesResult {
    kind: 'issues_histogram';
    rows: IssueKindRow[];
    total_issues: number;
    distinct_kinds: number;
}

/**
 * Per-issue detail row — preserves the full agent-filed payload. Use this
 * when the maintainer wants to *read* what was reported, not just see a
 * count. Surfaced via `audit:issues --detail`.
 */
export interface IssueDetailRow {
    event_id: string;
    session_id: string;
    user_id: string | null;
    timestamp: string;
    kind: string;
    severity: IssueSeverity | '';
    source: string;
    summary: string;
    detail: unknown;          // free-form JSON from the agent's report_issue call
}

export interface IssueDetailsResult {
    kind: 'issues_detail';
    rows: IssueDetailRow[];
    total_issues: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Query
// ──────────────────────────────────────────────────────────────────────────

export async function queryIssues(client: Client, args: IssuesArgs): Promise<IssuesResult> {
    const f = buildFilterClause(args);

    let where = combineWhere(f.where, `event_type = 'issue'`);
    const vars: Record<string, unknown> = { ...f.vars };
    if (args.kind) {
        where = combineWhere(where, `payload.kind = $issueKind`);
        vars.issueKind = args.kind;
    }
    if (args.severity) {
        where = combineWhere(where, `payload.severity = $issueSeverity`);
        vars.issueSeverity = args.severity;
    }

    const sql = `
        SELECT
            event_id, session_id, user_id, timestamp,
            payload.kind AS kind,
            payload.severity AS severity,
            payload.source AS source,
            payload.summary AS summary
        FROM insights_events
        WHERE ${where}
    `;

    const raw = (await client.runQuery({ query: sql, variables: vars })) as unknown[];
    const rows = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];

    interface Acc {
        kind: string;
        count: number;
        info_count: number;
        warning_count: number;
        error_count: number;
        sessions: Set<string>;
        users: Set<string>;
        sample_source: string;
        sample_summary: string;
        sample_session_id: string;
        sample_event_id: string;
        first_seen: string;
        last_seen: string;
    }
    const byKind = new Map<string, Acc>();
    const accFor = (kind: string): Acc => {
        let a = byKind.get(kind);
        if (!a) {
            a = {
                kind,
                count: 0,
                info_count: 0,
                warning_count: 0,
                error_count: 0,
                sessions: new Set<string>(),
                users: new Set<string>(),
                sample_source: '',
                sample_summary: '',
                sample_session_id: '',
                sample_event_id: '',
                first_seen: '',
                last_seen: '',
            };
            byKind.set(kind, a);
        }
        return a;
    };

    for (const r of rows) {
        const kindStr = typeof r.kind === 'string' ? r.kind : '<no-kind>';
        const severity = typeof r.severity === 'string' ? r.severity : '';
        const session_id = String(r.session_id ?? '');
        const user_id = r.user_id == null ? null : String(r.user_id);
        const ts = String(r.timestamp ?? '');

        const a = accFor(kindStr);
        a.count += 1;
        if (severity === 'info') a.info_count += 1;
        else if (severity === 'warning') a.warning_count += 1;
        else if (severity === 'error') a.error_count += 1;
        if (session_id) a.sessions.add(session_id);
        if (user_id) a.users.add(user_id);

        if (ts && (!a.first_seen || ts < a.first_seen)) a.first_seen = ts;
        // Use the most-recently-seen row as the "sample" — that surfaces
        // the latest example when the reviewer scans the histogram.
        if (ts && (!a.last_seen || ts > a.last_seen)) {
            a.last_seen = ts;
            a.sample_source = typeof r.source === 'string' ? r.source : '';
            a.sample_summary = typeof r.summary === 'string' ? r.summary : '';
            a.sample_session_id = session_id;
            a.sample_event_id = String(r.event_id ?? '');
        }
    }

    const out: IssueKindRow[] = [...byKind.values()]
        .map((a) => ({
            kind: a.kind,
            count: a.count,
            info_count: a.info_count,
            warning_count: a.warning_count,
            error_count: a.error_count,
            distinct_sessions: a.sessions.size,
            distinct_users: a.users.size,
            sample_source: a.sample_source,
            sample_summary: a.sample_summary,
            sample_session_id: a.sample_session_id,
            sample_event_id: a.sample_event_id,
            first_seen: a.first_seen,
            last_seen: a.last_seen,
        }))
        .sort((a, b) => {
            // Errors first, then by count desc. Reviewers want to see error-
            // severity items at the top regardless of frequency.
            if (a.error_count > 0 && b.error_count === 0) return -1;
            if (a.error_count === 0 && b.error_count > 0) return 1;
            return b.count - a.count;
        });

    return {
        kind: 'issues_histogram',
        rows: args.limit ? out.slice(0, args.limit) : out,
        total_issues: rows.length,
        distinct_kinds: byKind.size,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Formatter
// ──────────────────────────────────────────────────────────────────────────

export function formatIssues(result: IssuesResult, opts: FormatOpts = {}): string {
    const format = opts.format ?? 'text';

    const rows: Record<string, unknown>[] = result.rows.map((r) => ({ ...r }));

    const columns = [
        'kind', 'count',
        'error_count', 'warning_count', 'info_count',
        'distinct_sessions', 'distinct_users',
        'sample_source', 'sample_summary',
        'first_seen', 'last_seen',
        'sample_session_id',
    ];

    // When the histogram is short (≤ 5 rows — typical for the 4-hourly
    // audit loop), sample_summary is the load-bearing field and chopping
    // it at 60 chars makes the output useless. Auto-untruncate. Callers
    // can also force this via opts.truncate explicitly.
    const renderOpts = opts.truncate === undefined && result.rows.length <= 5
        ? { ...opts, columns, truncate: 100_000 }
        : { ...opts, columns };

    const body = renderRows(rows, renderOpts);
    if (format === 'json' || format === 'csv') return body;

    const header = `total issues: ${result.total_issues}   distinct kinds: ${result.distinct_kinds}`;
    return `${header}\n${body}`;
}

// ──────────────────────────────────────────────────────────────────────────
// Per-issue detail view — one row per issue, full summary + detail JSON.
// ──────────────────────────────────────────────────────────────────────────

export async function queryIssueDetails(
    client: Client,
    args: IssuesArgs,
): Promise<IssueDetailsResult> {
    const f = buildFilterClause(args);

    let where = combineWhere(f.where, `event_type = 'issue'`);
    const vars: Record<string, unknown> = { ...f.vars };
    if (args.kind) {
        where = combineWhere(where, `payload.kind = $issueKind`);
        vars.issueKind = args.kind;
    }
    if (args.severity) {
        where = combineWhere(where, `payload.severity = $issueSeverity`);
        vars.issueSeverity = args.severity;
    }

    const sql = `
        SELECT
            event_id, session_id, user_id, timestamp,
            payload.kind AS kind,
            payload.severity AS severity,
            payload.source AS source,
            payload.summary AS summary,
            payload.detail AS detail
        FROM insights_events
        WHERE ${where}
    `;
    const raw = (await client.runQuery({ query: sql, variables: vars })) as unknown[];
    const rawRows = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];

    const rows: IssueDetailRow[] = rawRows.map((r) => ({
        event_id: String(r.event_id ?? ''),
        session_id: String(r.session_id ?? ''),
        user_id: r.user_id == null ? null : String(r.user_id),
        timestamp: String(r.timestamp ?? ''),
        kind: typeof r.kind === 'string' ? r.kind : '<no-kind>',
        severity: (typeof r.severity === 'string' ? r.severity : '') as IssueSeverity | '',
        source: typeof r.source === 'string' ? r.source : '',
        summary: typeof r.summary === 'string' ? r.summary : '',
        detail: r.detail,
    }));

    // Severity-first, then newest-first.
    const sevWeight = (s: string): number =>
        s === 'error' ? 3 : s === 'warning' ? 2 : s === 'info' ? 1 : 0;
    rows.sort((a, b) => {
        const dw = sevWeight(b.severity) - sevWeight(a.severity);
        if (dw !== 0) return dw;
        return b.timestamp.localeCompare(a.timestamp);
    });

    return {
        kind: 'issues_detail',
        rows: args.limit ? rows.slice(0, args.limit) : rows,
        total_issues: rows.length,
    };
}

export function formatIssueDetails(result: IssueDetailsResult, opts: FormatOpts = {}): string {
    const format = opts.format ?? 'text';

    if (format === 'json') return JSON.stringify(result, null, 2);
    if (format === 'csv') {
        const rows = result.rows.map((r) => ({
            event_id: r.event_id, session_id: r.session_id, timestamp: r.timestamp,
            kind: r.kind, severity: r.severity, source: r.source, summary: r.summary,
            // Serialize detail as a JSON string so CSV stays flat.
            detail: r.detail === undefined ? '' : JSON.stringify(r.detail),
        })) as Record<string, unknown>[];
        return renderRows(rows, { ...opts, truncate: 100_000 });
    }

    // text / table / markdown: one section per issue, summary + detail visible.
    const parts: string[] = [];
    parts.push(`Issues detail — ${result.total_issues} issue(s)`);
    parts.push('');
    for (const r of result.rows) {
        const sev = r.severity ? `[${r.severity}]` : '';
        parts.push(`${r.timestamp}  ${r.session_id}  ${r.event_id}  ${sev}  ${r.kind}`);
        parts.push(`  source: ${r.source || '—'}`);
        if (r.summary) {
            // Word-wrap summary for terminal readability without losing content.
            const wrapped = wordWrap(r.summary, 78, '  summary: ', '           ');
            parts.push(wrapped);
        }
        if (r.detail !== undefined && r.detail !== null) {
            parts.push('  detail:');
            const detailJson = JSON.stringify(r.detail, null, 2);
            for (const line of detailJson.split('\n')) {
                parts.push('    ' + line);
            }
        }
        parts.push('');
    }
    return parts.join('\n');
}

/**
 * Word-wrap helper — keeps long agent summaries readable in the terminal
 * without truncating them. First line gets `firstPrefix`, continuation
 * lines get `contPrefix` (visual indent to align with the field name).
 */
function wordWrap(text: string, width: number, firstPrefix: string, contPrefix: string): string {
    const words = text.split(/\s+/);
    const lines: string[] = [];
    let cur = firstPrefix;
    let firstOnLine = true;
    for (const w of words) {
        const sep = firstOnLine ? '' : ' ';
        if (cur.length + sep.length + w.length > width) {
            lines.push(cur);
            cur = contPrefix + w;
            firstOnLine = false;
        } else {
            cur += sep + w;
            firstOnLine = false;
        }
    }
    if (cur.length > 0) lines.push(cur);
    return lines.join('\n');
}
