/**
 * traces — reconstruct causality trees from `parent_event_id` chains.
 *
 * A trace groups every event sharing a `trace_id`. Within a trace, each
 * event optionally points at a parent event via `parent_event_id`. The
 * result is a tree (or forest) of events. We render it as an indented
 * outline with each node's type + status + duration.
 *
 * Useful for: spotting orphan events, understanding which llm_invocation
 * spawned which execution, seeing the full timeline of one turn.
 */

import type { SessionBundle, SessionTimelineEntry } from '../types.js';
import { fmtClock, fmtDuration, truncate } from './_format.js';

export interface TraceNode {
    event: SessionTimelineEntry;
    children: TraceNode[];
}

export interface TraceTree {
    trace_id: string;
    roots: TraceNode[];
    /** Events with a trace_id but no parent inside the trace (forest roots). */
    orphan_count: number;
    /** Earliest / latest event timestamps inside this trace. */
    start_ms: number;
    end_ms: number;
    duration_ms: number;
    event_count: number;
    error_count: number;
}

export interface TracesResult {
    session_id: string;
    traces: TraceTree[];
}

export function buildTraceTrees(bundle: SessionBundle): TracesResult {
    const byTrace: Record<string, SessionTimelineEntry[]> = {};
    for (const e of bundle.timeline) {
        if (!e.trace_id) continue;
        (byTrace[e.trace_id] ??= []).push(e);
    }

    const trees: TraceTree[] = [];
    for (const [trace_id, events] of Object.entries(byTrace)) {
        const byId = new Map<string, TraceNode>();
        for (const e of events) byId.set(e.event_id, { event: e, children: [] });
        const roots: TraceNode[] = [];
        let orphan_count = 0;
        for (const node of byId.values()) {
            const parentId = node.event.parent_event_id;
            const parent = parentId ? byId.get(parentId) : undefined;
            if (parent) {
                parent.children.push(node);
            } else {
                roots.push(node);
                if (parentId) orphan_count++;
            }
        }
        const start_ms = events[0].timestamp;
        const end_ms = events[events.length - 1].timestamp;
        const error_count = events.filter(
            (e) =>
                /error|fail/i.test(e.event_type) ||
                e.tags?.includes('error') ||
                (e.payload as { status?: string })?.status === 'error',
        ).length;
        trees.push({
            trace_id,
            roots,
            orphan_count,
            start_ms,
            end_ms,
            duration_ms: end_ms - start_ms,
            event_count: events.length,
            error_count,
        });
    }

    trees.sort((a, b) => a.start_ms - b.start_ms);
    return { session_id: bundle.session_id, traces: trees };
}

function statusOf(e: SessionTimelineEntry): string {
    const status = (e.payload as { status?: string })?.status;
    const tags = e.tags ?? [];
    if (status === 'error' || tags.includes('error')) return '✗';
    if (tags.includes('slow')) return '⏱';
    if (status === 'success' || status === 'ok') return '✓';
    return ' ';
}

function renderNode(node: TraceNode, depth: number, lines: string[]): void {
    const e = node.event;
    const pad = '  '.repeat(depth);
    const dur = e.duration_ms !== undefined ? `  (${fmtDuration(e.duration_ms)})` : '';
    lines.push(`${pad}${statusOf(e)} ${fmtClock(e.timestamp)}  ${e.event_type}${dur}  ${e.event_id}`);
    for (const child of node.children) renderNode(child, depth + 1, lines);
}

export interface TracesFormatOpts {
    markdown?: boolean;
    /** When set, only render the trace with this id. */
    traceId?: string;
    /** Hide traces with fewer than this many events. Default 1 (no filter). */
    minEvents?: number;
}

export function formatTraces(result: TracesResult, opts: TracesFormatOpts = {}): string {
    const out: string[] = [];
    const h1 = opts.markdown ? '# ' : '';
    const h2 = opts.markdown ? '## ' : '';
    const minEvents = opts.minEvents ?? 1;

    out.push(`${h1}Traces — session ${result.session_id}`);
    let traces = result.traces.filter((t) => t.event_count >= minEvents);
    if (opts.traceId) traces = traces.filter((t) => t.trace_id === opts.traceId);
    out.push(`Trace count: ${traces.length}${result.traces.length !== traces.length ? ` (of ${result.traces.length})` : ''}`);
    out.push('');

    for (const t of traces) {
        out.push(`${h2}${t.trace_id}`);
        out.push(
            `  events=${t.event_count}  errors=${t.error_count}  ` +
            `started=${fmtClock(t.start_ms)}  duration=${fmtDuration(t.duration_ms)}` +
            (t.orphan_count > 0 ? `  orphans=${t.orphan_count}` : ''),
        );
        for (const root of t.roots) renderNode(root, 1, out);
        out.push('');
    }
    return out.join('\n');
}
