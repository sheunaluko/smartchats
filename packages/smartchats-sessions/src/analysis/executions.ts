/**
 * executions — what code the agent ran, what tools it called, what came back.
 *
 * Each `execution` event in the cloud bundle has a rich payload:
 *   - context.code              the JS source the agent emitted
 *   - context.thoughts          the agent's reasoning
 *   - context.response          the agent's spoken response
 *   - context.result.events     fine-grained trace: property_access,
 *                               function_start (name + args), function_end
 *                               (duration + result), variable_set, etc.
 *   - duration_ms, status, function_calls, variables_assigned
 *
 * This module flattens that into a clean per-execution view + an aggregated
 * count of which functions were called (regardless of which execution).
 */

import type { SessionBundle, SessionTimelineEntry } from '../types.js';
import { fmtClock, fmtDuration, truncate } from './_format.js';

export interface FunctionCallRecord {
    name: string;
    args?: unknown;
    /** Function call duration (ms) when reported. */
    duration_ms?: number;
    result?: unknown;
    error?: string;
}

export interface ExecutionRecord {
    timestamp: number;
    event_id: string;
    trace_id?: string;
    status?: string;
    duration_ms?: number;
    code?: string;
    thoughts?: string;
    response?: string;
    function_calls: FunctionCallRecord[];
    variables_assigned?: number;
    /** Top-level error if the whole execution failed. */
    error?: string;
}

export interface ExecutionsResult {
    session_id: string;
    executions: ExecutionRecord[];
    /** name → number of times called across the session. */
    function_call_counts: Record<string, number>;
    /** name → array of error strings (only when calls errored). */
    function_call_errors: Record<string, string[]>;
}

interface RawSubEvent {
    type?: string;
    timestamp?: number;
    data?: { name?: string; args?: unknown; result?: unknown; error?: string; duration?: number; callId?: string };
}

function extractFunctionCalls(e: SessionTimelineEntry): FunctionCallRecord[] {
    const events = ((e.payload?.context as Record<string, unknown>)?.result as Record<string, unknown>)?.events;
    if (!Array.isArray(events)) return [];
    const calls: FunctionCallRecord[] = [];
    const byCallId = new Map<string, FunctionCallRecord>();
    for (const sub of events as RawSubEvent[]) {
        if (sub.type === 'function_start' && sub.data?.name) {
            const rec: FunctionCallRecord = { name: sub.data.name, args: sub.data.args };
            calls.push(rec);
            if (sub.data.callId) byCallId.set(sub.data.callId, rec);
        } else if (sub.type === 'function_end' && sub.data?.callId) {
            const rec = byCallId.get(sub.data.callId);
            if (rec) {
                rec.duration_ms = sub.data.duration;
                rec.result = sub.data.result;
            }
        } else if (sub.type === 'function_error' && sub.data?.callId) {
            const rec = byCallId.get(sub.data.callId);
            if (rec) rec.error = sub.data.error;
            else if (sub.data.name) calls.push({ name: sub.data.name, error: sub.data.error });
        }
    }
    return calls;
}

export function analyzeExecutions(bundle: SessionBundle): ExecutionsResult {
    const executions: ExecutionRecord[] = [];
    const counts: Record<string, number> = {};
    const errors: Record<string, string[]> = {};

    for (const e of bundle.timeline) {
        if (e.event_type !== 'execution') continue;
        const p = e.payload as Record<string, unknown>;
        const ctx = (p.context as Record<string, unknown>) ?? {};
        const fnCalls = extractFunctionCalls(e);
        const status = p.status as string | undefined;
        const topError = typeof p.error === 'string' ? p.error : undefined;
        executions.push({
            timestamp: e.timestamp,
            event_id: e.event_id,
            trace_id: e.trace_id,
            status,
            duration_ms: (p.duration_ms as number | undefined) ?? e.duration_ms,
            code: ctx.code as string | undefined,
            thoughts: ctx.thoughts as string | undefined,
            response: ctx.response as string | undefined,
            function_calls: fnCalls,
            variables_assigned: p.variables_assigned as number | undefined,
            error: topError,
        });
        for (const fc of fnCalls) {
            counts[fc.name] = (counts[fc.name] ?? 0) + 1;
            if (fc.error) (errors[fc.name] ??= []).push(fc.error);
        }
    }

    return {
        session_id: bundle.session_id,
        executions,
        function_call_counts: counts,
        function_call_errors: errors,
    };
}

export function formatExecutions(
    result: ExecutionsResult,
    opts: { markdown?: boolean; codeMaxChars?: number } = {},
): string {
    const out: string[] = [];
    const h1 = opts.markdown ? '# ' : '';
    const h2 = opts.markdown ? '## ' : '';
    const codeMax = opts.codeMaxChars ?? 2000;

    out.push(`${h1}Executions — session ${result.session_id}`);
    out.push(`Executions: ${result.executions.length}`);
    out.push('');

    out.push(`${h2}Function call summary`);
    const ranked = Object.entries(result.function_call_counts).sort((a, b) => b[1] - a[1]);
    if (ranked.length === 0) {
        out.push('  (no function calls observed)');
    } else {
        for (const [name, count] of ranked) {
            const errs = result.function_call_errors[name] ?? [];
            out.push(`  ${count}× ${name}${errs.length > 0 ? `  (${errs.length} errored)` : ''}`);
        }
    }
    out.push('');

    out.push(`${h2}Executions (in order)`);
    for (let i = 0; i < result.executions.length; i++) {
        const ex = result.executions[i];
        out.push(`--- [${i + 1}/${result.executions.length}] ${fmtClock(ex.timestamp)}  ${ex.status ?? ''}  ${fmtDuration(ex.duration_ms ?? null)}  ${ex.event_id} ---`);
        if (ex.thoughts) out.push(`thoughts: ${truncate(ex.thoughts, 400)}`);
        if (ex.response) out.push(`spoken  : ${truncate(ex.response, 300)}`);
        if (ex.function_calls.length > 0) {
            out.push(`fn calls:`);
            for (const fc of ex.function_calls) {
                const args = fc.args !== undefined ? truncate(fc.args, 160) : '';
                const dur = fc.duration_ms !== undefined ? `  (${fmtDuration(fc.duration_ms)})` : '';
                const err = fc.error ? `  ERROR: ${truncate(fc.error, 200)}` : '';
                const result = fc.result !== undefined && !fc.error ? `  → ${truncate(fc.result, 200)}` : '';
                out.push(`  - ${fc.name}(${args})${dur}${result}${err}`);
            }
        }
        if (ex.error) out.push(`error   : ${ex.error}`);
        if (ex.code) {
            const code = truncate(ex.code, codeMax);
            if (opts.markdown) out.push('```js', code, '```');
            else out.push('code:', code);
        }
        out.push('');
    }
    return out.join('\n');
}
