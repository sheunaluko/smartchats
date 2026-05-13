/**
 * High-level export operations: query → bundle → optional file write.
 *
 * Caller passes in a `Client` from `smartchats-database` (constructed
 * however — local AIO root creds, cloud root creds, etc.). This layer
 * doesn't know or care; it just dispatches the queries.
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { Client } from 'smartchats-database';
import {
    EXPORTER_VERSION,
    type InsightEventRow,
    type SessionBundle,
    type SessionDescriptor,
    type SessionEventsFilter,
    type SessionMetadata,
    type FindSessionsArgs,
    type CandidateSessionsFilter,
    type SessionCandidate,
} from './types.js';
import {
    findSessionsQuery,
    getSessionEventsQuery,
    findCandidateSessionsQuery,
} from './queries.js';
import { computeSummary, rowsToTimeline, normalizeTimestamp } from './summary.js';

// ── Low-level: query ─────────────────────────────────────────────────────

/**
 * Run `getSessionEventsQuery` against a Client and return the rows.
 * Single statement → first result array.
 */
export async function getSessionEvents(
    client: Client,
    filter: SessionEventsFilter,
): Promise<InsightEventRow[]> {
    const spec = getSessionEventsQuery(filter);
    const result = (await client.runQuery(spec)) as unknown[];
    const first = result[0];
    return Array.isArray(first) ? (first as InsightEventRow[]) : [];
}

/**
 * Run `findSessionsQuery` against a Client and return session descriptors.
 */
export async function findSessions(
    client: Client,
    args: FindSessionsArgs = {},
): Promise<SessionDescriptor[]> {
    const spec = findSessionsQuery(args);
    const result = (await client.runQuery(spec)) as unknown[];
    const first = Array.isArray(result[0]) ? (result[0] as Array<Record<string, unknown>>) : [];
    return first.map((row) => ({
        session_id: String(row.session_id ?? ''),
        app_name: String(row.app_name ?? ''),
        tags: Array.isArray(row.tags) ? (row.tags as string[]) : [],
        start_time: normalizeIsoString(row.start_time),
        end_time: normalizeIsoString(row.end_time),
        event_count: Number(row.event_count ?? 0),
    }));
}

/**
 * Triage entry-point: returns one descriptor per session matching the
 * filter, with the aggregate counts a caller needs to decide which
 * sessions to pull locally for full analysis.
 *
 * Row-level filters (appName, tags, since/until) are pushed into the
 * SurrealQL WHERE. Predicate filters (hasError, hasEventType,
 * missingEventType, hasEventTag, min/max events/duration) are applied
 * here JS-side against the per-session aggregates the query returns.
 *
 * Sort is `end_time DESC` (most recent first); final `limit` slice
 * happens after JS-side predicate filtering so we never run short.
 */
export async function findCandidateSessions(
    client: Client,
    filter: CandidateSessionsFilter = {},
): Promise<SessionCandidate[]> {
    const spec = findCandidateSessionsQuery(filter);
    const result = (await client.runQuery(spec)) as unknown[];
    const rows = Array.isArray(result[0]) ? (result[0] as Array<Record<string, unknown>>) : [];

    const candidates: SessionCandidate[] = rows.map((row) => ({
        session_id: String(row.session_id ?? ''),
        app_name: String(row.app_name ?? ''),
        session_tags: normalizeStringArray(row.session_tags),
        start_time: normalizeIsoString(row.start_time),
        end_time: normalizeIsoString(row.end_time),
        duration_ms: durationFromIso(row.start_time, row.end_time),
        event_count: Number(row.event_count ?? 0),
        error_count: Number(row.error_count ?? 0),
        llm_count: Number(row.llm_count ?? 0),
        execution_count: Number(row.execution_count ?? 0),
        // Dedup + flatten JS-side: SurrealDB rejects nested aggregates
        // (array::distinct(array::group(...))), so the query returns the
        // raw per-row values and we normalize here.
        event_types_present: dedupeStrings(row.event_types_raw),
        event_tags_present: flattenAndDedupeStrings(row.event_tags_raw),
    }));

    // JS-side predicate filters (post-aggregate).
    const filtered = candidates.filter((c) => {
        if (filter.hasError && c.error_count === 0) return false;
        if (filter.hasEventType && !c.event_types_present.includes(filter.hasEventType)) return false;
        if (filter.missingEventType && c.event_types_present.includes(filter.missingEventType)) return false;
        if (filter.hasEventTag && !c.event_tags_present.includes(filter.hasEventTag)) return false;
        if (filter.minEvents !== undefined && c.event_count < filter.minEvents) return false;
        if (filter.maxEvents !== undefined && c.event_count > filter.maxEvents) return false;
        if (filter.minDurationMs !== undefined && c.duration_ms < filter.minDurationMs) return false;
        if (filter.maxDurationMs !== undefined && c.duration_ms > filter.maxDurationMs) return false;
        return true;
    });

    return filtered.slice(0, filter.limit ?? 50);
}

// ── Mid-level: build a bundle ─────────────────────────────────────────────

/**
 * Assemble a `SessionBundle` from a list of events.
 *
 * Input must already be filtered to a single session. Throws if events
 * span multiple `session_id`s or are empty (caller should guard).
 */
export function buildBundle(rows: InsightEventRow[]): SessionBundle {
    if (rows.length === 0) {
        throw new Error('buildBundle: events array is empty');
    }
    const sessionIds = new Set(rows.map((r) => r.session_id ?? ''));
    if (sessionIds.size > 1) {
        throw new Error(
            `buildBundle: events span multiple sessions (${[...sessionIds].join(', ')}). ` +
                `Filter by session_id first.`,
        );
    }

    const timeline = rowsToTimeline(rows);
    const summary = computeSummary(timeline);

    // Pick metadata fields from any event in the session — values like
    // app_name and session_tags are stable across all events in one session.
    const sample = rows.find((r) => r.app_name) ?? rows[0];

    const start_ts = timeline[0]?.timestamp ?? 0;
    const end_ts = timeline[timeline.length - 1]?.timestamp ?? start_ts;

    const metadata: SessionMetadata = {
        app_name: sample.app_name ?? 'unknown',
        user_id: sample.user_id ?? '',
        session_tags: Array.isArray(sample.tags) ? sample.tags : [],
        start_time: new Date(start_ts).toISOString(),
        end_time: new Date(end_ts).toISOString(),
        duration_ms: end_ts - start_ts,
        event_count: timeline.length,
        export_timestamp: new Date().toISOString(),
        exporter_version: EXPORTER_VERSION,
    };

    return {
        session_id: [...sessionIds][0],
        metadata,
        summary,
        timeline,
    };
}

/**
 * Convenience: query + bundle in one call. Filter must select exactly one
 * session (typically `{sessionId}` or `{appName, sessionId}`). Returns
 * `null` when zero events match (no row to bundle).
 */
export async function buildSessionBundle(
    client: Client,
    filter: SessionEventsFilter,
): Promise<SessionBundle | null> {
    const rows = await getSessionEvents(client, filter);
    if (rows.length === 0) return null;
    return buildBundle(rows);
}

// ── Top-level: write to disk ──────────────────────────────────────────────

export interface ExportOptions {
    /**
     * Output directory. The actual filename is auto-generated to match
     * the legacy convention: `session_<app>_[<tags>_]<timestamp>.json`.
     */
    outputDir: string;
    /**
     * If true, returns the bundle in-memory in addition to writing.
     * Default false (large bundles can get sizeable; opt-in to keep them
     * around).
     */
    returnBundle?: boolean;
}

export interface ExportResult {
    /** Full path of the file written. */
    path: string;
    session_id: string;
    event_count: number;
    /** Present iff `returnBundle: true`. */
    bundle?: SessionBundle;
}

/**
 * Format a session export filename matching the legacy convention.
 * Example: `session_smartchats_simi_smoke_20260413_071820.json`.
 */
export function formatBundleFilename(
    appName: string,
    tags: string[] = [],
    timestamp: Date = new Date(),
): string {
    const ts = formatTimestamp(timestamp);
    const slug = tags.length > 0 ? `_${tags.join('_')}` : '';
    return `session_${appName}${slug}_${ts}.json`;
}

function formatTimestamp(d: Date): string {
    const pad = (n: number) => String(n).padStart(2, '0');
    return (
        `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
        `_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
    );
}

/**
 * Build a bundle and write it to disk. Returns the file path + counts.
 *
 * `filter.sessionId` is the typical caller — narrows to a single session
 * deterministically. When called with `appName` + `tags` (no sessionId),
 * use `findSessions` first to pick the session(s) to export.
 */
export async function exportSessionToFile(
    client: Client,
    filter: SessionEventsFilter,
    options: ExportOptions,
): Promise<ExportResult | null> {
    const bundle = await buildSessionBundle(client, filter);
    if (!bundle) return null;

    mkdirSync(options.outputDir, { recursive: true });
    const filename = formatBundleFilename(
        bundle.metadata.app_name,
        bundle.metadata.session_tags,
    );
    const fullPath = join(options.outputDir, filename);

    writeFileSync(fullPath, JSON.stringify(bundle, null, 2), 'utf8');

    return {
        path: fullPath,
        session_id: bundle.session_id,
        event_count: bundle.metadata.event_count,
        bundle: options.returnBundle ? bundle : undefined,
    };
}

/**
 * Multi-session export: find the most recent N sessions matching the
 * find-args, export each one to a separate file. Returns an array of
 * results (one per exported session).
 */
export async function exportRecentSessionsToFiles(
    client: Client,
    findArgs: FindSessionsArgs,
    options: ExportOptions,
): Promise<ExportResult[]> {
    const sessions = await findSessions(client, findArgs);
    const results: ExportResult[] = [];
    for (const s of sessions) {
        const result = await exportSessionToFile(
            client,
            { sessionId: s.session_id },
            options,
        );
        if (result) results.push(result);
    }
    return results;
}

// ── Internal helpers ──────────────────────────────────────────────────────

function normalizeIsoString(value: unknown): string {
    // Delegate to normalizeTimestamp so we handle every shape the SurrealDB
    // SDK might return (string, Date, number, custom DateTime classes with
    // .toISOString()). 0 means "couldn't parse" → empty string for display.
    const ms = normalizeTimestamp(value);
    return ms > 0 ? new Date(ms).toISOString() : '';
}

function normalizeStringArray(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const out: string[] = [];
    for (const v of value) {
        if (v == null) continue;
        out.push(typeof v === 'string' ? v : String(v));
    }
    return out;
}

function dedupeStrings(value: unknown): string[] {
    return [...new Set(normalizeStringArray(value))];
}

/** Input is array<string[] | null>; flatten, drop nulls, dedupe. */
function flattenAndDedupeStrings(value: unknown): string[] {
    if (!Array.isArray(value)) return [];
    const flat: string[] = [];
    for (const inner of value) {
        if (Array.isArray(inner)) {
            for (const v of inner) {
                if (typeof v === 'string') flat.push(v);
            }
        } else if (typeof inner === 'string') {
            flat.push(inner);
        }
    }
    return [...new Set(flat)];
}

function durationFromIso(start: unknown, end: unknown): number {
    const s = normalizeTimestamp(start);
    const e = normalizeTimestamp(end);
    return s > 0 && e > 0 ? Math.max(0, e - s) : 0;
}

// Suppress unused-import warning for `dirname` (kept for future use cases
// where callers want path-derivation helpers exported alongside).
void dirname;
