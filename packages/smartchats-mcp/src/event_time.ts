/**
 * Event-time stamping for MCP write tools.
 *
 * Ports the canonical `nowEventTime()` / `eventTimeAt()` algorithm from
 * `apps/smartchats/app/modules/system.ts` so MCP-initiated writes carry
 * the same `ts` / `local_date` / `local_tz` triple every other writer
 * stamps. Lifting this to a shared package (e.g. `smartchats-common`)
 * is a TODO so the algorithm has one canonical location.
 *
 * Timezone resolution:
 *   1. SMARTCHATS_MCP_TIMEZONE env var (explicit override)
 *   2. Node's `Intl.DateTimeFormat().resolvedOptions().timeZone` (system tz)
 *   3. 'UTC' fallback (only if Intl throws)
 *
 * Because the MCP runs as a stdio child of Claude Code on the user's
 * machine, the system-tz lookup naturally gets the user's actual tz
 * with zero config.
 */

import type { EventTimeFields } from "smartchats-database";

/** Resolve the IANA timezone string for event-time stamping. */
export function getUserTimezone(): string {
    if (process.env.SMARTCHATS_MCP_TIMEZONE) return process.env.SMARTCHATS_MCP_TIMEZONE;
    try {
        return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
        return "UTC";
    }
}

/**
 * Convert an instant to its `YYYY-MM-DD` calendar date in the given tz.
 * Uses the Swedish locale ('sv-SE') because it formats as YYYY-MM-DD
 * unconditionally — same trick the app uses.
 */
export function toLocalDate(ts: string | Date, tz: string): string {
    const d = typeof ts === "string" ? new Date(ts) : ts;
    return d.toLocaleDateString("sv-SE", { timeZone: tz });
}

/** Build the event-time triple anchored at an explicit moment. */
export function eventTimeAt(anchor: Date, tz: string = getUserTimezone()): EventTimeFields {
    return {
        ts: anchor.toISOString(),
        local_date: toLocalDate(anchor, tz),
        local_tz: tz,
    };
}

/** Build the event-time triple for "now". */
export function nowEventTime(): EventTimeFields {
    return eventTimeAt(new Date());
}

/**
 * Parse an optional override string. Accepts either:
 *   - A full ISO datetime ("2026-05-12T14:30:00Z") → uses that instant
 *   - A YYYY-MM-DD date ("2026-05-12") → interpreted as midnight in the
 *     resolved tz (so backfills like "log this as 2026-05-12" land on
 *     that local day, not on a UTC-shifted day)
 *
 * Returns the event-time triple. Throws on unparseable input.
 */
export function eventTimeFromOverride(override: string): EventTimeFields {
    const tz = getUserTimezone();
    // YYYY-MM-DD only? Anchor it at noon-local to avoid DST edge cases
    // shifting the local_date when the toISOString() round-trip lands the
    // instant on a different UTC day. (Noon is always the same calendar
    // day in every tz; midnight isn't.)
    if (/^\d{4}-\d{2}-\d{2}$/.test(override)) {
        const anchor = new Date(`${override}T12:00:00Z`);
        return {
            ts: anchor.toISOString(),
            local_date: override,
            local_tz: tz,
        };
    }
    const anchor = new Date(override);
    if (isNaN(anchor.getTime())) {
        throw new Error(`Invalid event_time_override: '${override}' (expected YYYY-MM-DD or ISO datetime)`);
    }
    return eventTimeAt(anchor, tz);
}
