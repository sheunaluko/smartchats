/**
 * inspect — deep dump of a single event (or trace) with full context.
 *
 * Given an `event_id`, returns:
 *   • the event itself
 *   • its parent chain (walking `parent_event_id` up to the root)
 *   • its direct children
 *   • its trace siblings (events with the same trace_id)
 *
 * Given a `trace_id`, returns the entire trace as an ordered list.
 *
 * Useful when an automated analyzer flags an event of interest and a
 * human (or another agent) wants the full causal context to reason about
 * it.
 */

import type { SessionBundle, SessionTimelineEntry } from '../types.js';
import { fmtClock, fmtDuration } from './_format.js';

export interface InspectEventResult {
    event: SessionTimelineEntry;
    parents: SessionTimelineEntry[]; // root → immediate parent (oldest first)
    children: SessionTimelineEntry[];
    trace_siblings: SessionTimelineEntry[];
}

export function inspectEvent(bundle: SessionBundle, eventId: string): InspectEventResult | null {
    const byId = new Map<string, SessionTimelineEntry>();
    const childrenOf = new Map<string, SessionTimelineEntry[]>();
    for (const e of bundle.timeline) {
        byId.set(e.event_id, e);
        if (e.parent_event_id) {
            const list = childrenOf.get(e.parent_event_id) ?? [];
            list.push(e);
            childrenOf.set(e.parent_event_id, list);
        }
    }
    const event = byId.get(eventId);
    if (!event) return null;

    const parents: SessionTimelineEntry[] = [];
    let cur: SessionTimelineEntry | undefined = event;
    const seen = new Set<string>();
    while (cur?.parent_event_id && !seen.has(cur.parent_event_id)) {
        seen.add(cur.parent_event_id);
        const parent = byId.get(cur.parent_event_id);
        if (!parent) break;
        parents.unshift(parent);
        cur = parent;
    }

    const children = childrenOf.get(event.event_id) ?? [];
    const trace_siblings = event.trace_id
        ? bundle.timeline.filter((e) => e.trace_id === event.trace_id && e.event_id !== event.event_id)
        : [];

    return { event, parents, children, trace_siblings };
}

export function inspectTrace(bundle: SessionBundle, traceId: string): SessionTimelineEntry[] {
    return bundle.timeline.filter((e) => e.trace_id === traceId);
}

function fmtEventLine(e: SessionTimelineEntry): string {
    const dur = e.duration_ms !== undefined ? `  (${fmtDuration(e.duration_ms)})` : '';
    const tags = e.tags?.length ? `  [${e.tags.join(',')}]` : '';
    return `${fmtClock(e.timestamp)}  ${e.event_type}${dur}${tags}  ${e.event_id}`;
}

export function formatInspectEvent(
    r: InspectEventResult,
    opts: { markdown?: boolean; rawPayload?: boolean } = {},
): string {
    const out: string[] = [];
    const h1 = opts.markdown ? '# ' : '';
    const h2 = opts.markdown ? '## ' : '';

    out.push(`${h1}Event ${r.event.event_id}`);
    out.push(`Type     : ${r.event.event_type}`);
    out.push(`Timestamp: ${fmtClock(r.event.timestamp)}`);
    if (r.event.trace_id) out.push(`Trace    : ${r.event.trace_id}`);
    if (r.event.duration_ms !== undefined) out.push(`Duration : ${fmtDuration(r.event.duration_ms)}`);
    if (r.event.tags?.length) out.push(`Tags     : ${r.event.tags.join(', ')}`);
    out.push('');

    if (r.parents.length > 0) {
        out.push(`${h2}Parent chain (root → leaf)`);
        for (const p of r.parents) out.push(`  ${fmtEventLine(p)}`);
        out.push('');
    }

    if (r.children.length > 0) {
        out.push(`${h2}Children (${r.children.length})`);
        for (const c of r.children) out.push(`  ${fmtEventLine(c)}`);
        out.push('');
    }

    if (r.trace_siblings.length > 0) {
        out.push(`${h2}Trace siblings (${r.trace_siblings.length})`);
        for (const s of r.trace_siblings) out.push(`  ${fmtEventLine(s)}`);
        out.push('');
    }

    if (opts.rawPayload !== false) {
        out.push(`${h2}Payload`);
        if (opts.markdown) {
            out.push('```json', JSON.stringify(r.event.payload, null, 2), '```');
        } else {
            out.push(JSON.stringify(r.event.payload, null, 2));
        }
    }
    return out.join('\n');
}

export function formatInspectTrace(
    events: SessionTimelineEntry[],
    traceId: string,
    opts: { markdown?: boolean } = {},
): string {
    const out: string[] = [];
    const h1 = opts.markdown ? '# ' : '';
    out.push(`${h1}Trace ${traceId}`);
    out.push(`Events: ${events.length}`);
    if (events.length > 0) {
        out.push(`Span  : ${fmtClock(events[0].timestamp)} → ${fmtClock(events[events.length - 1].timestamp)}` +
            `  (${fmtDuration(events[events.length - 1].timestamp - events[0].timestamp)})`);
    }
    out.push('');
    for (const e of events) out.push(fmtEventLine(e));
    return out.join('\n');
}
