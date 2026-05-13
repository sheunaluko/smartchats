/**
 * errors — extract failures, surface them with surrounding context.
 *
 * A failure is any timeline entry that matches one of:
 *   • payload.status ∈ {"error", "fail", "failure"}
 *   • payload.error is a truthy non-null value
 *   • event_type contains "error" or "fail" (case-insensitive)
 *   • tags includes "error"
 *
 * For each error we capture:
 *   • the error message (best-effort field extraction)
 *   • the executed code (when an `execution` event) — these are by far
 *     the most actionable failures
 *   • the surrounding trace: the prior user_input, the llm_invocation
 *     that produced this code, and any sibling events in the same trace_id.
 */

import type { SessionBundle, SessionTimelineEntry } from '../types.js';
import { fmtClock, fmtDuration, truncate } from './_format.js';

export interface ErrorRecord {
    timestamp: number;
    event_id: string;
    event_type: string;
    trace_id?: string;
    parent_event_id?: string;
    /** Best-effort error message extracted from the payload. */
    message: string;
    /** Status field if present (success/error/fail). */
    status?: string;
    /** Source code that failed (execution events only). */
    code?: string;
    /** Brief agent reasoning (output.thoughts when present). */
    thoughts?: string;
    /** Duration of the failing operation, when measured. */
    duration_ms?: number;
    /** Function calls that ran before the failure (for execution events). */
    function_calls?: { name: string; args?: unknown; error?: string }[];
    /** Most recent user_input prior to this error. */
    preceding_user_input?: { text: string; event_id: string; timestamp: number };
}

export interface ErrorsResult {
    session_id: string;
    total: number;
    /** Errors grouped by their normalized signature (first 120 chars of message). */
    by_signature: Record<string, ErrorRecord[]>;
    /** Flat list, original order. */
    records: ErrorRecord[];
}

function isErrorEvent(e: SessionTimelineEntry): boolean {
    if (/error|fail/i.test(e.event_type)) return true;
    if (e.tags?.includes('error')) return true;
    const p = e.payload as Record<string, unknown> | undefined;
    const status = p?.status as string | undefined;
    if (status && /^(error|fail|failure)$/i.test(status)) return true;
    if (p?.error && p.error !== false && p.error !== null) return true;
    return false;
}

function extractMessage(e: SessionTimelineEntry): string {
    const p = e.payload as Record<string, unknown> | undefined;
    if (!p) return '(no payload)';
    if (typeof p.error === 'string') return p.error;
    if (typeof p.error_message === 'string') return p.error_message;
    if (typeof p.message === 'string') return p.message;
    const ctx = p.context as Record<string, unknown> | undefined;
    if (ctx) {
        const res = ctx.result as Record<string, unknown> | undefined;
        if (res && typeof res.error === 'string') return res.error;
        if (typeof ctx.error === 'string') return ctx.error;
    }
    return '(no message)';
}

function extractCodeAndThoughts(e: SessionTimelineEntry): { code?: string; thoughts?: string } {
    const ctx = e.payload?.context as Record<string, unknown> | undefined;
    if (!ctx) return {};
    const code = typeof ctx.code === 'string' ? ctx.code : undefined;
    const thoughts = typeof ctx.thoughts === 'string' ? ctx.thoughts : undefined;
    return { code, thoughts };
}

function extractFunctionCalls(e: SessionTimelineEntry): ErrorRecord['function_calls'] {
    const events = ((e.payload?.context as Record<string, unknown>)?.result as Record<string, unknown>)?.events;
    if (!Array.isArray(events)) return undefined;
    const calls: NonNullable<ErrorRecord['function_calls']> = [];
    for (const sub of events) {
        const s = sub as { type?: string; data?: { name?: string; args?: unknown; error?: string } };
        if (s.type === 'function_start' && s.data?.name) {
            calls.push({ name: s.data.name, args: s.data.args });
        } else if (s.type === 'function_error' && s.data?.name) {
            const last = calls[calls.length - 1];
            if (last && last.name === s.data.name) last.error = s.data.error;
            else calls.push({ name: s.data.name, error: s.data.error });
        }
    }
    return calls.length > 0 ? calls : undefined;
}

export function analyzeErrors(bundle: SessionBundle): ErrorsResult {
    const records: ErrorRecord[] = [];
    let lastUserInput: ErrorRecord['preceding_user_input'];

    for (const e of bundle.timeline) {
        if (e.event_type === 'user_input') {
            const text = (e.payload?.context as { content?: string } | undefined)?.content;
            if (typeof text === 'string') {
                lastUserInput = { text, event_id: e.event_id, timestamp: e.timestamp };
            }
            continue;
        }
        if (!isErrorEvent(e)) continue;
        const { code, thoughts } = extractCodeAndThoughts(e);
        records.push({
            timestamp: e.timestamp,
            event_id: e.event_id,
            event_type: e.event_type,
            trace_id: e.trace_id,
            parent_event_id: e.parent_event_id,
            status: (e.payload as Record<string, unknown> | undefined)?.status as string | undefined,
            message: extractMessage(e),
            code,
            thoughts,
            duration_ms: e.duration_ms,
            function_calls: extractFunctionCalls(e),
            preceding_user_input: lastUserInput,
        });
    }

    const by_signature: Record<string, ErrorRecord[]> = {};
    for (const r of records) {
        const sig = r.message.slice(0, 120);
        (by_signature[sig] ??= []).push(r);
    }

    return { session_id: bundle.session_id, total: records.length, by_signature, records };
}

export function formatErrors(result: ErrorsResult, opts: { markdown?: boolean } = {}): string {
    const out: string[] = [];
    const h1 = opts.markdown ? '# ' : '';
    const h2 = opts.markdown ? '## ' : '';

    out.push(`${h1}Errors — session ${result.session_id}`);
    out.push(`Total: ${result.total}`);
    out.push('');

    if (result.total === 0) {
        out.push('(no errors detected)');
        return out.join('\n');
    }

    // Group summary
    out.push(`${h2}By signature`);
    const sigs = Object.entries(result.by_signature).sort((a, b) => b[1].length - a[1].length);
    for (const [sig, list] of sigs) {
        out.push(`  ${list.length}× ${truncate(sig, 100)}`);
    }
    out.push('');

    // Detail list
    out.push(`${h2}Records`);
    for (let i = 0; i < result.records.length; i++) {
        const r = result.records[i];
        out.push(`--- [${i + 1}/${result.records.length}] ${r.event_type} @ ${fmtClock(r.timestamp)} ---`);
        out.push(`event_id : ${r.event_id}`);
        if (r.trace_id) out.push(`trace_id : ${r.trace_id}`);
        if (r.status) out.push(`status   : ${r.status}`);
        if (r.duration_ms !== undefined) out.push(`duration : ${fmtDuration(r.duration_ms)}`);
        out.push(`message  : ${r.message}`);
        if (r.thoughts) out.push(`thoughts : ${truncate(r.thoughts, 400)}`);
        if (r.preceding_user_input) {
            out.push(`prior user: "${truncate(r.preceding_user_input.text, 200)}"`);
        }
        if (r.function_calls && r.function_calls.length > 0) {
            out.push(`fn calls :`);
            for (const fc of r.function_calls) {
                const args = fc.args !== undefined ? truncate(fc.args, 160) : '';
                const err = fc.error ? ` → error: ${truncate(fc.error, 200)}` : '';
                out.push(`  - ${fc.name}(${args})${err}`);
            }
        }
        if (r.code) {
            out.push(`code:`);
            if (opts.markdown) {
                out.push('```js', r.code, '```');
            } else {
                out.push(r.code);
            }
        }
        out.push('');
    }
    return out.join('\n');
}
