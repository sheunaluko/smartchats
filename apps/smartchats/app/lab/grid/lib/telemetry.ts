/**
 * Grid keyboard telemetry — sibling of the onehand telemetry module
 * but independent so the two experiments don't share session state.
 *
 * Writes go into the existing `onehand_taps` / `onehand_sessions`
 * tables (schemaless, so adding `variant` per row is fine). Sessions
 * are stamped layout_id='grid' and each tap row carries the current
 * variant string so we can split metrics later.
 */

import { getBackend } from '@/lib/backend';
import { queries } from 'smartchats-database';
import { nowEventTime, getUserTimezone } from '../../../modules/system';

const FLUSH_MS = 500;
const LAYOUT_ID = 'grid';
const LAYOUT_REV = 1;

export interface GridTapRow {
    seq: number;
    t_rel_ms: number;
    variant: string;
    key_id: string;
    primary: string;
    kind: 'letter' | 'command';
    committed_char: string;
    is_backspace: boolean;
    tap_x_norm: number;
    tap_y_norm: number;
    key_left_pct: number;
    key_top_pct: number;
    key_width_pct: number;
    key_height_pct: number;
    dwell_ms: number;
    inter_ms: number;
}

interface SessionContext {
    id: string;
    startedAt: number;
}

let _session: SessionContext | null = null;
let _pending: GridTapRow[] = [];
let _flushTimer: ReturnType<typeof setInterval> | null = null;
let _inFlight = false;

function randomId(): string {
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

export async function openSession(opts: { viewportW: number; viewportH: number }): Promise<string> {
    if (_session) return _session.id;
    const id = randomId();
    _session = { id, startedAt: performance.now() };

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
        console.warn('[grid] openSession write failed (will retry on tap flush):', err);
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

export function pushTap(tap: GridTapRow): void {
    if (!_session) return;
    _pending.push(tap);
}

export async function flushNow(): Promise<void> {
    if (_inFlight || !_session || _pending.length === 0) return;
    const session = _session;
    const batch = _pending;
    _pending = [];
    _inFlight = true;
    const tz = getUserTimezone();

    try {
        const rows = batch.map((t) => {
            const wallNow = new Date();
            const nowRel = performance.now() - session.startedAt;
            const tapWall = new Date(wallNow.getTime() - (nowRel - t.t_rel_ms));
            const local_date = tapWall.toLocaleDateString('sv-SE', { timeZone: tz });
            return {
                session_id: session.id,
                seq: t.seq,
                t_rel_ms: t.t_rel_ms,
                variant: t.variant,
                key_id: t.key_id,
                primary: t.primary,
                kind: t.kind,
                committed_char: t.committed_char,
                is_backspace: t.is_backspace,
                tap_x_norm: t.tap_x_norm,
                tap_y_norm: t.tap_y_norm,
                key_left_pct: t.key_left_pct,
                key_top_pct: t.key_top_pct,
                key_width_pct: t.key_width_pct,
                key_height_pct: t.key_height_pct,
                dwell_ms: t.dwell_ms,
                inter_ms: t.inter_ms,
                layout_id: LAYOUT_ID,
                layout_rev: LAYOUT_REV,
                ts: tapWall.toISOString(),
                local_date,
                local_tz: tz,
            };
        });
        await getBackend().data.query(queries.insertOnehandTaps(rows as any));
    } catch (err) {
        _pending = batch.concat(_pending);
        console.warn('[grid] tap flush failed (will retry):', err);
    } finally {
        _inFlight = false;
    }
}

export interface GridSessionSummary {
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

export async function closeSession(summary: GridSessionSummary): Promise<void> {
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
        console.warn('[grid] closeSession write failed:', err);
    }
}
