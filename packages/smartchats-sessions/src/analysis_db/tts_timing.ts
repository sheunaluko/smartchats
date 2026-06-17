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
// (chunk-0 snap rate ran 69-70%, snap_rate 1.0-1.3, max gap 651-2584ms,
// chunk-0→1 gap p95 407-503ms across both real sessions).
//
// chunk01_gap_over_snap_pct is the actual stutter signal: it's the % of
// utterances where the chunk-0→1 gap exceeded the snap_lookahead budget,
// meaning the snap couldn't fully hide the silence and the user heard
// (gap - snap_lookahead) of residual silence. Any non-zero value here
// means the stutter is back.
// ──────────────────────────────────────────────────────────────────────────

const THRESHOLD_SNAP_RATE = 0.5;
const THRESHOLD_CHUNK0_PCT = 50;
const THRESHOLD_MAX_GAP_MS = 500;
const THRESHOLD_CHUNK01_OVER_SNAP_PCT = 10;

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
    /**
     * Chunk-0 → chunk-1 gap (= arrival_ms[1] - arrival_ms[0] - duration_ms[0]).
     * Positive means chunk 1 arrived AFTER chunk 0 finished playing — i.e. a
     * silence the snap had to absorb. This is the actual stutter signal: if
     * the gap exceeds `snap_lookahead_ms` (333ms post-2026-05-28), the snap
     * can't fully hide it and the user hears (gap - snap_lookahead_ms) of
     * residual silence after the snap completes.
     */
    chunk01_gap_median_ms: number;      // median across utterances in session
    chunk01_gap_p95_ms: number;
    chunk01_gap_max_ms: number;
    /** % utterances where chunk-0→1 gap exceeded snap_lookahead_ms (= audible residual silence). */
    chunk01_gap_over_snap_pct: number;
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
        chunk01_over_snap_pct: number;
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

/**
 * Per-utterance drill-down for the worst chunk-0→1 gaps. Each row carries
 * the full tts_playback_timing payload plus any events emitted within a
 * window around it — so callers can see what was going on in the LLM,
 * client stream, and TTS server-timing pipelines at the moment of the
 * glitch without writing ad-hoc queries.
 */
export interface WorstUtteranceRow {
    session_id: string;
    user_id: string | null;
    timestamp: string;
    event_id: string;
    utterance_id: string | null;
    /** chunk-0 → chunk-1 gap (signed) — primary sort key. */
    chunk01_gap_ms: number;
    /** Whether the snap budget could absorb it (gap > snap_lookahead_ms). */
    snap_budget_exceeded: boolean;
    /** Residual audible silence after the snap absorbs what it can (only positive when exceeded). */
    residual_silence_ms: number;
    /** Full tts_playback_timing payload, untouched. */
    payload: Record<string, unknown>;
    /** Events within ±window_seconds (default 5) of this utterance, sorted by timestamp. */
    nearby_events: Array<{
        timestamp: string;
        delta_s: number;
        event_type: string;
        payload_preview: string;
    }>;
}

export interface WorstUtteranceArgs extends BaseFilter {
    /** How many worst utterances to surface. Default 1. */
    top?: number;
    /** Half-width of the nearby-events window in seconds. Default 5. */
    windowSeconds?: number;
}

export interface WorstUtteranceResult {
    kind: 'tts_timing_worst_utterances';
    rows: WorstUtteranceRow[];
    total_utterances_considered: number;
    window_seconds: number;
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
        /** chunk-0→1 gap per utterance with ≥2 chunks (signed: negative = chunk 1 arrived before chunk 0 ended). */
        chunk01_gaps: number[];
        chunk01_over_snap_count: number;
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
                chunk01_gaps: [],
                chunk01_over_snap_count: 0,
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

        // Chunk-0 → chunk-1 gap (signed): the specific stutter signal we care
        // about. Positive = chunk 1 arrived after chunk 0 finished playing →
        // silence the snap had to absorb. Residual audible silence happens
        // when the gap exceeds the snap budget (= snap_lookahead_ms).
        if (chunks.length >= 2) {
            const c0 = chunks[0]!;
            const c1 = chunks[1]!;
            const a0 = typeof c0.arrival_ms === 'number' ? c0.arrival_ms : 0;
            const a1 = typeof c1.arrival_ms === 'number' ? c1.arrival_ms : 0;
            const d0 = typeof c0.duration_ms === 'number' ? c0.duration_ms : 0;
            const gap01 = a1 - a0 - d0;
            s.chunk01_gaps.push(gap01);
            const snapLA = typeof r.lookahead_ms === 'number' ? r.lookahead_ms : 333;
            if (gap01 > snapLA) s.chunk01_over_snap_count += 1;
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

        // chunk-0→1 stats — signed, so use a separate sorted list (no positive-only filter).
        const sortedC01 = s.chunk01_gaps.slice().sort((a, b) => a - b);
        const chunk01_median = sortedC01.length > 0
            ? sortedC01[Math.floor(sortedC01.length / 2)]!
            : 0;
        const chunk01_p95 = percentile(sortedC01, 95);
        const chunk01_max = sortedC01.length > 0 ? sortedC01[sortedC01.length - 1]! : 0;
        const chunk01_over_snap_pct = s.chunk01_gaps.length > 0
            ? (s.chunk01_over_snap_count / s.chunk01_gaps.length) * 100
            : 0;

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
            chunk01_gap_median_ms: Math.round(chunk01_median),
            chunk01_gap_p95_ms: Math.round(chunk01_p95),
            chunk01_gap_max_ms: Math.round(chunk01_max),
            chunk01_gap_over_snap_pct: round(chunk01_over_snap_pct, 1),
            max_gap_ms: Math.round(max_gap_ms),
            p95_gap_ms: Math.round(p95_gap_ms),
            avg_connect_ms: avg_connect_ms === null ? null : Math.round(avg_connect_ms),
            lookahead_ms: s.lookahead_ms,
        };

        const isAnomalous = snap_rate > THRESHOLD_SNAP_RATE
            || chunk0_snap_pct > THRESHOLD_CHUNK0_PCT
            || max_gap_ms > THRESHOLD_MAX_GAP_MS
            || chunk01_over_snap_pct > THRESHOLD_CHUNK01_OVER_SNAP_PCT;
        if (isAnomalous) anomalous += 1;
        if (!args.anomalies || isAnomalous) finalRows.push(row);
    }

    // Worst-first: stutter signal (chunk01_gap_over_snap_pct) is the primary
    // sort because it most directly maps to user-perceived glitches.
    finalRows.sort((a, b) => {
        if (b.chunk01_gap_over_snap_pct !== a.chunk01_gap_over_snap_pct) {
            return b.chunk01_gap_over_snap_pct - a.chunk01_gap_over_snap_pct;
        }
        if (b.chunk01_gap_max_ms !== a.chunk01_gap_max_ms) {
            return b.chunk01_gap_max_ms - a.chunk01_gap_max_ms;
        }
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
            chunk01_over_snap_pct: THRESHOLD_CHUNK01_OVER_SNAP_PCT,
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
// Worst-utterance drill-down
//
// Two-query pattern: (1) pull all tts_playback_timing rows in the window,
// rank by chunk-0→1 gap, pick the top N. (2) For each, fetch neighboring
// events from the same session within ±windowSeconds. Keeps the per-row
// payload size big enough to debug from but small enough to render in a
// terminal without scrolling forever.
// ──────────────────────────────────────────────────────────────────────────

export async function queryTtsTimingWorstUtterances(
    client: Client,
    args: WorstUtteranceArgs,
): Promise<WorstUtteranceResult> {
    const top = Math.max(1, args.top ?? 1);
    const windowSeconds = args.windowSeconds ?? 5;

    const f = buildFilterClause(args);
    const where = combineWhere(f.where, `event_type = 'tts_playback_timing'`);
    const sql = `
        SELECT event_id, session_id, user_id, timestamp, payload
        FROM insights_events
        WHERE ${where}
    `;
    const raw = (await client.runQuery({ query: sql, variables: f.vars })) as unknown[];
    const rows = Array.isArray(raw[0]) ? (raw[0] as Array<Record<string, unknown>>) : [];

    // Compute chunk-0→1 gap per row, keep only ones with ≥2 chunks.
    interface Candidate {
        event_id: string;
        session_id: string;
        user_id: string | null;
        timestamp: string;
        payload: Record<string, unknown>;
        gap: number;
        snap_lookahead_ms: number;
    }
    const candidates: Candidate[] = [];
    for (const r of rows) {
        const payload = (r.payload ?? {}) as Record<string, unknown>;
        const chunks = Array.isArray(payload.chunks) ? (payload.chunks as ChunkSample[]) : [];
        if (chunks.length < 2) continue;
        const c0 = chunks[0]!;
        const c1 = chunks[1]!;
        const a0 = typeof c0.arrival_ms === 'number' ? c0.arrival_ms : 0;
        const a1 = typeof c1.arrival_ms === 'number' ? c1.arrival_ms : 0;
        const d0 = typeof c0.duration_ms === 'number' ? c0.duration_ms : 0;
        const gap = a1 - a0 - d0;
        const snapLA = typeof payload.snap_lookahead_ms === 'number' ? payload.snap_lookahead_ms : 333;
        candidates.push({
            event_id: String(r.event_id ?? ''),
            session_id: String(r.session_id ?? ''),
            user_id: r.user_id == null ? null : String(r.user_id),
            timestamp: String(r.timestamp ?? ''),
            payload,
            gap,
            snap_lookahead_ms: snapLA,
        });
    }

    candidates.sort((a, b) => b.gap - a.gap);
    const picked = candidates.slice(0, top);

    // For each pick, fetch nearby events. Done sequentially — N is small
    // (1-10 typically) and parallelism here would hammer the DB needlessly.
    const out: WorstUtteranceRow[] = [];
    for (const c of picked) {
        const center = new Date(c.timestamp).getTime();
        const lo = new Date(center - windowSeconds * 1000).toISOString();
        const hi = new Date(center + windowSeconds * 1000).toISOString();
        const nearbySql = `
            SELECT event_id, timestamp, event_type, payload
            FROM insights_events
            WHERE session_id = $sid
              AND timestamp >= <datetime> $lo
              AND timestamp <= <datetime> $hi
        `;
        const nearbyRaw = (await client.runQuery({
            query: nearbySql,
            variables: { sid: c.session_id, lo, hi },
        })) as unknown[];
        const nearbyRows = Array.isArray(nearbyRaw[0]) ? (nearbyRaw[0] as Array<Record<string, unknown>>) : [];

        const nearby = nearbyRows.map((e) => {
            const ts = String(e.timestamp ?? '');
            const tsMs = new Date(ts).getTime();
            const delta_s = (tsMs - center) / 1000;
            const et = String(e.event_type ?? '');
            return {
                timestamp: ts,
                delta_s: Math.round(delta_s * 1000) / 1000,
                event_type: et,
                payload_preview: previewPayload(et, e.payload),
            };
        });
        nearby.sort((a, b) => a.delta_s - b.delta_s);

        const exceeded = c.gap > c.snap_lookahead_ms;
        out.push({
            session_id: c.session_id,
            user_id: c.user_id,
            timestamp: c.timestamp,
            event_id: c.event_id,
            utterance_id: (c.payload.utterance_id as string | null | undefined) ?? null,
            chunk01_gap_ms: Math.round(c.gap),
            snap_budget_exceeded: exceeded,
            residual_silence_ms: exceeded ? Math.round(c.gap - c.snap_lookahead_ms) : 0,
            payload: c.payload,
            nearby_events: nearby,
        });
    }

    return {
        kind: 'tts_timing_worst_utterances',
        rows: out,
        total_utterances_considered: candidates.length,
        window_seconds: windowSeconds,
    };
}

/**
 * Tiny per-event-type preview so the nearby-events list is grep-friendly
 * without needing to dump the full payload of every event. Add cases here
 * when new diagnostically-useful events come online.
 */
function previewPayload(eventType: string, payload: unknown): string {
    const p = (payload ?? {}) as Record<string, unknown>;
    switch (eventType) {
        case 'llm_server_timing':
            return `phase=${p.phase} ms_since_request_start=${p.ms_since_request_start ?? '—'}`;
        case 'client_stream_timing':
            return `phase=${p.phase} ms_since_voice_session_start=${p.ms_since_voice_session_start ?? '—'}`;
        case 'tts_server_timing':
            return `phase=${p.phase} s=${p.s ?? '—'} batch=${p.batch ?? '—'} ts=${p.ts ?? '—'} bytes=${p.bytes ?? '—'}`;
        case 'tts_playback_timing':
            return `utterance_id=${p.utterance_id} connect_ms=${p.connect_ms ?? '—'} total_chunks=${p.total_chunks} snap_count=${p.snap_forward_count}`;
        case 'tts_stream_error':
            return `stage=${p.stage} latency_ms=${p.latency_ms} error="${String(p.error_message ?? p.error ?? '').slice(0, 60)}"`;
        case 'tts_stream_start':
            return `text="${String(p.text ?? '').slice(0, 60)}"`;
        case 'tts_stream_first_chunk':
            return `latency_ms=${p.latency_ms}`;
        case 'voice_session_first_audio':
            return `duration_ms=${p.duration_ms}`;
        case 'voice_session_templated_greeting':
            return `template_id=${p.template_id} duration_ms=${p.duration_ms}`;
        case 'llm_invocation':
            return `model=${p.model} tokens=${p.input_tokens}/${p.output_tokens}`;
        case 'user_input':
            return `text="${String(p.text ?? '').slice(0, 60)}"`;
        default:
            return '';
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Formatter (handles all three result kinds)
// ──────────────────────────────────────────────────────────────────────────

export function formatTtsTiming(
    result: TtsTimingResult | TtsTimingByChunkResult | WorstUtteranceResult,
    opts: FormatOpts = {},
): string {
    const format = opts.format ?? 'text';

    if (result.kind === 'tts_timing_by_session') {
        const rows: Record<string, unknown>[] = result.rows.map((r) => ({ ...r }));
        // Lead with the stutter columns — they're the actual user-impact signal.
        const columns = [
            'session_id', 'utterances',
            'chunk01_gap_over_snap_pct', 'chunk01_gap_max_ms', 'chunk01_gap_p95_ms', 'chunk01_gap_median_ms',
            'chunk0_snap_pct', 'chunk1plus_snap_pct',
            'snap_count', 'snap_rate',
            'max_gap_ms', 'p95_gap_ms',
            'avg_connect_ms', 'lookahead_ms', 'last_seen',
        ];
        const body = renderRows(rows, { ...opts, columns });
        if (format === 'json' || format === 'csv') return body;
        const t = result.thresholds;
        const header = [
            `total sessions: ${result.total_sessions}   utterances: ${result.total_utterances}   anomalous: ${result.anomalous_sessions}/${result.total_sessions}`,
            `thresholds: chunk01_gap_over_snap_pct > ${t.chunk01_over_snap_pct}%  |  snap_rate > ${t.snap_rate}  |  chunk0_snap_pct > ${t.chunk0_snap_pct}%  |  max_gap_ms > ${t.max_gap_ms}`,
        ].join('\n');
        return `${header}\n${body}`;
    }

    if (result.kind === 'tts_timing_by_chunk_index') {
        const rows: Record<string, unknown>[] = result.rows.map((r) => ({ ...r }));
        const columns = [
            'chunk_index', 'observations', 'snapped', 'snap_pct',
            'median_arrival_ms', 'p95_arrival_ms',
        ];
        const body = renderRows(rows, { ...opts, columns });
        if (format === 'json' || format === 'csv') return body;
        return `total utterances: ${result.total_utterances}\n${body}`;
    }

    // tts_timing_worst_utterances — one section per utterance.
    if (format === 'json') return JSON.stringify(result, null, 2);
    if (format === 'csv') {
        // CSV doesn't fit the nested shape well; flatten to one row per utterance
        // dropping nearby_events. JSON is the right export format for this view.
        const rows = result.rows.map((r) => ({
            session_id: r.session_id, timestamp: r.timestamp, utterance_id: r.utterance_id,
            chunk01_gap_ms: r.chunk01_gap_ms, snap_budget_exceeded: r.snap_budget_exceeded,
            residual_silence_ms: r.residual_silence_ms,
        })) as Record<string, unknown>[];
        return renderRows(rows, opts);
    }

    const parts: string[] = [];
    parts.push(`Worst chunk-0→1 gaps (top ${result.rows.length} of ${result.total_utterances_considered} utterances), ±${result.window_seconds}s context`);
    parts.push('');
    for (const r of result.rows) {
        parts.push('═'.repeat(78));
        parts.push(`utterance_id: ${r.utterance_id ?? '(none)'}`);
        parts.push(`session_id:   ${r.session_id}`);
        parts.push(`timestamp:    ${r.timestamp}`);
        parts.push(`chunk-0→1 gap: ${r.chunk01_gap_ms} ms` + (r.snap_budget_exceeded
            ? `  ← EXCEEDS snap budget by ${r.residual_silence_ms} ms (residual audible silence)`
            : `  (within snap budget — hidden)`));
        parts.push('');
        parts.push('-- payload summary --');
        const p = r.payload;
        const interesting = [
            'path', 'cancelled', 'connect_ms', 'ctx_state_before', 'ctx_resume_ms',
            'snap_lookahead_ms', 'initial_lookahead_ms', 'snap_forward_count',
            'total_chunks', 'total_audio_ms', 'stream_duration_ms',
        ];
        for (const k of interesting) {
            if (k in p) parts.push(`  ${k}: ${JSON.stringify(p[k])}`);
        }
        const chunks = Array.isArray(p.chunks) ? (p.chunks as ChunkSample[]) : [];
        if (chunks.length > 0) {
            parts.push('-- chunks --');
            chunks.forEach((c, i) => {
                parts.push(`  [${i}]: arrival=${c.arrival_ms}ms duration=${c.duration_ms}ms snapped=${c.snapped_forward} slack=${c.schedule_slack_ms}ms`);
            });
        }
        parts.push('');
        parts.push('-- nearby events --');
        for (const e of r.nearby_events) {
            const delta = `${e.delta_s >= 0 ? '+' : ''}${e.delta_s.toFixed(3)}s`;
            const preview = e.payload_preview ? `  ${e.payload_preview}` : '';
            parts.push(`  ${delta.padStart(8)}  ${e.event_type.padEnd(36)}${preview}`);
        }
        parts.push('');
    }
    return parts.join('\n');
}
