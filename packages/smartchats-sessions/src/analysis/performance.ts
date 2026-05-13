/**
 * performance — latency / pacing analysis for a session.
 *
 * Captures, per call:
 *   • LLM round-trip + time-to-first-chunk
 *   • Code execution duration
 *   • Voice pipeline durations from voice_interaction_complete
 *
 * Aggregate stats:
 *   • p50/p95/p99 LLM latency, code-execution latency
 *   • Cache hit rate (cached_input_tokens / prompt_tokens)
 *   • Tokens per provider/model
 *   • "Slow" events (tagged by the system or > 10s)
 *   • User→Agent response gap (transcription_received → first_tts_utterance)
 */

import type { SessionBundle, SessionTimelineEntry } from '../types.js';
import { fmtClock, fmtDuration, percentile, sum, truncate } from './_format.js';

export interface LlmCallStat {
    event_id: string;
    timestamp: number;
    model?: string;
    provider?: string;
    prompt_tokens?: number;
    completion_tokens?: number;
    cached_input_tokens?: number;
    latency_ms?: number;
    time_to_first_chunk_ms?: number;
    status?: string;
}

export interface ExecutionStat {
    event_id: string;
    timestamp: number;
    duration_ms?: number;
    status?: string;
    function_calls?: number;
    slow: boolean;
}

export interface VoicePipelineStat {
    event_id: string;
    timestamp: number;
    end_to_end_ms?: number;
    llm_round_trip_ms?: number;
    transcription_to_llm_start_ms?: number;
    tts_total_duration_ms?: number;
}

export interface LatencyHistogram {
    n: number;
    min: number | null;
    p50: number | null;
    p95: number | null;
    p99: number | null;
    max: number | null;
    mean: number | null;
}

export interface PerformanceResult {
    session_id: string;
    duration_ms: number;
    llm: {
        calls: LlmCallStat[];
        by_model: Record<string, LatencyHistogram & { total_tokens: number }>;
        latency: LatencyHistogram;
        time_to_first_chunk: LatencyHistogram;
        total_prompt_tokens: number;
        total_completion_tokens: number;
        total_cached_input_tokens: number;
        cache_hit_rate: number;
    };
    executions: {
        calls: ExecutionStat[];
        latency: LatencyHistogram;
        slow_count: number;
    };
    voice: {
        calls: VoicePipelineStat[];
        end_to_end: LatencyHistogram;
    };
    /** Conversation pacing: user_input → next agent response (in ms). */
    user_to_agent_gaps_ms: number[];
}

function buildHistogram(values: number[]): LatencyHistogram {
    const v = values.filter((x) => typeof x === 'number' && !isNaN(x));
    if (v.length === 0) {
        return { n: 0, min: null, p50: null, p95: null, p99: null, max: null, mean: null };
    }
    return {
        n: v.length,
        min: Math.min(...v),
        p50: percentile(v, 50),
        p95: percentile(v, 95),
        p99: percentile(v, 99),
        max: Math.max(...v),
        mean: sum(v) / v.length,
    };
}

export function analyzePerformance(bundle: SessionBundle): PerformanceResult {
    const llmCalls: LlmCallStat[] = [];
    const execCalls: ExecutionStat[] = [];
    const voiceCalls: VoicePipelineStat[] = [];
    const gaps: number[] = [];
    let pendingUserInput: SessionTimelineEntry | null = null;

    for (const e of bundle.timeline) {
        if (e.event_type === 'user_input') {
            pendingUserInput = e;
        } else if (e.event_type === 'llm_invocation') {
            const p = e.payload as Record<string, unknown>;
            const ctx = (p.context as Record<string, unknown>) ?? {};
            const timing = (ctx.timing as Record<string, unknown>) ?? {};
            llmCalls.push({
                event_id: e.event_id,
                timestamp: e.timestamp,
                model: p.model as string | undefined,
                provider: p.provider as string | undefined,
                prompt_tokens: p.prompt_tokens as number | undefined,
                completion_tokens: p.completion_tokens as number | undefined,
                cached_input_tokens: ctx.cached_input_tokens as number | undefined,
                latency_ms: p.latency_ms as number | undefined,
                time_to_first_chunk_ms: timing.time_to_first_chunk_ms as number | undefined,
                status: p.status as string | undefined,
            });
            if (pendingUserInput) {
                gaps.push(e.timestamp - pendingUserInput.timestamp);
                pendingUserInput = null;
            }
        } else if (e.event_type === 'execution') {
            const p = e.payload as Record<string, unknown>;
            execCalls.push({
                event_id: e.event_id,
                timestamp: e.timestamp,
                duration_ms: (p.duration_ms as number | undefined) ?? e.duration_ms,
                status: p.status as string | undefined,
                function_calls: p.function_calls as number | undefined,
                slow: !!e.tags?.includes('slow'),
            });
        } else if (e.event_type === 'voice_interaction_complete') {
            const p = e.payload as Record<string, unknown>;
            const d = (p.durations as Record<string, unknown>) ?? {};
            voiceCalls.push({
                event_id: e.event_id,
                timestamp: e.timestamp,
                end_to_end_ms: d.end_to_end as number | undefined,
                llm_round_trip_ms: d.llm_round_trip as number | undefined,
                transcription_to_llm_start_ms: d.transcription_to_llm_start as number | undefined,
                tts_total_duration_ms: d.tts_total_duration as number | undefined,
            });
        }
    }

    const total_prompt_tokens = sum(llmCalls.map((c) => c.prompt_tokens ?? 0));
    const total_completion_tokens = sum(llmCalls.map((c) => c.completion_tokens ?? 0));
    const total_cached_input_tokens = sum(llmCalls.map((c) => c.cached_input_tokens ?? 0));
    const cache_hit_rate = total_prompt_tokens > 0 ? total_cached_input_tokens / total_prompt_tokens : 0;

    const by_model: PerformanceResult['llm']['by_model'] = {};
    for (const c of llmCalls) {
        const key = c.model ?? '(unknown)';
        const slot = (by_model[key] ??= { ...buildHistogram([]), total_tokens: 0 });
        if (c.latency_ms !== undefined) slot.n++;
        slot.total_tokens += (c.prompt_tokens ?? 0) + (c.completion_tokens ?? 0);
    }
    // Recompute the histogram per model now that we know membership.
    for (const model of Object.keys(by_model)) {
        const latencies = llmCalls
            .filter((c) => (c.model ?? '(unknown)') === model && c.latency_ms !== undefined)
            .map((c) => c.latency_ms!);
        const tokens = by_model[model].total_tokens;
        by_model[model] = { ...buildHistogram(latencies), total_tokens: tokens };
    }

    return {
        session_id: bundle.session_id,
        duration_ms: bundle.metadata.duration_ms,
        llm: {
            calls: llmCalls,
            by_model,
            latency: buildHistogram(llmCalls.map((c) => c.latency_ms).filter((x): x is number => x !== undefined)),
            time_to_first_chunk: buildHistogram(
                llmCalls.map((c) => c.time_to_first_chunk_ms).filter((x): x is number => x !== undefined),
            ),
            total_prompt_tokens,
            total_completion_tokens,
            total_cached_input_tokens,
            cache_hit_rate,
        },
        executions: {
            calls: execCalls,
            latency: buildHistogram(
                execCalls.map((c) => c.duration_ms).filter((x): x is number => x !== undefined),
            ),
            slow_count: execCalls.filter((c) => c.slow).length,
        },
        voice: {
            calls: voiceCalls,
            end_to_end: buildHistogram(
                voiceCalls.map((c) => c.end_to_end_ms).filter((x): x is number => x !== undefined),
            ),
        },
        user_to_agent_gaps_ms: gaps,
    };
}

function fmtHist(h: LatencyHistogram): string {
    if (h.n === 0) return '(no samples)';
    const f = fmtDuration;
    return `n=${h.n}  min=${f(h.min)}  p50=${f(h.p50)}  p95=${f(h.p95)}  p99=${f(h.p99)}  max=${f(h.max)}  mean=${f(h.mean)}`;
}

export function formatPerformance(
    r: PerformanceResult,
    opts: { markdown?: boolean } = {},
): string {
    const out: string[] = [];
    const h1 = opts.markdown ? '# ' : '';
    const h2 = opts.markdown ? '## ' : '';

    out.push(`${h1}Performance — session ${r.session_id}`);
    out.push(`Wall duration: ${fmtDuration(r.duration_ms)}`);
    out.push('');

    out.push(`${h2}LLM`);
    out.push(`Calls               : ${r.llm.calls.length}`);
    out.push(`Latency (ms)        : ${fmtHist(r.llm.latency)}`);
    out.push(`Time-to-first-chunk : ${fmtHist(r.llm.time_to_first_chunk)}`);
    out.push(`Tokens              : prompt=${r.llm.total_prompt_tokens}  completion=${r.llm.total_completion_tokens}  cached=${r.llm.total_cached_input_tokens}`);
    out.push(`Cache hit rate      : ${(r.llm.cache_hit_rate * 100).toFixed(1)}%`);
    out.push('');

    if (Object.keys(r.llm.by_model).length > 0) {
        out.push(`${h2}By model`);
        for (const [model, h] of Object.entries(r.llm.by_model)) {
            out.push(`${model}`);
            out.push(`  latency : ${fmtHist(h)}`);
            out.push(`  tokens  : ${h.total_tokens}`);
        }
        out.push('');
    }

    out.push(`${h2}Code executions`);
    out.push(`Count               : ${r.executions.calls.length}`);
    out.push(`Slow-tagged         : ${r.executions.slow_count}`);
    out.push(`Duration (ms)       : ${fmtHist(r.executions.latency)}`);
    out.push('');

    if (r.voice.calls.length > 0) {
        out.push(`${h2}Voice pipeline`);
        out.push(`Voice turns         : ${r.voice.calls.length}`);
        out.push(`End-to-end          : ${fmtHist(r.voice.end_to_end)}`);
        out.push('');
    }

    if (r.user_to_agent_gaps_ms.length > 0) {
        out.push(`${h2}User → Agent gaps`);
        out.push(`Samples             : ${r.user_to_agent_gaps_ms.length}`);
        out.push(`Histogram           : ${fmtHist(buildHistogram(r.user_to_agent_gaps_ms))}`);
        out.push('');
    }

    out.push(`${h2}Per-call detail`);
    out.push('LLM:');
    for (const c of r.llm.calls) {
        out.push(
            `  ${fmtClock(c.timestamp)}  ${c.model ?? '(unknown)'} ${c.status ?? ''}` +
            `  latency=${fmtDuration(c.latency_ms ?? null)}  ttfc=${fmtDuration(c.time_to_first_chunk_ms ?? null)}` +
            `  tokens=${c.prompt_tokens ?? 0}+${c.completion_tokens ?? 0}  cached=${c.cached_input_tokens ?? 0}`,
        );
    }
    out.push('Executions:');
    for (const c of r.executions.calls) {
        out.push(
            `  ${fmtClock(c.timestamp)}  ${c.status ?? ''}` +
            `  duration=${fmtDuration(c.duration_ms ?? null)}  fn_calls=${c.function_calls ?? 0}` +
            (c.slow ? '  [slow]' : ''),
        );
    }

    return out.join('\n');
}
