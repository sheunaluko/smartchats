/**
 * Onehand keyboard query builders.
 *
 * Backs the lab/onehand experiment (apps/smartchats/app/lab/onehand).
 * Three tables: onehand_taps (atomic), onehand_words (word-grain
 * rollup), onehand_sessions (session-grain summary). All carry the
 * canonical ts / local_date / local_tz event-time triple.
 *
 * Schemaless writes — the inserted object is the source of truth for
 * field shape; this builder just stamps it into SurrealQL.
 */

import type { QuerySpec, EventTimeFields } from '../types.js';

// ── Tap inserts ────────────────────────────────────────────────────────────

export interface InsertOnehandTapArgs extends EventTimeFields {
    session_id: string;
    seq: number;
    t_rel_ms: number;
    intended_key: string;
    resolved_key: string;
    finger: string;
    arc: string;
    gesture: string;
    layout_rev: number;
    tap_x_norm: number;
    tap_y_norm: number;
    key_center_x_norm: number;
    key_center_y_norm: number;
    dwell_ms: number;
    inter_ms: number;
    is_backspace: boolean;
    committed_char: string;
    layer: string;
}

/**
 * Bulk INSERT taps. SurrealQL accepts an array on INSERT to write
 * multiple rows in one round-trip — meaningful at 80+ WPM where
 * single-row inserts would hammer the channel.
 */
export function insertOnehandTaps(taps: InsertOnehandTapArgs[]): QuerySpec {
    return {
        query: `INSERT INTO onehand_taps $taps`,
        variables: { taps },
    };
}

// ── Word inserts ───────────────────────────────────────────────────────────

export interface InsertOnehandWordArgs extends EventTimeFields {
    session_id: string;
    word: string;
    first_tap_seq: number;
    last_tap_seq: number;
    duration_ms: number;
    wpm_word: number;
    corrections: number;
}

export function insertOnehandWords(words: InsertOnehandWordArgs[]): QuerySpec {
    return {
        query: `INSERT INTO onehand_words $words`,
        variables: { words },
    };
}

// ── Session lifecycle ──────────────────────────────────────────────────────

export interface InsertOnehandSessionArgs extends EventTimeFields {
    id: string;
    layout_id: string;
    layout_rev: number;
    device_ua: string;
    viewport_w: number;
    viewport_h: number;
}

/**
 * Open a session row. `id` is the client-generated session UUID — used
 * as the foreign key on every subsequent tap and as the record key
 * (`onehand_sessions:<id>`) for the summary update on session close.
 */
export function insertOnehandSession(args: InsertOnehandSessionArgs): QuerySpec {
    const { id, ...rest } = args;
    return {
        query: `INSERT INTO onehand_sessions {
                        id: type::record('onehand_sessions', $id),
                        ts: <datetime> $ts,
                        local_date: <string> $local_date,
                        local_tz: <string> $local_tz,
                        layout_id: $layout_id,
                        layout_rev: $layout_rev,
                        device_ua: $device_ua,
                        viewport_w: $viewport_w,
                        viewport_h: $viewport_h,
                        status: 'open'
                    }`,
        variables: { id, ...rest },
    };
}

export interface UpdateOnehandSessionSummaryArgs {
    id: string;
    end_ts: string;
    summary: {
        taps: number;
        chars_committed: number;
        words: number;
        duration_ms: number;
        wpm_mean: number;
        wpm_p50: number;
        wpm_p95: number;
        accuracy: number;
        correction_rate: number;
        median_iki_ms: number;
        median_dwell_ms: number;
    };
}

/**
 * Close a session with summary stats. Caller computes the rollup
 * locally then calls this once; we don't recompute from taps at
 * query time.
 */
export function updateOnehandSessionSummary(args: UpdateOnehandSessionSummaryArgs): QuerySpec {
    return {
        query: `UPDATE type::record('onehand_sessions', $id) SET
                    end_ts = <datetime> $end_ts,
                    summary = $summary,
                    status = 'closed',
                    updated_at = time::now()`,
        variables: { ...args },
    };
}

// ── Read queries (history view) ───────────────────────────────────────────

/**
 * Daily WPM aggregation. Returns one row per local_date with mean
 * + p95 WPM from session summaries. Local_date keys mean no tz logic
 * at query time — daily buckets align with the user's calendar day.
 */
export function getOnehandWpmByDate(args: { since_local_date?: string; limit?: number }): QuerySpec {
    const limit = Math.min(Math.max(args.limit ?? 60, 1), 365);
    const where = args.since_local_date
        ? `WHERE status = 'closed' AND local_date >= $since`
        : `WHERE status = 'closed'`;
    return {
        query: `SELECT local_date,
                       math::mean(summary.wpm_mean) AS wpm_mean,
                       math::max(summary.wpm_p95) AS wpm_p95,
                       math::sum(summary.taps) AS taps,
                       math::sum(summary.duration_ms) AS duration_ms,
                       count() AS sessions
                FROM onehand_sessions
                ${where}
                GROUP BY local_date
                ORDER BY local_date DESC
                LIMIT ${limit}`,
        variables: args.since_local_date ? { since: args.since_local_date } : {},
    };
}

/**
 * Recent taps for heatmap rendering. Returns x/y/key for the last N
 * taps in a date window.
 */
export function getOnehandRecentTaps(args: { since_local_date?: string; limit?: number }): QuerySpec {
    const limit = Math.min(Math.max(args.limit ?? 5000, 1), 50000);
    const where = args.since_local_date
        ? `WHERE local_date >= $since`
        : '';
    return {
        query: `SELECT tap_x_norm, tap_y_norm, key_center_x_norm, key_center_y_norm,
                       resolved_key, intended_key, finger, arc, is_backspace, dwell_ms
                FROM onehand_taps
                ${where}
                ORDER BY ts DESC
                LIMIT ${limit}`,
        variables: args.since_local_date ? { since: args.since_local_date } : {},
    };
}

/**
 * Per-key tap density + dwell. Pulls from the tap-grain table; only
 * useful for last-day or last-week windows because of row volume at
 * higher WPMs.
 */
export function getOnehandKeyStats(args: { since_local_date: string }): QuerySpec {
    return {
        query: `SELECT resolved_key,
                       count() AS taps,
                       math::mean(dwell_ms) AS dwell_mean,
                       math::mean(inter_ms) AS inter_mean,
                       math::sum(is_backspace ? 1 : 0) AS backspaces
                FROM onehand_taps
                WHERE local_date >= $since
                GROUP BY resolved_key
                ORDER BY taps DESC`,
        variables: { since: args.since_local_date },
    };
}
