/**
 * Event-time helpers for the seed generator. Mirrors the runtime
 * `nowEventTime()` / `eventTimeAt()` in `apps/smartchats/app/modules/system.ts`
 * but with a fixed anchor (no `new Date()`) so generation stays deterministic.
 *
 * Persona tz is fixed at America/Chicago — matches the canonical user.
 */
import type { EventTimeFields } from '../types.js';

export const PERSONA_TZ = 'America/Chicago';

/** YYYY-MM-DD in the given tz. */
export function toLocalDate(d: Date, tz: string = PERSONA_TZ): string {
  // sv-SE locale renders ISO date format reliably across runtimes.
  return d.toLocaleDateString('sv-SE', { timeZone: tz });
}

export function eventTimeAt(d: Date, tz: string = PERSONA_TZ): EventTimeFields {
  return { ts: d.toISOString(), local_date: toLocalDate(d, tz), local_tz: tz };
}

/** Build a Date at a given local hour/minute in the persona tz, on a given local YYYY-MM-DD. */
export function localDateTime(localDate: string, hour: number, minute = 0, tz: string = PERSONA_TZ): Date {
  // Build a tz-naive moment and ask Intl what UTC it corresponds to in tz.
  // For non-DST-edge cases this is exact; benchpress data avoids the
  // spring-forward gap by never picking 02:00-03:00 local on transition days.
  const isoNaive = `${localDate}T${pad2(hour)}:${pad2(minute)}:00`;
  // Treat isoNaive as if it were the wall-clock in tz, then resolve to a UTC instant.
  // Strategy: take the naive string as UTC, then shift by the tz offset at that moment.
  const asUtc = new Date(isoNaive + 'Z');
  const offsetMin = tzOffsetMinutes(asUtc, tz);
  return new Date(asUtc.getTime() - offsetMin * 60_000);
}

function pad2(n: number): string {
  return n.toString().padStart(2, '0');
}

/** Minutes that tz is offset from UTC at instant `d` (CDT = -300, CST = -360). */
function tzOffsetMinutes(d: Date, tz: string): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const parts = Object.fromEntries(dtf.formatToParts(d).map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(parts.year), Number(parts.month) - 1, Number(parts.day),
    Number(parts.hour) % 24, Number(parts.minute), Number(parts.second),
  );
  return (asUtc - d.getTime()) / 60_000;
}

/** Inclusive iter over local YYYY-MM-DD strings from start..end. */
export function* eachLocalDate(startLocalDate: string, endLocalDate: string, tz: string = PERSONA_TZ): Generator<string> {
  const start = localDateTime(startLocalDate, 12, 0, tz);
  const end = localDateTime(endLocalDate, 12, 0, tz);
  for (let t = start.getTime(); t <= end.getTime(); t += 86_400_000) {
    yield toLocalDate(new Date(t), tz);
  }
}

/** YYYY-MM string for monthly aggregation. */
export function yearMonth(localDate: string): string {
  return localDate.slice(0, 7);
}

/** Day of week as 0=Sun..6=Sat in the persona tz. */
export function dayOfWeek(localDate: string, tz: string = PERSONA_TZ): number {
  const d = localDateTime(localDate, 12, 0, tz);
  return new Date(d.toLocaleString('en-US', { timeZone: tz })).getDay();
}
