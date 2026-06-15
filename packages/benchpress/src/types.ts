/**
 * Core types shared across the benchpress generator, scenarios, and scoring.
 *
 * Part 1 (dataset + verification) consumes BenchScenario + EventTimeFields.
 * Part 2 (harness + scoring) will add ScenarioResult, TraceMetrics,
 * TraceAssertionResult — left out until then to avoid pre-committing shapes
 * we'll discover while wiring the simi workflow.
 */

/**
 * Shape of what success looks like for a scenario.
 *
 *   scalar         — single number/string/boolean answer at workspace.bench_answer
 *   date           — YYYY-MM-DD string at workspace.bench_answer
 *   list           — array of items (order is normalized before comparison)
 *   comparison     — { winner, a, b } where winner ∈ {'a','b'} or labels
 *   negative       — value === null because the data truthfully doesn't exist
 *   composite      — multi-field object (e.g. HARD-1's monthly matrix + argmin)
 *   tool_sequence  — success is measured by the function-call trace, not
 *                    bench_answer. Tests the agent's ability to infer a
 *                    multi-step plan (e.g. "I want to record a dream"
 *                    → accumulate_text → save_log).
 */
export type AnswerKind =
  | 'scalar'
  | 'date'
  | 'list'
  | 'comparison'
  | 'negative'
  | 'composite'
  | 'tool_sequence';

// ──────────────────────────────────────────────────────────────────────────
// tool_sequence kind — for action-plan inference scenarios
// ──────────────────────────────────────────────────────────────────────────

/**
 * Matcher for a single argument value on an expected tool call. Defaults are
 * lenient: omit the field entirely if you don't care about an arg.
 */
export type ArgMatcher =
  | { equals: unknown }
  | { matches: string }                          // regex source for strings
  | { includes: unknown }                        // substring or array-includes
  | { predicate: (v: unknown) => boolean };

/** One expected tool invocation in the sequence. */
export interface ExpectedCall {
  tool: string;                                  // e.g. 'accumulate_text', 'save_log'
  args?: Record<string, ArgMatcher>;
}

/**
 * Scripted text chunks to feed into a blocking function (e.g. accumulate_text,
 * save_memo). The simi workflow dispatches each chunk via setChatInput +
 * sendChatMessage, which routes to handle_function_input while
 * `cor.is_running_function === true`.
 *
 * Keyed by tool name — chunks for accumulate_text go under 'accumulate_text';
 * chunks for save_memo go under 'save_memo'. Most scenarios only need one
 * blocking tool.
 */
export type ScriptedResponses = Record<string, string[]>;

/** Payload the agent passes to the benchpress `submit_answer` tool. */
export interface SubmitAnswerPayload {
  value: unknown;
  kind: AnswerKind;
  unit?: string;
  reason?: string;
  source_tool?: string;
}

/**
 * Real-UTC + local-day + tz triple. Required on every event-time row
 * (logs, sessions, metrics, user_entities, user_relations, events).
 * Matches `packages/smartchats-database/src/schema/local.ts` and
 * `nowEventTime()` in `apps/smartchats/app/modules/system.ts`.
 */
export interface EventTimeFields {
  ts: string;
  local_date: string;
  local_tz: string;
}

/**
 * One scenario benchpress runs.
 *
 * `ts_truth(seed)` is the authoritative answer, computed in TS at generator
 * time. `surql_probe` is the same answer expressed as a SurrealQL query
 * against the seeded DB; the verify_seed script asserts they're equal.
 *
 * `prompt` is a single user message for single-turn scenarios, or an array
 * for procedural multi-turn (each element is one user turn).
 */
export interface BenchScenario<Seed = unknown, Truth = unknown> {
  id: string;
  category: string;
  prompt: string | string[];
  kind: AnswerKind;
  ts_truth: (seed: Seed) => Truth;
  surql_probe?: string;
  expected_shape?: Record<string, string>;
}

/**
 * Snapshot of every scenario's expected answer, emitted by the generator
 * to `fixtures/truths.json`. The verifier loads this without needing to
 * import the scenario .ts files (lets the verifier stay slim and decoupled).
 */
export interface TruthsSnapshot {
  generated_at: string;
  seed_version: string;
  scenarios: Record<
    string,
    {
      truth: unknown;
      surql_probe?: string;
      kind: AnswerKind;
    }
  >;
}
