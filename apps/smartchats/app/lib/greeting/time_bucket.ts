/**
 * Time-of-day bucket derivation.
 *
 * Buckets are user-perceived periods, not strict astronomical ones —
 * "evening" begins when most people would say "good evening" rather than
 * "good afternoon". Hours are inclusive at the lower bound, exclusive at
 * the upper:
 *
 *   morning   [5, 12)
 *   afternoon [12, 18)
 *   evening   [18, 22)
 *   night     [22, 5)        ← wraps midnight
 *
 * 'neutral' is returned only when caller explicitly asks for a
 * time-agnostic greeting (e.g. for testing or when locale data is
 * unavailable).
 */

export type TimeBucket = 'morning' | 'afternoon' | 'evening' | 'night' | 'neutral';

export interface TimeBucketContext {
    /** Defaults to new Date(). */
    now?: Date;
    /** IANA timezone, e.g. 'America/Chicago'. Defaults to the browser's
     *  resolved timezone. SSR callers should pass an explicit value. */
    tz?: string;
}

/** Read the local hour [0, 24) at `now` in `tz`. Uses Intl rather than
 *  raw Date getters so it respects DST + arbitrary IANA zones. */
export function localHour(ctx: TimeBucketContext = {}): number {
    const now = ctx.now ?? new Date();
    const tz = ctx.tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
    const fmt = new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour: 'numeric',
        hourCycle: 'h23',
    });
    const hourStr = fmt.format(now);
    const hour = parseInt(hourStr, 10);
    return Number.isFinite(hour) ? hour : now.getHours();
}

export function timeBucketAt(ctx: TimeBucketContext = {}): TimeBucket {
    const h = localHour(ctx);
    if (h >= 5 && h < 12) return 'morning';
    if (h >= 12 && h < 18) return 'afternoon';
    if (h >= 18 && h < 22) return 'evening';
    return 'night';
}
