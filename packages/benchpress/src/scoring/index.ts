/**
 * Per-scenario scoring. Pure functions over (raw session export, scenario,
 * truth) → ScenarioResult. Zero LLM-as-judge — every check is deterministic.
 *
 * Two channels (see CLAUDE.md design notes):
 *   - correctness    : was the agent's `submit_answer` value right?
 *   - trace_metrics  : latency, tokens, $, tools called — derived from the
 *                      session bundle via `smartchats-sessions` analyzers.
 *
 * Optional `trace_assertions` fire only for scenarios that opt in (q09's
 * responsiveness directive, q11's accumulate_text no-duplication).
 */
import type { SessionBundle, SessionTimelineEntry } from 'smartchats-sessions';
import { rowsToTimeline, computeSummary, analyzePerformance, analyzeExecutions } from 'smartchats-sessions';
import { getModelInfo } from 'cortex';

import type { AnswerKind, SubmitAnswerPayload, TruthsSnapshot, ExpectedCall, ArgMatcher } from '../types.js';

// ──────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────

/** Shape of the raw JSON `cortexInsights.exportSession()` writes per simi run. */
export interface RawExportedSession {
  session_id: string;
  app_name?: string;
  tags?: string[];
  events: Array<Record<string, unknown>>;
}

export interface TraceMetrics {
  turn_count: number;             // # of execution events
  total_ms: number;               // session wall-clock
  llm_call_count: number;
  input_tokens: number;
  output_tokens: number;
  cached_input_tokens: number;
  cache_hit_rate: number;
  estimated_cost_usd: number;
  /** Tool name → invocation count across the session. */
  tools_called: Record<string, number>;
  /** Function calls that errored (anti-noise: bare `error` count). */
  tool_errors: number;
  /** Count of agent `response` events (mid-turn user updates). */
  user_response_count: number;
  /** User input → next LLM call latency, per turn. */
  user_to_agent_gaps_ms: number[];
}

export interface CorrectnessResult {
  passed: boolean;
  /** "matched" / "diverged" / "missing" / "wrong_kind". */
  detail: string;
}

export interface TraceAssertionResult {
  name: string;
  passed: boolean;
  reason: string;
}

export type ScenarioOutcome = 'submitted_correct' | 'submitted_wrong' | 'no_submission';

export interface ScenarioResult {
  scenario_id: string;
  /** Last LLM model observed in the session — usually constant across the scenario. */
  model: string | null;
  outcome: ScenarioOutcome;
  /**
   * Whatever shape the agent stored at workspace.bench_answer — could be a
   * bare primitive, the documented {value, kind, ...} wrapper, or a near-miss
   * shape. Scorer's lenient unwrapValue() handles all three.
   */
  bench_answer: unknown;
  expected: unknown;
  correctness: CorrectnessResult | null;
  trace_metrics: TraceMetrics;
  /** Scenario-specific deterministic checks (q09 progress, q11 accumulate_text). */
  trace_assertions: TraceAssertionResult[];
}

export interface ScoreOptions {
  /** Optional scenario expected-delta: e.g. q08 mutation adds 30 to truth. */
  expectedDelta?: unknown;
  /** Tolerance for scalar number equality (default 0.5). */
  numericTolerance?: number;
  /**
   * For tool_sequence scenarios — the ordered list of tool calls the agent
   * must make. Pass from scenario.expected_calls. When omitted on a
   * tool_sequence scenario, scoring degrades to "did any execution happen?"
   */
  expectedCalls?: ExpectedCall[];
}

// ──────────────────────────────────────────────────────────────────────────
// Adapter: raw export → SessionBundle the analyzers consume
// ──────────────────────────────────────────────────────────────────────────

export function parseExportedSession(raw: RawExportedSession): SessionBundle {
  const timeline = rowsToTimeline(raw.events as unknown as Parameters<typeof rowsToTimeline>[0]);
  const summary = computeSummary(timeline);
  const start = timeline.length > 0 ? timeline[0]!.timestamp : 0;
  const end = timeline.length > 0 ? timeline[timeline.length - 1]!.timestamp : 0;
  return {
    session_id: raw.session_id,
    metadata: {
      app_name: raw.app_name ?? 'smartchats',
      user_id: '',
      session_tags: raw.tags ?? [],
      start_time: new Date(start).toISOString(),
      end_time: new Date(end).toISOString(),
      duration_ms: end - start,
      event_count: timeline.length,
      export_timestamp: new Date().toISOString(),
      exporter_version: '1.0.0',
    },
    summary,
    timeline,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Main entry
// ──────────────────────────────────────────────────────────────────────────

export function scoreScenario(
  raw: RawExportedSession,
  scenarioId: string,
  truths: TruthsSnapshot,
  opts: ScoreOptions = {},
): ScenarioResult {
  const truthEntry = truths.scenarios[scenarioId];
  if (!truthEntry) {
    throw new Error(`unknown scenario_id: ${scenarioId}`);
  }
  const expected = applyDelta(truthEntry.truth, opts.expectedDelta);

  const bundle = parseExportedSession(raw);
  const bench_answer = extractBenchAnswer(bundle.timeline);
  const trace_metrics = buildTraceMetrics(bundle);
  const model = trace_metrics_lastModel(bundle.timeline);

  let outcome: ScenarioOutcome;
  let correctness: CorrectnessResult | null;

  if (truthEntry.kind === 'tool_sequence') {
    // Tool-sequence scenarios are scored entirely off the function-call
    // trace — bench_answer doesn't participate.
    correctness = scoreToolSequence(bundle, opts.expectedCalls ?? []);
    outcome = correctness.passed ? 'submitted_correct' : 'submitted_wrong';
  } else if (bench_answer === null) {
    outcome = 'no_submission';
    correctness = null;
  } else {
    correctness = compareAnswer(bench_answer, truthEntry.kind, expected, opts.numericTolerance ?? 0.5);
    outcome = correctness.passed ? 'submitted_correct' : 'submitted_wrong';
  }

  const trace_assertions: TraceAssertionResult[] = [];
  if (scenarioId === 'q09_busiest_workout_week') {
    trace_assertions.push(checkProgressUpdates(bundle));
  } else if (scenarioId === 'q11_accumulate_text_no_dup') {
    trace_assertions.push(checkAccumulateTextNoDup(bundle));
  }

  return {
    scenario_id: scenarioId,
    model,
    outcome,
    bench_answer,
    expected,
    correctness,
    trace_metrics,
    trace_assertions,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Tool-sequence scoring — walks function_calls, asserts ordered match
// ──────────────────────────────────────────────────────────────────────────

/**
 * Walk every execution's function_calls in order, attempt to match each
 * ExpectedCall in turn. Subsequent calls may appear interleaved between
 * matched ones — the assertion is "every expected call happened, IN ORDER,
 * with args matching." Returns the first call that fails to match (or
 * "all matched" on success).
 */
function scoreToolSequence(
  bundle: SessionBundle,
  expectedCalls: ExpectedCall[],
): CorrectnessResult {
  if (expectedCalls.length === 0) {
    return { passed: false, detail: 'no expected_calls provided in ScoreOptions' };
  }

  // Flatten every function_call across every execution event, in order.
  const exec = analyzeExecutions(bundle);
  const allCalls: Array<{ name: string; args: unknown }> = [];
  for (const e of exec.executions) {
    for (const fc of e.function_calls) {
      allCalls.push({ name: fc.name, args: fc.args });
    }
  }

  let cursor = 0;
  for (let i = 0; i < expectedCalls.length; i++) {
    const expected = expectedCalls[i]!;
    let matched = -1;

    // Find the next call from cursor onward whose name matches AND args pass.
    for (let j = cursor; j < allCalls.length; j++) {
      if (allCalls[j]!.name !== expected.tool) continue;
      if (!matchArgs(allCalls[j]!.args, expected.args)) continue;
      matched = j;
      break;
    }

    if (matched === -1) {
      const seenNames = allCalls.slice(cursor).map((c) => c.name).join(',') || '(none)';
      return {
        passed: false,
        detail: `expected call #${i + 1} (${expected.tool}) not found after cursor ${cursor}. ` +
          `Remaining calls seen: [${seenNames}]`,
      };
    }
    cursor = matched + 1;
  }

  return {
    passed: true,
    detail: `matched all ${expectedCalls.length} expected calls in order across ${allCalls.length} total calls`,
  };
}

/**
 * Apply ArgMatchers to a call's args object. If `matchers` is missing the
 * call passes name-match alone. For each declared matcher, the corresponding
 * arg must satisfy it. Args not mentioned in `matchers` are ignored.
 */
function matchArgs(rawArgs: unknown, matchers: Record<string, ArgMatcher> | undefined): boolean {
  if (!matchers || Object.keys(matchers).length === 0) return true;
  if (!rawArgs || typeof rawArgs !== 'object') return false;
  // function_start events carry args as a wrapping array: `[{user_instructions, ...}]`.
  // analyzeExecutions stores that array verbatim. Unwrap if we got an array of one
  // object so the lookup-by-key path works for normal positional-object signatures.
  const unwrapped = Array.isArray(rawArgs) && rawArgs.length === 1 && rawArgs[0] && typeof rawArgs[0] === 'object'
    ? rawArgs[0]
    : rawArgs;
  if (!unwrapped || typeof unwrapped !== 'object') return false;
  const args = unwrapped as Record<string, unknown>;
  for (const [argName, matcher] of Object.entries(matchers)) {
    const value = args[argName];
    if (!matchOne(value, matcher)) return false;
  }
  return true;
}

function matchOne(value: unknown, matcher: ArgMatcher): boolean {
  if ('equals' in matcher) return deepEqual(value, matcher.equals);
  if ('matches' in matcher) {
    if (typeof value !== 'string') return false;
    return new RegExp(matcher.matches, 'i').test(value);
  }
  if ('includes' in matcher) {
    if (typeof value === 'string' && typeof matcher.includes === 'string') {
      return value.toLowerCase().includes(matcher.includes.toLowerCase());
    }
    if (Array.isArray(value)) return value.includes(matcher.includes);
    return false;
  }
  if ('predicate' in matcher) {
    try { return matcher.predicate(value); } catch { return false; }
  }
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ak = Object.keys(a as object); const bk = Object.keys(b as object);
  if (ak.length !== bk.length) return false;
  for (const k of ak) if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  return true;
}

// ──────────────────────────────────────────────────────────────────────────
// bench_answer extraction
// ──────────────────────────────────────────────────────────────────────────

/**
 * Walk the timeline for `action` events whose first arg sets `bench_answer`.
 * createInsightStore auto-instruments dispatches; updateWorkspace's arg is the
 * patch object, so we look for `payload.args[0].bench_answer` and take the latest.
 *
 * Returns whatever shape the agent wrote — could be a bare primitive
 * (`workspace.bench_answer = 158.4`), a wrapper (`{value: 158.4, kind: 'scalar'}`),
 * or anything else. Scorer handles the leniency.
 */
function extractBenchAnswer(timeline: SessionTimelineEntry[]): unknown {
  let latest: unknown = null;
  for (const e of timeline) {
    if (e.event_type !== 'action') continue;
    const args = (e.payload as { args?: unknown[] }).args;
    if (!Array.isArray(args)) continue;
    for (const a of args) {
      if (a && typeof a === 'object' && 'bench_answer' in a) {
        const v = (a as { bench_answer: unknown }).bench_answer;
        if (v !== null && v !== undefined) latest = v;
      }
    }
  }
  return latest;
}

function trace_metrics_lastModel(timeline: SessionTimelineEntry[]): string | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const e = timeline[i]!;
    if (e.event_type === 'llm_invocation') {
      const m = (e.payload as { model?: string }).model;
      if (typeof m === 'string') return m;
    }
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Correctness — per-kind comparison
// ──────────────────────────────────────────────────────────────────────────

function applyDelta(truth: unknown, delta: unknown): unknown {
  if (delta === undefined) return truth;
  if (typeof truth === 'number' && typeof delta === 'number') return truth + delta;
  // For composite truths we'd need scenario-specific delta application;
  // v1 only uses delta for scalar (q08).
  return truth;
}

/**
 * Lenient extractor: peel a "value" out of whatever the agent stored at
 * workspace.bench_answer. The agent might:
 *   - set a bare primitive: workspace.bench_answer = 158.4
 *   - set the documented wrapper: { value: 158.4, kind: 'scalar' }
 *   - set a near-miss wrapper: { answer: 158.4 } or { val: 158.4 }
 *
 * We accept all three for the value field. The wrapper's `kind` is only
 * required for `negative` scenarios (anti-hallucination check).
 */
function unwrapValue(submitted: unknown): unknown {
  if (submitted === null || submitted === undefined) return null;
  if (typeof submitted !== 'object') return submitted;       // bare primitive
  const obj = submitted as Record<string, unknown>;
  if ('value' in obj) return obj.value;                       // documented shape
  if ('answer' in obj) return obj.answer;                     // common near-miss
  if ('val' in obj) return obj.val;                           // shorter near-miss
  return submitted;  // unknown shape; let the per-kind comparator decide
}

function compareAnswer(
  submitted: unknown,
  expectedKind: AnswerKind,
  expected: unknown,
  tolerance: number,
): CorrectnessResult {
  const got = unwrapValue(submitted);

  switch (expectedKind) {
    case 'scalar':
      return scalarCompare(got, expected, tolerance);
    case 'date':
      return dateCompare(got, expected);
    case 'list':
      return listCompare(got, expected);
    case 'comparison':
      return objectCompare(got, expected, ['winner']);
    case 'negative': {
      // Anti-hallucination check: require BOTH (a) the value resolves to null
      // AND (b) some indication the agent meant it (explicit kind=negative OR
      // a reason field). Just-null could be the agent forgetting to answer.
      const valueIsNull = got === null || got === undefined;
      const wrapper = (submitted && typeof submitted === 'object') ? (submitted as Record<string, unknown>) : null;
      const kindNeg = wrapper?.kind === 'negative';
      const hasReason = typeof wrapper?.reason === 'string' && wrapper.reason.length > 0;
      const passed = valueIsNull && (kindNeg || hasReason);
      return {
        passed,
        detail: passed ? 'matched'
          : valueIsNull ? 'null_without_intent (no kind=negative or reason)'
          : `expected null, got ${JSON.stringify(got).slice(0, 80)}`,
      };
    }
    case 'composite':
      return { passed: got !== null && got !== undefined, detail: 'shape_only' };
    case 'tool_sequence':
      // Tool-sequence scoring doesn't use bench_answer at all — scoreScenario
      // routes to scoreToolSequence() before reaching compareAnswer. This
      // case is here only so the switch is exhaustive at the type level.
      return { passed: false, detail: 'tool_sequence should be scored via scoreToolSequence (not compareAnswer)' };
  }
}

function dateCompare(got: unknown, expected: unknown): CorrectnessResult {
  // Accept exact 'YYYY-MM-DD' OR a string containing it OR a Date-ish object.
  if (typeof got === 'string' && typeof expected === 'string') {
    if (got === expected) return { passed: true, detail: 'matched' };
    if (got.includes(expected)) return { passed: true, detail: 'matched (substring)' };
    return { passed: false, detail: `diverged: ${got} vs ${expected}` };
  }
  return { passed: got === expected, detail: got === expected ? 'matched' : `wrong_type: ${typeof got}` };
}

function scalarCompare(got: unknown, expected: unknown, tolerance: number): CorrectnessResult {
  if (typeof got === 'number' && typeof expected === 'number') {
    const ok = Math.abs(got - expected) <= tolerance;
    return { passed: ok, detail: ok ? 'matched' : `diverged: ${got} vs ${expected} (tol=${tolerance})` };
  }
  const ok = got === expected;
  return { passed: ok, detail: ok ? 'matched' : `diverged: ${JSON.stringify(got)} vs ${JSON.stringify(expected)}` };
}

function listCompare(got: unknown, expected: unknown): CorrectnessResult {
  if (!Array.isArray(got) || !Array.isArray(expected)) {
    return { passed: false, detail: `wrong_type: expected list, got ${typeof got}` };
  }
  const a = [...got].sort();
  const b = [...expected].sort();
  if (a.length !== b.length) return { passed: false, detail: `length_diverged: ${a.length} vs ${b.length}` };
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return { passed: false, detail: `member_diverged: ${JSON.stringify(a)} vs ${JSON.stringify(b)}` };
  }
  return { passed: true, detail: 'matched' };
}

function objectCompare(got: unknown, expected: unknown, keys: string[]): CorrectnessResult {
  if (!got || typeof got !== 'object' || !expected || typeof expected !== 'object') {
    return { passed: false, detail: 'wrong_type' };
  }
  const g = got as Record<string, unknown>;
  const e = expected as Record<string, unknown>;
  for (const k of keys) {
    if (g[k] !== e[k]) return { passed: false, detail: `key_diverged: ${k}: ${g[k]} vs ${e[k]}` };
  }
  return { passed: true, detail: 'matched' };
}

// ──────────────────────────────────────────────────────────────────────────
// Trace metrics — composes the smartchats-sessions analyzers
// ──────────────────────────────────────────────────────────────────────────

function buildTraceMetrics(bundle: SessionBundle): TraceMetrics {
  const perf = analyzePerformance(bundle);
  const exec = analyzeExecutions(bundle);

  const cost = estimateCost(perf);

  const userResponseCount = bundle.timeline.filter((e) => e.event_type === 'addAiMessage').length;

  return {
    turn_count: perf.executions.calls.length,
    total_ms: bundle.metadata.duration_ms,
    llm_call_count: perf.llm.calls.length,
    input_tokens: perf.llm.total_prompt_tokens,
    output_tokens: perf.llm.total_completion_tokens,
    cached_input_tokens: perf.llm.total_cached_input_tokens,
    cache_hit_rate: perf.llm.cache_hit_rate,
    estimated_cost_usd: cost,
    tools_called: exec.function_call_counts,
    tool_errors: Object.values(exec.function_call_errors).reduce((s, arr) => s + arr.length, 0),
    user_response_count: userResponseCount,
    user_to_agent_gaps_ms: perf.user_to_agent_gaps_ms,
  };
}

/**
 * Sum LLM cost across all calls using the model registry's per-token prices.
 * Tokens already exclude cached input from prompt_tokens? — Anthropic returns
 * total prompt including cached; OpenAI separates. We treat
 * `cached_input_tokens` as a separate (cheaper) bucket and bill the remainder
 * at the standard input rate. Good enough for relative-cost comparison.
 */
function estimateCost(perf: ReturnType<typeof analyzePerformance>): number {
  let usd = 0;
  for (const c of perf.llm.calls) {
    if (!c.model) continue;
    const info = getModelInfo(c.model);
    if (!info) continue;
    const cached = c.cached_input_tokens ?? 0;
    const inputBilled = Math.max(0, (c.prompt_tokens ?? 0) - cached);
    const inputPrice = info.inputPricePer1M ?? 0;
    const cachedPrice = info.cachedInputPricePer1M ?? inputPrice / 10;  // typical 10× discount
    const outputPrice = info.outputPricePer1M ?? 0;
    usd += (inputBilled * inputPrice) / 1_000_000;
    usd += (cached * cachedPrice) / 1_000_000;
    usd += ((c.completion_tokens ?? 0) * outputPrice) / 1_000_000;
  }
  return Math.round(usd * 100_000) / 100_000;  // 5 decimals = sub-cent precision
}

// ──────────────────────────────────────────────────────────────────────────
// Trace assertions — scenario-specific deterministic checks
// ──────────────────────────────────────────────────────────────────────────

/**
 * q09: responsiveness directive. If a turn took > 5s of code execution, the
 * agent should have emitted at least one brief `response` (mid-turn update)
 * AND it should be ≤6 words. Walks `execution` events.
 *
 * For each execution event with duration_ms > 5000, look for any `response`
 * field in its context (or addAiMessage emitted during it) and check the
 * word count. Pass = directive observed OR no slow execution happened.
 */
function checkProgressUpdates(bundle: SessionBundle): TraceAssertionResult {
  const slowExecs = bundle.timeline.filter((e) => {
    if (e.event_type !== 'execution') return false;
    const dur = (e.payload as { duration_ms?: number }).duration_ms ?? e.duration_ms ?? 0;
    return dur > 5000;
  });
  if (slowExecs.length === 0) {
    return { name: 'q09_progress_update', passed: true, reason: 'no_slow_exec; directive not triggered' };
  }
  // Look for a 'response' field on the slow executions' context.
  let observed = 0;
  let overlong = 0;
  for (const e of slowExecs) {
    const ctx = (e.payload as { context?: { response?: string } }).context;
    const resp = ctx?.response;
    if (typeof resp !== 'string' || resp.trim().length === 0) continue;
    observed++;
    const words = resp.trim().split(/\s+/).filter(Boolean).length;
    if (words > 6) overlong++;
  }
  if (observed === 0) {
    return { name: 'q09_progress_update', passed: false, reason: 'slow_exec without progress update' };
  }
  if (overlong > 0) {
    return { name: 'q09_progress_update', passed: false, reason: `${overlong} update(s) exceeded 6 words` };
  }
  return { name: 'q09_progress_update', passed: true, reason: `${observed} brief update(s) observed` };
}

/**
 * q11: when the agent calls `accumulate_text`, the word "finished" must NOT
 * appear in BOTH the spoken `response` AND the `user_instructions` arg of
 * that same execution. Saying it in both means the agent told the user
 * "say finished when done" twice — the regression we explicitly test for.
 */
function checkAccumulateTextNoDup(bundle: SessionBundle): TraceAssertionResult {
  const finished = /\bfinished\b/i;
  for (const e of bundle.timeline) {
    if (e.event_type !== 'execution') continue;
    const ctx = (e.payload as { context?: { response?: string; result?: { events?: Array<Record<string, unknown>> } } }).context;
    if (!ctx) continue;
    const subEvents = (ctx.result?.events ?? []) as Array<Record<string, unknown>>;
    const accCall = subEvents.find(
      (s) => s.type === 'function_start' && (s.data as { name?: string } | undefined)?.name === 'accumulate_text',
    );
    if (!accCall) continue;
    const args = (accCall.data as { args?: { user_instructions?: string } } | undefined)?.args;
    const userInstructions = args?.user_instructions ?? '';
    const prose = ctx.response ?? '';
    const proseHasFinished = finished.test(prose);
    const argHasFinished = finished.test(userInstructions);
    if (proseHasFinished && argHasFinished) {
      return {
        name: 'q11_accumulate_text_no_dup',
        passed: false,
        reason: '"finished" appears in BOTH spoken response AND user_instructions arg',
      };
    }
    return { name: 'q11_accumulate_text_no_dup', passed: true, reason: 'no duplication' };
  }
  return { name: 'q11_accumulate_text_no_dup', passed: false, reason: 'accumulate_text was never called' };
}
