/**
 * Telemetry write path — pending tap buffer + periodic batched flush.
 *
 * Open a session on Keyboard mount, push a row per tap, flush every
 * 500 ms (or on tab hide). On unmount, flush once more and write the
 * session close with summary stats. SurrealDB inserts go through the
 * existing LocalBackend / SurrealBackend via `getBackend().data.query`.
 *
 * Failures are swallowed — telemetry must never break typing. The
 * pending buffer just retries on the next interval tick.
 */

import { getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';
import { nowEventTime, getUserTimezone } from '../../../modules/system';
import { TapEvent } from './types';
import { LAYOUT_ID, LAYOUT_REV } from './layout';

const FLUSH_MS = 500;

interface SessionContext {
    id: string;
    startedAt: number;
    layoutId: string;
    layoutRev: number;
}

let _session: SessionContext | null = null;
let _pending: TapEvent[] = [];
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _inFlight = false;

function randomId(): string {
    // 16 hex chars — enough entropy for a per-device session id.
    const bytes = new Uint8Array(8);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
    } else {
        for (let i = 0; i < 8; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(bytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('');
}

/**
 * Open a session row in onehand_sessions and start the periodic
 * flush. Returns the session id so the caller can include it on
 * every subsequent tap.
 */
export async function openSession(opts: { viewportW: number; viewportH: number }): Promise<string> {
    if (_session) return _session.id;
    const id = randomId();
    _session = {
        id,
        startedAt: performance.now(),
        layoutId: LAYOUT_ID,
        layoutRev: LAYOUT_REV,
    };

    try {
        await getBackend().data.query(
            queries.insertOnehandSession({
                id,
                layout_id: LAYOUT_ID,
                layout_rev: LAYOUT_REV,
                device_ua: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
                viewport_w: opts.viewportW,
                viewport_h: opts.viewportH,
                ...nowEventTime(),
            }),
        );
    } catch (err) {
        // Schema not applied yet, backend offline, etc — keep going
        // with telemetry in memory; flushes will retry.
        console.warn('[onehand] openSession write failed (will retry on tap flush):', err);
    }

    if (_flushTimer === null) {
        _flushTimer = setInterval(() => {
            void flushNow();
        }, FLUSH_MS);
    }
    return id;
}

export function getSessionId(): string | null {
    return _session?.id ?? null;
}

/** Append a tap to the pending buffer. Caller stamps everything; we
 *  just hold the row until the next flush. */
export function pushTap(tap: TapEvent): void {
    if (!_session) return;
    _pending.push(tap);
}

/**
 * Send all pending taps to SurrealDB in one batched INSERT. Holds a
 * single-flight flag so two timer ticks don't double-send.
 */
export async function flushNow(): Promise<void> {
    if (_inFlight || !_session || _pending.length === 0) return;
    const session = _session;
    const batch = _pending;
    _pending = [];
    _inFlight = true;
    const tz = getUserTimezone();

    try {
        const rows = batch.map((t) => {
            const { ts, local_date, local_tz } = nowEventTimeForTap(t, tz);
            return {
                session_id: session.id,
                seq: t.session_seq,
                t_rel_ms: t.t_rel_ms,
                intended_key: t.intended_key,
                resolved_key: t.resolved_key,
                finger: t.finger,
                arc: t.arc,
                gesture: t.gesture,
                layout_rev: session.layoutRev,
                tap_x_norm: t.tap_x_norm,
                tap_y_norm: t.tap_y_norm,
                key_center_x_norm: t.key_center_x_norm,
                key_center_y_norm: t.key_center_y_norm,
                dwell_ms: t.dwell_ms,
                inter_ms: t.inter_ms,
                is_backspace: t.is_backspace,
                committed_char: t.committed_char,
                layer: t.layer,
                ts,
                local_date,
                local_tz,
            };
        });
        await getBackend().data.query(queries.insertOnehandTaps(rows as any));
    } catch (err) {
        // Re-queue failed batch at the front so we don't lose data.
        _pending = batch.concat(_pending);
        console.warn('[onehand] tap flush failed (will retry):', err);
    } finally {
        _inFlight = false;
    }
}

/**
 * Event-time for a tap: the moment the tap happened. Since
 * `nowEventTime()` is "now" and we want the tap's actual ts, we
 * back-compute from `t_rel_ms` relative to session start in
 * wall-clock terms.
 */
function nowEventTimeForTap(
    tap: TapEvent,
    tz: string,
): { ts: string; local_date: string; local_tz: string } {
    // Approximate session start in wall-clock terms: now − (now_rel − tap_rel).
    const now = new Date();
    const nowRel = performance.now() - (_session?.startedAt ?? performance.now());
    const tapWall = new Date(now.getTime() - (nowRel - tap.t_rel_ms));
    const local_date = tapWall.toLocaleDateString('sv-SE', { timeZone: tz });
    return { ts: tapWall.toISOString(), local_date, local_tz: tz };
}

interface SessionSummary {
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
}

/**
 * Final flush + write session summary, then tear down the flush
 * timer. Safe to call multiple times (subsequent calls no-op).
 */
export async function closeSession(summary: SessionSummary): Promise<void> {
    if (!_session) return;
    const session = _session;
    _session = null;
    if (_flushTimer !== null) {
        clearInterval(_flushTimer);
        _flushTimer = null;
    }
    await flushNow();
    try {
        await getBackend().data.query(
            queries.updateOnehandSessionSummary({
                id: session.id,
                end_ts: new Date().toISOString(),
                summary,
            }),
        );
    } catch (err) {
        console.warn('[onehand] closeSession write failed:', err);
    }
}
