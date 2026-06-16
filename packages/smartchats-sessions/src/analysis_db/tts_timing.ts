/**
 * TTS playback timing health analyzer.
 *
 * Reads `tts_playback_timing` events (one per utterance) to surface:
 *   - Snap/lookahead adequacy: how often the scheduler had to snap a chunk
 *     forward because it arrived late. Chunk 0 snaps signal initial-chunk
 *     lateness (TTS connect / first-byte); chunk 1+ snaps signal mid-stream
 *     lateness (network jitter, server backpressure).
 *   - Inter-chunk gap distribution: derived as
 *       chunks[i+1].arrival_ms - chunks[i].arrival_ms - chunks[i].duration_ms
 *     Positive gaps are silence the user hears unless the snap fully absorbs
 *     it (snap budget = `snap_lookahead_ms`, 333ms post-2026-05-28).
 *   - Per-chunk-index snap pattern: where in the stream lateness lands.
 *
 * Default mode: per-session aggregate, sorted worst-first by snap_rate
 * then max gap. Anomaly thresholds are calibrated against observed real
 * sessions (see commit message for the introduction commit).
 *
 * `queryTtsTimingByChunkIndex` is a separate analyzer for the per-chunk
 * lateness pattern — too different in shape to bolt onto the per-session
 * one (different row key, different columns).
 */
import type { Client } from 'smartchats-database';

import { type BaseFilter, buildFilterClause, combineWhere } from './_query_helpers.js';
import { type FormatOpts, renderRows } from './_format.js';

// ──────────────────────────────────────────────────────────────────────────
// Anomaly thresholds — calibrated from observed sessions 2026-06-15/16
// (chunk-0 snap rate ran 69-70% across both real sessions, snap_rate 1.0-1.3,
// max_gap up to 2584ms). Anything past these means something is wrong.
// ──────────────────────────────────────────────────────────────────────────

const THRESHOLD_SNAP_RATE = 0.5;
const THRESHOLD_CHUNK0_PCT = 50;
const THRESHOLD_MAX_GAP_MS = 500;

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

export interface TtsTimingArgs extends BaseFilter {
    /** When true, filter rows to only sessions exceeding anomaly thresholds. */
    anomalies?: boolean;
}

export interface TtsTimingRow {
    session_id: string;
    user_id: string | null;
    first_seen: string;
    last_seen: string;
    utterances: number;
    snap_count: number;
    snap_rate: number;                  // total snaps / utterances
    chunk0_snap_pct: number;            // % utterances where chunk[0] snapped
    chunk1plus_snap_pct: number;        // % utterances where any chunk[i>0] snapped
    max_gap_ms: number;                 // largest inter-chunk gap across all utterances
    p95_gap_ms: number;                 // 95th percentile of inter-chunk gaps
    avg_connect_ms: number | null;      // mean of payload.connect_ms (null if never set)
    lookahead_ms: number;               // observed payload.snap_lookahead_ms
}

export interface TtsTimingResult {
    kind: 'tts_timing_by_session';
    rows: TtsTimingRow[];
    total_sessions: number;
    total_utterances: number;
    anomalous_sessions: number;
    thresholds: {
        snap_rate: number;
        chunk0_snap_pct: number;
        max_gap_ms: number;
    };
}

export interface TtsTimingByChunkRow {
    chunk_index: number;
    observations: number;
    snapped: number;
    snap_pct: number;
    median_arrival_ms: number;
    p95_arrival_ms: number;
}

export interface TtsTimingByChunkResult {
    kind: 'tts_timing_by_chunk_index';
    rows: TtsTimingByChunkRow[];
    total_utterances: number;
}

// Subset of the payload shape we read (defined inline so the analyzer
// stays decoupled from tivi's TtsChunkSample type). Both `first_chunk` and
// each `chunks[]` entry share the same fields.
interface ChunkSample {
    snapped_forward?: boolean;
    schedule_slack_ms?: number;
    arrival_ms?: number;
    duration_ms?: number;
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

function percentile(sortedAsc: number[], p: number): number {
    if (sortedAsc.length === 0) return 0;
    const idx = Math.min(sortedAsc.length - 1, Math.floor((p / 100) * sortedAsc.length));
    return sortedAsc[idx]!;
}

function round(n: number, p: number): number {
    const m = Math.pow(10, p);
    return Math.round(n * m) / m;
}

// ──────────────────────────────────────────────────────────────────────────
// Per-session aggregation
// ──────────────────────────────────────────────────────────────────────────

export async function queryTtsTiming(client: Client, args: TtsTimingArgs): Promise<TtsTimingResult> {
    const f = buildFilterClause(args);
    const where = combineWhere(f.where, `event_type = 'tts_playback_timing'`);
    const sql = `
        SELECT
            session_id, user_id, timestamp,
            payload.snap_forward_count AS snap_count,
            payload.snap_lookahead_ms AS lookahead_ms,
            payload.connect_ms AS connect_ms,
            payload.first_chunk AS first_chunk,
            payload.chunks AS chunks
        FROM insights_events
        WHERE ${where}
    `;
    const raw = (await client.runQuery({ query: sql, variables: f.vars })) as unknown[];
    const rows = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];

    interface SessionAcc {
        session_id: string;
        user_id: string | null;
        first_seen: string;
        last_seen: string;
        utterances: number;
        snap_count: number;
        chunk0_snapped: number;
        chunk1plus_snapped: number;
        gaps: number[];
        connect_ms_sum: number;
        connect_ms_n: number;
        lookahead_ms: number;
    }

    const bySession = new Map<string, SessionAcc>();
    for (const r of rows) {
        const session_id = String(r.session_id ?? '');
        if (!session_id) continue;
        let s = bySession.get(session_id);
        if (!s) {
            s = {
                session_id,
                user_id: r.user_id == null ? null : String(r.user_id),
                first_seen: '',
                last_seen: '',
                utterances: 0,
                snap_count: 0,
                chunk0_snapped: 0,
                chunk1plus_snapped: 0,
                gaps: [],
                connect_ms_sum: 0,
                connect_ms_n: 0,
                lookahead_ms: 0,
            };
            bySession.set(session_id, s);
        }
        const ts = String(r.timestamp ?? '');
        if (ts && (!s.first_seen || ts < s.first_seen)) s.first_seen = ts;
        if (ts && (!s.last_seen || ts > s.last_seen)) s.last_seen = ts;

        s.utterances += 1;
        if (typeof r.snap_count === 'number') s.snap_count += r.snap_count;
        if (typeof r.lookahead_ms === 'number' && r.lookahead_ms > s.lookahead_ms) {
            s.lookahead_ms = r.lookahead_ms;
        }
        if (typeof r.connect_ms === 'number') {
            s.connect_ms_sum += r.connect_ms;
            s.connect_ms_n += 1;
        }

        const fc = (r.first_chunk ?? null) as ChunkSample | null;
        if (fc?.snapped_forward) s.chunk0_snapped += 1;

        const chunks = Array.isArray(r.chunks) ? (r.chunks as ChunkSample[]) : [];
        let chunk1plusSnap = false;
        for (let i = 1; i < chunks.length; i++) {
            if (chunks[i]?.snapped_forward) { chunk1plusSnap = true; break; }
        }
        if (chunk1plusSnap) s.chunk1plus_snapped += 1;

        // Inter-chunk gaps: positive value = silence the user heard
        // (unless the snap absorbed it, in which case it's a discontinuity).
        for (let i = 0; i < chunks.length - 1; i++) {
            const a = chunks[i]!;
            const b = chunks[i + 1]!;
            const arrA = typeof a.arrival_ms === 'number' ? a.arrival_ms : 0;
            const arrB = typeof b.arrival_ms === 'number' ? b.arrival_ms : 0;
            const durA = typeof a.duration_ms === 'number' ? a.duration_ms : 0;
            const gap = arrB - arrA - durA;
            if (gap > 0) s.gaps.push(gap);
        }
    }

    const finalRows: TtsTimingRow[] = [];
    let anomalous = 0;
    for (const s of bySession.values()) {
        const sortedGaps = s.gaps.slice().sort((a, b) => a - b);
        const max_gap_ms = sortedGaps.length > 0 ? sortedGaps[sortedGaps.length - 1]! : 0;
        const p95_gap_ms = percentile(sortedGaps, 95);
        const snap_rate = s.utterances > 0 ? s.snap_count / s.utterances : 0;
        const chunk0_snap_pct = s.utterances > 0 ? (s.chunk0_snapped / s.utterances) * 100 : 0;
        const chunk1plus_snap_pct = s.utterances > 0 ? (s.chunk1plus_snapped / s.utterances) * 100 : 0;
        const avg_connect_ms = s.connect_ms_n > 0 ? s.connect_ms_sum / s.connect_ms_n : null;

        const row: TtsTimingRow = {
            session_id: s.session_id,
            user_id: s.user_id,
            first_seen: s.first_seen,
            last_seen: s.last_seen,
            utterances: s.utterances,
            snap_count: s.snap_count,
            snap_rate: round(snap_rate, 2),
            chunk0_snap_pct: round(chunk0_snap_pct, 1),
            chunk1plus_snap_pct: round(chunk1plus_snap_pct, 1),
            max_gap_ms: Math.round(max_gap_ms),
            p95_gap_ms: Math.round(p95_gap_ms),
            avg_connect_ms: avg_connect_ms === null ? null : Math.round(avg_connect_ms),
            lookahead_ms: s.lookahead_ms,
        };

        const isAnomalous = snap_rate > THRESHOLD_SNAP_RATE
            || chunk0_snap_pct > THRESHOLD_CHUNK0_PCT
            || max_gap_ms > THRESHOLD_MAX_GAP_MS;
        if (isAnomalous) anomalous += 1;
        if (!args.anomalies || isAnomalous) finalRows.push(row);
    }

    finalRows.sort((a, b) => {
        if (b.snap_rate !== a.snap_rate) return b.snap_rate - a.snap_rate;
        return b.max_gap_ms - a.max_gap_ms;
    });

    return {
        kind: 'tts_timing_by_session',
        rows: args.limit ? finalRows.slice(0, args.limit) : finalRows,
        total_sessions: bySession.size,
        total_utterances: rows.length,
        anomalous_sessions: anomalous,
        thresholds: {
            snap_rate: THRESHOLD_SNAP_RATE,
            chunk0_snap_pct: THRESHOLD_CHUNK0_PCT,
            max_gap_ms: THRESHOLD_MAX_GAP_MS,
        },
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Per-chunk-index histogram
// ──────────────────────────────────────────────────────────────────────────

export async function queryTtsTimingByChunkIndex(
    client: Client,
    args: BaseFilter,
): Promise<TtsTimingByChunkResult> {
    const f = buildFilterClause(args);
    const where = combineWhere(f.where, `event_type = 'tts_playback_timing'`);
    const sql = `
        SELECT payload.chunks AS chunks
        FROM insights_events
        WHERE ${where}
    `;
    const raw = (await client.runQuery({ query: sql, variables: f.vars })) as unknown[];
    const rows = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];

    interface ChunkAcc { observations: number; snapped: number; arrivals: number[]; }
    const byIdx = new Map<number, ChunkAcc>();
    for (const r of rows) {
        const chunks = Array.isArray(r.chunks) ? (r.chunks as ChunkSample[]) : [];
        for (let i = 0; i < chunks.length; i++) {
            const c = chunks[i]!;
            let a = byIdx.get(i);
            if (!a) { a = { observations: 0, snapped: 0, arrivals: [] }; byIdx.set(i, a); }
            a.observations += 1;
            if (c.snapped_forward) a.snapped += 1;
            if (typeof c.arrival_ms === 'number') a.arrivals.push(c.arrival_ms);
        }
    }

    const out: TtsTimingByChunkRow[] = [...byIdx.entries()]
        .map(([i, a]) => {
            const sorted = a.arrivals.slice().sort((x, y) => x - y);
            const median = sorted.length > 0 ? sorted[Math.floor(sorted.length / 2)]! : 0;
            const p95 = percentile(sorted, 95);
            return {
                chunk_index: i,
                observations: a.observations,
                snapped: a.snapped,
                snap_pct: a.observations > 0 ? round((a.snapped / a.observations) * 100, 1) : 0,
                median_arrival_ms: Math.round(median),
                p95_arrival_ms: Math.round(p95),
            };
        })
        .sort((a, b) => a.chunk_index - b.chunk_index);

    return {
        kind: 'tts_timing_by_chunk_index',
        rows: out,
        total_utterances: rows.length,
    };
}

// ──────────────────────────────────────────────────────────────────────────
// Formatter (handles both result kinds)
// ──────────────────────────────────────────────────────────────────────────

export function formatTtsTiming(
    result: TtsTimingResult | TtsTimingByChunkResult,
    opts: FormatOpts = {},
): string {
    const format = opts.format ?? 'text';

    if (result.kind === 'tts_timing_by_session') {
        const rows: Record<string, unknown>[] = result.rows.map((r) => ({ ...r }));
        const columns = [
            'session_id', 'utterances', 'snap_count', 'snap_rate',
            'chunk0_snap_pct', 'chunk1plus_snap_pct',
            'max_gap_ms', 'p95_gap_ms',
            'avg_connect_ms', 'lookahead_ms', 'last_seen',
        ];
        const body = renderRows(rows, { ...opts, columns });
        if (format === 'json' || format === 'csv') return body;
        const t = result.thresholds;
        const header = [
            `total sessions: ${result.total_sessions}   utterances: ${result.total_utterances}   anomalous: ${result.anomalous_sessions}/${result.total_sessions}`,
            `thresholds: snap_rate > ${t.snap_rate}  |  chunk0_snap_pct > ${t.chunk0_snap_pct}%  |  max_gap_ms > ${t.max_gap_ms}`,
        ].join('\n');
        return `${header}\n${body}`;
    }

    // tts_timing_by_chunk_index
    const rows: Record<string, unknown>[] = result.rows.map((r) => ({ ...r }));
    const columns = [
        'chunk_index', 'observations', 'snapped', 'snap_pct',
        'median_arrival_ms', 'p95_arrival_ms',
    ];
    const body = renderRows(rows, { ...opts, columns });
    if (format === 'json' || format === 'csv') return body;
    return `total utterances: ${result.total_utterances}\n${body}`;
}
