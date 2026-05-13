/**
 * Cross-session error triage.
 *
 * Takes N session bundles, runs `analyzeErrors` on each, then merges the
 * resulting error records by **error signature** (the full payload-derived
 * message — not the 120-char prefix used internally for per-session
 * grouping). Each merged signature becomes a TriageErrorReport carrying:
 *   • every session that hit it
 *   • a deduped sample of the code that triggered it
 *   • a deduped sample of the function calls involved
 *   • a deduped sample of preceding user inputs and agent thoughts
 *
 * The output is consumed by `scripts/session_triage_errors.ts`, which
 * writes one markdown file per report plus an index.
 *
 * Pure — no fs, no DB, no clock. Deterministic given the same bundle set.
 */

import { createHash } from 'node:crypto';
import type { SessionBundle } from '../types.js';
import { analyzeErrors, type ErrorRecord } from './errors.js';
import { fmtClock, fmtDuration, truncate } from './_format.js';

/** How many of each sample category to surface in the report. */
const SAMPLE_CAP = 5;

/** One affected session under a single signature. */
export interface TriageSessionRef {
    session_id: string;
    app_name: string;
    /** How many times this signature fired in this session. */
    occurrences: number;
    /** End-of-session timestamp (epoch ms). */
    end_time_ms: number;
    /** Affected session's tags (for at-a-glance filtering). */
    session_tags: string[];
}

/** Deduped function-call signature with the originating session. */
export interface TriageFnCall {
    name: string;
    args_preview: string;
    /** First session_id where this fn-call signature appeared. */
    first_seen_in: string;
}

/** Per-signature aggregate. */
export interface TriageErrorReport {
    /** Full error message — the canonical key. */
    signature: string;
    /** Filename-safe short form (no rank prefix; the CLI prepends 01_, 02_ …). */
    slug: string;
    /** Total occurrences across all sessions. */
    occurrences: number;
    /** Unique sessions affected. */
    sessions: TriageSessionRef[];
    /** Sample code snippets (deduped by exact source, capped at SAMPLE_CAP). */
    sample_codes: string[];
    /** Sample function calls (deduped by name + args preview). */
    sample_function_calls: TriageFnCall[];
    /** Sample user inputs preceding the failures (deduped, capped). */
    sample_user_inputs: string[];
    /** Sample agent thoughts (deduped, capped). */
    sample_thoughts: string[];
    /** Earliest occurrence across all sessions (epoch ms). */
    first_seen_ms: number;
    /** Latest occurrence across all sessions (epoch ms). */
    last_seen_ms: number;
}

export interface MergeOptions {
    /** Drop signatures with total occurrences < minCount (default 1). */
    minCount?: number;
    /** Drop bundles whose latest event is before sinceMs (default: no bound). */
    sinceMs?: number;
    /** Filter bundles by app_name (default: include all). */
    appName?: string;
}

/**
 * Build cross-session reports from a set of bundles.
 *
 * Reports are sorted by `occurrences DESC` so the most common signatures
 * surface first. Stable sub-sort: `last_seen_ms DESC` to break ties.
 */
export function mergeErrorsAcrossSessions(
    bundles: SessionBundle[],
    opts: MergeOptions = {},
): TriageErrorReport[] {
    const minCount = opts.minCount ?? 1;

    const bySig = new Map<string, ReportAccumulator>();

    for (const bundle of bundles) {
        if (opts.appName && bundle.metadata.app_name !== opts.appName) continue;
        const endMs = Date.parse(bundle.metadata.end_time);
        if (opts.sinceMs !== undefined && Number.isFinite(endMs) && endMs < opts.sinceMs) {
            continue;
        }

        const result = analyzeErrors(bundle);
        if (result.total === 0) continue;

        // Group this session's records by signature (use full message as key,
        // not the 120-char prefix). Same signature in one session counts as N
        // occurrences but ONE session.
        const perSig = new Map<string, ErrorRecord[]>();
        for (const r of result.records) {
            const sig = r.message;
            const list = perSig.get(sig) ?? [];
            list.push(r);
            perSig.set(sig, list);
        }

        for (const [sig, records] of perSig.entries()) {
            const acc = bySig.get(sig) ?? makeAccumulator(sig);
            bySig.set(sig, acc);

            acc.occurrences += records.length;
            acc.sessions.push({
                session_id: bundle.session_id,
                app_name: bundle.metadata.app_name,
                occurrences: records.length,
                end_time_ms: Number.isFinite(endMs) ? endMs : 0,
                session_tags: bundle.metadata.session_tags ?? [],
            });

            // Sample harvesting: walk this session's records, push into
            // dedup sets capped at SAMPLE_CAP. We over-collect deliberately
            // here and trim post-merge so an early dominant session can't
            // crowd out later ones.
            for (const r of records) {
                if (r.code) acc.codeSet.add(r.code);
                if (r.thoughts) acc.thoughtSet.add(r.thoughts);
                if (r.preceding_user_input?.text) {
                    acc.userInputSet.add(r.preceding_user_input.text);
                }
                if (r.function_calls) {
                    for (const fc of r.function_calls) {
                        const argsPreview = fc.args !== undefined ? truncate(fc.args, 160) : '';
                        const key = `${fc.name}::${argsPreview}`;
                        if (!acc.fnCallMap.has(key)) {
                            acc.fnCallMap.set(key, {
                                name: fc.name,
                                args_preview: argsPreview,
                                first_seen_in: bundle.session_id,
                            });
                        }
                    }
                }
                if (r.timestamp < acc.firstSeenMs) acc.firstSeenMs = r.timestamp;
                if (r.timestamp > acc.lastSeenMs) acc.lastSeenMs = r.timestamp;
            }
        }
    }

    // Materialize accumulators → reports.
    const reports: TriageErrorReport[] = [];
    for (const acc of bySig.values()) {
        if (acc.occurrences < minCount) continue;

        // Sort sessions by recency first so the head of the table is
        // immediately relevant.
        acc.sessions.sort((a, b) => b.end_time_ms - a.end_time_ms);

        reports.push({
            signature: acc.signature,
            slug: slugifySignature(acc.signature),
            occurrences: acc.occurrences,
            sessions: acc.sessions,
            sample_codes: capArray([...acc.codeSet], SAMPLE_CAP),
            sample_function_calls: capArray([...acc.fnCallMap.values()], SAMPLE_CAP),
            sample_user_inputs: capArray([...acc.userInputSet], SAMPLE_CAP),
            sample_thoughts: capArray([...acc.thoughtSet], SAMPLE_CAP),
            first_seen_ms: acc.firstSeenMs,
            last_seen_ms: acc.lastSeenMs,
        });
    }

    reports.sort((a, b) => {
        if (b.occurrences !== a.occurrences) return b.occurrences - a.occurrences;
        return b.last_seen_ms - a.last_seen_ms;
    });

    return reports;
}

interface ReportAccumulator {
    signature: string;
    occurrences: number;
    sessions: TriageSessionRef[];
    codeSet: Set<string>;
    thoughtSet: Set<string>;
    userInputSet: Set<string>;
    fnCallMap: Map<string, TriageFnCall>;
    firstSeenMs: number;
    lastSeenMs: number;
}

function makeAccumulator(signature: string): ReportAccumulator {
    return {
        signature,
        occurrences: 0,
        sessions: [],
        codeSet: new Set(),
        thoughtSet: new Set(),
        userInputSet: new Set(),
        fnCallMap: new Map(),
        firstSeenMs: Number.POSITIVE_INFINITY,
        lastSeenMs: 0,
    };
}

function capArray<T>(arr: T[], n: number): T[] {
    return arr.length <= n ? arr : arr.slice(0, n);
}

/**
 * Filename-safe slug from a signature. Lowercase, strip non-alphanumerics,
 * collapse runs of `-`, trim to 40 chars. We don't include any rank
 * prefix here — the CLI prepends `01_`, `02_`, … based on output order.
 */
export function slugifySignature(signature: string): string {
    const base = signature
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40)
        .replace(/-+$/g, '');
    return base.length > 0 ? base : 'unnamed-error';
}

// ── Markdown rendering ────────────────────────────────────────────────────

/**
 * Per-signature triage report rendered as markdown.
 *
 * Layout (intentionally fixed so refinement diffs cleanly across runs):
 *
 *   # <truncated signature>
 *   - Frequency: N occurrences across M sessions
 *   - First seen / last seen
 *
 *   ## Signature
 *   ```text
 *   <full signature>
 *   ```
 *
 *   ## Affected sessions
 *   | session_id | app | occurrences | end_time | tags |
 *   ...
 *
 *   ## Sample failing code
 *   ```js
 *   <code 1>
 *   ```
 *   ---
 *   <code 2>
 *
 *   ## Function calls involved
 *   - `name(args_preview)` (first seen in ses_…)
 *
 *   ## Sample user inputs
 *   - "<truncated>"
 *
 *   ## Sample agent thoughts
 *   - <truncated>
 *
 *   ## Suggested fix
 *   _(empty — to be filled by a Phase-C sub-agent or by hand)_
 */
export function formatTriageReport(report: TriageErrorReport | AnnotatedTriageReport): string {
    const lines: string[] = [];
    const handled = (report as AnnotatedTriageReport).handled;
    const titlePrefix =
        handled?.regression ? 'REGRESSION: ' :
        handled?.status === 'investigating' ? '[investigating] ' :
        '';
    lines.push(`# ${titlePrefix}${truncate(report.signature, 120)}`);
    lines.push('');
    if (handled) {
        lines.push(`> **Triage status:** \`${handled.status}\`${handled.regression ? ' — **REGRESSION DETECTED** (new sessions after \`fixed_at\`)' : ''}`);
        if (handled.fixed_at) lines.push(`> · fixed_at: \`${handled.fixed_at}\``);
        if (handled.fixed_in_commit) lines.push(`> · fixed_in_commit: \`${handled.fixed_in_commit}\``);
        if (handled.notes) lines.push(`> · notes: ${handled.notes}`);
        lines.push(`> · marked_at: \`${handled.marked_at}\`${handled.marked_by ? ` by \`${handled.marked_by}\`` : ''}`);
        lines.push('');
    }
    lines.push(`- **Frequency:** ${report.occurrences} occurrence${report.occurrences === 1 ? '' : 's'} across ${report.sessions.length} session${report.sessions.length === 1 ? '' : 's'}`);
    lines.push(`- **First seen:** ${formatIso(report.first_seen_ms)}`);
    lines.push(`- **Last seen:** ${formatIso(report.last_seen_ms)}`);
    const span = report.last_seen_ms - report.first_seen_ms;
    if (span > 0) lines.push(`- **Span:** ${fmtDuration(span)}`);
    lines.push('');

    lines.push(`## Signature`);
    lines.push('```text');
    lines.push(report.signature);
    lines.push('```');
    lines.push('');

    lines.push(`## Affected sessions`);
    lines.push('');
    lines.push('| session_id | app | occurrences | end_time | tags |');
    lines.push('| --- | --- | ---: | --- | --- |');
    for (const s of report.sessions) {
        const end = s.end_time_ms ? formatIso(s.end_time_ms) : '—';
        const tags = s.session_tags.length > 0 ? s.session_tags.join(', ') : '—';
        lines.push(`| \`${s.session_id}\` | ${s.app_name} | ${s.occurrences} | ${end} | ${tags} |`);
    }
    lines.push('');

    if (report.sample_codes.length > 0) {
        lines.push(`## Sample failing code`);
        lines.push('');
        for (let i = 0; i < report.sample_codes.length; i++) {
            if (i > 0) lines.push('---', '');
            lines.push('```js');
            lines.push(report.sample_codes[i]);
            lines.push('```');
            lines.push('');
        }
    }

    if (report.sample_function_calls.length > 0) {
        lines.push(`## Function calls involved`);
        lines.push('');
        for (const fc of report.sample_function_calls) {
            lines.push(`- \`${fc.name}(${fc.args_preview})\`  _first seen in_ \`${fc.first_seen_in}\``);
        }
        lines.push('');
    }

    if (report.sample_user_inputs.length > 0) {
        lines.push(`## Sample user inputs`);
        lines.push('');
        for (const u of report.sample_user_inputs) {
            lines.push(`- "${truncate(u, 300)}"`);
        }
        lines.push('');
    }

    if (report.sample_thoughts.length > 0) {
        lines.push(`## Sample agent thoughts`);
        lines.push('');
        for (const t of report.sample_thoughts) {
            lines.push(`- ${truncate(t, 400)}`);
        }
        lines.push('');
    }

    lines.push(`## Suggested fix`);
    lines.push('');
    lines.push(`_(empty — to be filled by a Phase-C sub-agent or by hand. The sections above are intended to be sufficient context for either.)_`);
    lines.push('');

    return lines.join('\n');
}

/**
 * Index README listing every report in a triage run.
 *
 * Sorted by descending occurrences (matching the file rank prefixes).
 */
export function formatTriageIndex(reports: Array<TriageErrorReport | AnnotatedTriageReport>, opts: {
    generatedAtMs?: number;
    bundleCount?: number;
    sinceMs?: number;
    appName?: string;
    /** Counts of suppressed reports (shown in the index header for awareness). */
    suppressedWontfix?: number;
    suppressedResolved?: number;
} = {}): string {
    const lines: string[] = [];
    lines.push(`# Error triage — ${reports.length} unique signature${reports.length === 1 ? '' : 's'}`);
    lines.push('');
    const meta: string[] = [];
    if (opts.generatedAtMs) meta.push(`Generated ${formatIso(opts.generatedAtMs)}`);
    if (opts.bundleCount !== undefined) meta.push(`${opts.bundleCount} bundle${opts.bundleCount === 1 ? '' : 's'} scanned`);
    if (opts.appName) meta.push(`app=\`${opts.appName}\``);
    if (opts.sinceMs) meta.push(`since=${formatIso(opts.sinceMs)}`);
    if (meta.length > 0) {
        lines.push(meta.join(' · '));
        lines.push('');
    }
    if (opts.suppressedWontfix || opts.suppressedResolved) {
        const parts: string[] = [];
        if (opts.suppressedResolved) parts.push(`${opts.suppressedResolved} resolved (no new sessions after \`fixed_at\`)`);
        if (opts.suppressedWontfix) parts.push(`${opts.suppressedWontfix} suppressed as \`wontfix\``);
        lines.push(`_Suppressed by handled-state:_ ${parts.join(' · ')}. See \`wontfix_summary.md\` if present.`);
        lines.push('');
    }

    if (reports.length === 0) {
        lines.push('_No error signatures matched the filters._');
        return lines.join('\n');
    }

    lines.push('| # | status | occurrences | sessions | last seen | signature |');
    lines.push('| ---: | --- | ---: | ---: | --- | --- |');
    for (let i = 0; i < reports.length; i++) {
        const r = reports[i];
        const rank = String(i + 1).padStart(2, '0');
        const filename = `${rank}_${r.slug}.md`;
        const sigShort = truncate(r.signature, 100).replace(/\|/g, '\\|');
        const handled = (r as AnnotatedTriageReport).handled;
        const statusCell =
            handled?.regression ? '**REGRESSION**' :
            handled?.status === 'investigating' ? 'investigating' :
            handled?.status === 'fixed' ? 'fixed' :
            '—';
        lines.push(
            `| ${i + 1} | ${statusCell} | ${r.occurrences} | ${r.sessions.length} | ${formatIso(r.last_seen_ms)} | [${sigShort}](./${filename}) |`,
        );
    }
    lines.push('');
    return lines.join('\n');
}

/**
 * Markdown summary of all `wontfix`-suppressed reports. Written alongside
 * the main index so wontfix entries are never silently invisible.
 */
export function formatWontfixSummary(
    suppressed: Array<TriageErrorReport & { handled: HandledEntry }>,
): string {
    const lines: string[] = [];
    lines.push(`# Suppressed — \`wontfix\``);
    lines.push('');
    lines.push(`${suppressed.length} signature${suppressed.length === 1 ? '' : 's'} marked \`wontfix\` were skipped this run.`);
    lines.push('');
    if (suppressed.length === 0) return lines.join('\n');

    lines.push('| occurrences | sessions | last seen | notes | signature |');
    lines.push('| ---: | ---: | --- | --- | --- |');
    for (const r of suppressed) {
        const sigShort = truncate(r.signature, 100).replace(/\|/g, '\\|');
        const notes = (r.handled.notes ?? '').replace(/\|/g, '\\|');
        lines.push(
            `| ${r.occurrences} | ${r.sessions.length} | ${formatIso(r.last_seen_ms)} | ${notes || '—'} | ${sigShort} |`,
        );
    }
    lines.push('');
    return lines.join('\n');
}

function formatIso(ms: number): string {
    if (!ms || !Number.isFinite(ms)) return '—';
    return new Date(ms).toISOString().replace('T', ' ').replace(/\.\d+Z$/, 'Z');
}

// ── Handled-state ─────────────────────────────────────────────────────────

/**
 * Persistent record of which signatures have been triaged before. Loaded
 * from a single JSON file (default `data/triage/handled.json`), applied
 * by the CLI orchestrator after `mergeErrorsAcrossSessions`.
 *
 * Statuses:
 *   • `fixed`        — patch landed at `fixed_at`. The signature is
 *                       suppressed in future runs *unless* a session whose
 *                       end_time is newer than `fixed_at` appears, in
 *                       which case the report re-surfaces as a regression
 *                       (sessions filtered to post-fix only).
 *   • `wontfix`      — acknowledged out-of-scope (flaky upstream, user
 *                       error, etc). Always suppressed. Surfaced in a
 *                       separate wontfix summary so we don't lose track.
 *   • `investigating` — claimed but not yet resolved. Reports still
 *                       surface but with an `[investigating]` prefix.
 *
 * Keyed by `signatureHash(signature)` (sha256, 16 hex chars) — stable
 * across runs given identical canonical signatures.
 */
export interface HandledState {
    version: 1;
    entries: Record<string, HandledEntry>;
}

export interface HandledEntry {
    /** First 120 chars of the canonical signature, for human-readability. */
    signature_preview: string;
    status: 'fixed' | 'wontfix' | 'investigating';
    /** ISO datetime — REQUIRED for status='fixed' (drives regression detection). */
    fixed_at?: string;
    /** Optional commit sha that introduced the fix. */
    fixed_in_commit?: string;
    /** Free-form notes (one-liner is fine). */
    notes?: string;
    /** ISO datetime when this entry was last written. */
    marked_at: string;
    /** Optional whoami output at mark time. */
    marked_by?: string;
}

/** Stable signature hash. Truncated sha256 hex (16 chars) — collision-free at our scale. */
export function signatureHash(signature: string): string {
    return createHash('sha256').update(signature).digest('hex').slice(0, 16);
}

/** Empty initial state. */
export function emptyHandledState(): HandledState {
    return { version: 1, entries: {} };
}

/** Result of applying handled-state filtering to a set of reports. */
export interface AnnotatedTriageReport extends TriageErrorReport {
    /** Present when this signature is in handled state. */
    handled?: HandledEntry & {
        /** True when `status='fixed'` but at least one session post-dates `fixed_at`. */
        regression?: boolean;
    };
}

export interface TriageOutcome {
    /** Reports to publish, in the same sort order as input. */
    reports: AnnotatedTriageReport[];
    /** Reports suppressed by `wontfix` (kept here for the summary file). */
    suppressed_wontfix: Array<TriageErrorReport & { handled: HandledEntry }>;
    /** Reports suppressed because they're marked `fixed` and no sessions post-date `fixed_at`. */
    suppressed_resolved: Array<TriageErrorReport & { handled: HandledEntry }>;
}

/**
 * Apply handled state to a merged report list.
 *
 * Behavior per signature:
 *   • not in state → unchanged
 *   • status=fixed, no post-fix sessions → suppressed (suppressed_resolved)
 *   • status=fixed, ≥1 post-fix session → kept; sessions filtered to post-fix;
 *     handled.regression = true. Counts recomputed from the filtered set.
 *   • status=wontfix → suppressed (suppressed_wontfix)
 *   • status=investigating → kept; handled annotation passes through
 *
 * Pure: caller is responsible for loading state from disk.
 */
export function applyHandledState(
    reports: TriageErrorReport[],
    state: HandledState,
): TriageOutcome {
    const out: AnnotatedTriageReport[] = [];
    const suppressed_wontfix: Array<TriageErrorReport & { handled: HandledEntry }> = [];
    const suppressed_resolved: Array<TriageErrorReport & { handled: HandledEntry }> = [];

    for (const report of reports) {
        const hash = signatureHash(report.signature);
        const entry = state.entries[hash];
        if (!entry) {
            out.push(report);
            continue;
        }

        if (entry.status === 'wontfix') {
            suppressed_wontfix.push({ ...report, handled: entry });
            continue;
        }

        if (entry.status === 'fixed') {
            const fixedAtMs = entry.fixed_at ? Date.parse(entry.fixed_at) : 0;
            // A fixed entry without fixed_at can't drive regression detection —
            // treat the entry as a permanent suppression (resolved) so we don't
            // surface noise. Mark-CLI requires fixed_at on status=fixed so this
            // branch should be rare.
            if (!Number.isFinite(fixedAtMs) || fixedAtMs <= 0) {
                suppressed_resolved.push({ ...report, handled: entry });
                continue;
            }
            const postFixSessions = report.sessions.filter((s) => s.end_time_ms > fixedAtMs);
            if (postFixSessions.length === 0) {
                suppressed_resolved.push({ ...report, handled: entry });
                continue;
            }
            // Regression: re-surface but with a filtered session set + recounted
            // occurrences. Sample collections are intentionally NOT filtered:
            // they're representative, and re-running the per-bundle scan to
            // get exact post-fix samples would require holding bundles in
            // memory through this stage. The session table makes the cutoff
            // explicit anyway.
            const occurrences = postFixSessions.reduce((a, s) => a + s.occurrences, 0);
            out.push({
                ...report,
                sessions: postFixSessions,
                occurrences,
                handled: { ...entry, regression: true },
            });
            continue;
        }

        // investigating
        out.push({ ...report, handled: entry });
    }

    return { reports: out, suppressed_wontfix, suppressed_resolved };
}

// Suppress unused-import warning while keeping the helper available for
// future report sections that want clock-only timestamps.
void fmtClock;
