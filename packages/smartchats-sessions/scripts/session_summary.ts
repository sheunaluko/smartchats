#!/usr/bin/env -S npx tsx
/**
 * CLI: high-level summary of a session bundle.
 *
 * Combines:
 *   - bundle metadata (timing, event_count, app, tags)
 *   - bundle.summary (the lightweight snapshot the exporter wrote)
 *   - performance histogram tops
 *   - error count + top error signatures
 *   - tool call counts
 *
 * Use this first when you pick up a fresh session — pick the next deeper
 * tool based on what surfaces here.
 *
 * Usage:
 *   npm run analyze:summary -- <bundle.json> [--markdown]
 */

import { analyzePerformance } from '../src/analysis/performance.js';
import { analyzeErrors } from '../src/analysis/errors.js';
import { analyzeExecutions } from '../src/analysis/executions.js';
import { fmtDuration, percentile } from '../src/analysis/_format.js';
import { loadBundle, parseArgs, requirePath } from './_cli_lib.js';

const USAGE = `Usage: session_summary <bundle.json> [--markdown]`;

const args = parseArgs(process.argv);
const path = requirePath(args, USAGE);
const bundle = loadBundle(path);
const md = args.flags.has('--markdown') || args.flags.has('--md');
const h1 = md ? '# ' : '';
const h2 = md ? '## ' : '';

const perf = analyzePerformance(bundle);
const errs = analyzeErrors(bundle);
const execs = analyzeExecutions(bundle);

const out: string[] = [];
out.push(`${h1}Session ${bundle.session_id}`);
out.push(`App         : ${bundle.metadata.app_name}`);
out.push(`Tags        : ${bundle.metadata.session_tags.join(', ') || '(none)'}`);
out.push(`Window      : ${bundle.metadata.start_time} → ${bundle.metadata.end_time}`);
out.push(`Duration    : ${fmtDuration(bundle.metadata.duration_ms)}`);
out.push(`Events      : ${bundle.metadata.event_count}`);
out.push('');

out.push(`${h2}Event type breakdown`);
const types = Object.entries(bundle.summary.event_types).sort((a, b) => b[1] - a[1]);
for (const [t, n] of types) out.push(`  ${n.toString().padStart(4)} ${t}`);
out.push('');

out.push(`${h2}LLM`);
out.push(`Calls       : ${perf.llm.calls.length}`);
out.push(`Latency     : p50=${fmtDuration(perf.llm.latency.p50)}  p95=${fmtDuration(perf.llm.latency.p95)}  max=${fmtDuration(perf.llm.latency.max)}`);
out.push(`TTFC        : p50=${fmtDuration(perf.llm.time_to_first_chunk.p50)}  p95=${fmtDuration(perf.llm.time_to_first_chunk.p95)}`);
out.push(`Tokens      : prompt=${perf.llm.total_prompt_tokens}  completion=${perf.llm.total_completion_tokens}  cached=${perf.llm.total_cached_input_tokens}  hit=${(perf.llm.cache_hit_rate * 100).toFixed(0)}%`);
out.push('');

out.push(`${h2}Code executions`);
out.push(`Total       : ${execs.executions.length}`);
out.push(`Slow        : ${perf.executions.slow_count}`);
out.push(`Duration    : p50=${fmtDuration(perf.executions.latency.p50)}  p95=${fmtDuration(perf.executions.latency.p95)}  max=${fmtDuration(perf.executions.latency.max)}`);
out.push('');

out.push(`${h2}Tool calls (top)`);
const ranked = Object.entries(execs.function_call_counts).sort((a, b) => b[1] - a[1]).slice(0, 10);
if (ranked.length === 0) out.push('  (no tool calls observed)');
else for (const [name, n] of ranked) out.push(`  ${n.toString().padStart(3)}× ${name}`);
out.push('');

out.push(`${h2}Errors`);
out.push(`Total       : ${errs.total}`);
if (errs.total > 0) {
    const top = Object.entries(errs.by_signature).sort((a, b) => b[1].length - a[1].length).slice(0, 5);
    for (const [sig, list] of top) {
        const truncated = sig.length > 100 ? sig.slice(0, 100) + '…' : sig;
        out.push(`  ${list.length}× ${truncated}`);
    }
}
out.push('');

out.push(`${h2}Voice`);
out.push(`Turns       : ${perf.voice.calls.length}`);
out.push(`End-to-end  : p50=${fmtDuration(perf.voice.end_to_end.p50)}  p95=${fmtDuration(perf.voice.end_to_end.p95)}`);
out.push('');

if (perf.user_to_agent_gaps_ms.length > 0) {
    out.push(`${h2}Pacing`);
    out.push(`User→Agent  : p50=${fmtDuration(percentile(perf.user_to_agent_gaps_ms, 50))}  p95=${fmtDuration(percentile(perf.user_to_agent_gaps_ms, 95))}  max=${fmtDuration(Math.max(...perf.user_to_agent_gaps_ms))}`);
}

process.stdout.write(out.join('\n') + '\n');
